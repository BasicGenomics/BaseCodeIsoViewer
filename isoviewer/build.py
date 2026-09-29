from __future__ import annotations

import math
import os
import time
from collections import defaultdict

import numpy as np

from . import metrics
from .frame import Frame
from .loaders import annotation as ann_mod
from .loaders import assignments as asg
from .loaders import expression as ex
from .loaders import models as mod_mod
from .loaders import sqanti as sqanti_mod
from .loaders import support as sup_mod
from .loaders import upstream as up_mod
from .payload import Block, encode_frame, encode_json_block

VERSION = "2.3.6"

STRAND_CODE = {"+": 0, "-": 1, ".": 2}

PARAM_LABELS = [
    ("data_type", "Data type"),
    ("stranded", "Strandedness"),
    ("matching_strategy", "Matching strategy"),
    ("delta", "Junction delta"),
    ("transcript_quantification", "Transcript quantification"),
    ("gene_quantification", "Gene quantification"),
    ("model_construction_strategy", "Model construction"),
    ("polya_requirement", "Poly-A requirement"),
    ("basecode", "BaseCode mode"),
    ("basecode_max_gap", "BaseCode max gap (bp)"),
    ("basecode_correct", "BaseCode exon correction"),
    ("basecode_keep_ambiguous_imputation", "Keep ambiguous imputation"),
    ("basecode_end_resolve", "End resolve"),
    ("basecode_intron_resolve", "Intron resolve"),
    ("check_canonical", "Canonical junction check"),
    ("complete_genedb", "Complete gene DB"),
]


class BuildLog:
    def __init__(self, verbose: bool = True):
        self.lines: list[str] = []
        self.verbose = verbose
        self._t0 = time.time()

    def __call__(self, msg: str = "") -> None:
        self.lines.append(msg)
        if self.verbose:
            print(msg, flush=True)

    def step(self, msg: str) -> None:
        self(f"[{time.time() - self._t0:6.1f}s] {msg}")


class Checks:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, label: str, expected, actual, *, tolerance: int = 0,
            note: str = "") -> None:
        try:
            ok = abs(float(expected) - float(actual)) <= tolerance
        except (TypeError, ValueError):
            ok = expected == actual
        self.items.append({
            "label": label,
            "expected": expected,
            "actual": actual,
            "ok": bool(ok),
            "note": note,
        })

    def add_subset(self, label: str, whole, part, *, max_rel: float = 1e-4,
                   note: str = "") -> None:
        try:
            w, pt = float(whole), float(part)
            ok = pt <= w and (w <= 0 or (w - pt) / w <= max_rel)
            detail = f"{part!r} of {whole!r}"
            if w > 0 and pt <= w:
                detail += f" (short by {(w - pt) / w:.2e})"
        except (TypeError, ValueError):
            ok = whole == part
            detail = f"{part!r} of {whole!r}"
        self.items.append({
            "label": label,
            "expected": f"≤ {whole!r}, short by ≤ {max_rel:.0e}",
            "actual": detail,
            "ok": bool(ok),
            "note": note,
        })

    def report(self, log: BuildLog) -> None:
        bad = [c for c in self.items if not c["ok"]]
        log(f"  {len(self.items) - len(bad)}/{len(self.items)} reconciliation "
            f"checks passed")
        for c in bad:
            log(f"    MISMATCH {c['label']}: expected {c['expected']!r}, "
                f"got {c['actual']!r}")


def _finite(x, default=0.0):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def _clean(obj):
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.ndarray):
        return _clean(obj.tolist())
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj


def _counter_to_ordered(counts: dict, order: tuple[str, ...]) -> dict:
    keys = [k for k in order if k in counts]
    keys += sorted(k for k in counts if k not in order)
    return {"values": keys, "counts": [int(counts[k]) for k in keys]}


def build_assignment_qc(mt: asg.MoleculeTable, samples: list[str],
                        strict_fl: np.ndarray | None, log: BuildLog) -> dict:
    n_assign = len(mt.assign_values)
    n_class = len(mt.class_values)
    n_sample = len(mt.sample_values)
    fl_loose = asg.full_length_mask(mt)

    universes = {"all": None, "fl": fl_loose}

    out: dict = {
        "source": mt.stats["source"],
        "stats": _clean(mt.stats),
        "assign_values": list(mt.assign_values),
        "class_values": [v or "(none)" for v in mt.class_values],
        "sample_values": list(mt.sample_values),
        "outcome_of": {v: asg.OUTCOME_OF.get(v, "no_gene") for v in mt.assign_values},
        "fl_definitions": {
            "fl": "At least one 3′ read and one 5′ read observed, so both "
                  "ends of the molecule were seen",
        },
        "has_strict_fl": strict_fl is not None,
        "n_full_length_strict": int(strict_fl.sum()) if strict_fl is not None else None,
        "by_universe": {},
    }

    for uni, mask in universes.items():
        entry: dict = {}
        for weight in ("mol", "read"):
            entry[f"assign_{weight}"] = asg.crosstab(
                mt, mt.assign, n_assign, weight=weight, mask=mask).tolist()
            entry[f"class_{weight}"] = asg.crosstab(
                mt, mt.classification, n_class, weight=weight, mask=mask).tolist()
            entry[f"sample_{weight}"] = asg.crosstab(
                mt, mt.sample, n_sample, weight=weight, mask=mask).tolist()
            entry[f"sample_assign_{weight}"] = asg.crosstab_2d(
                mt, mt.sample, n_sample, mt.assign, n_assign,
                weight=weight, mask=mask).tolist()
            entry[f"sample_class_{weight}"] = asg.crosstab_2d(
                mt, mt.sample, n_sample, mt.classification, n_class,
                weight=weight, mask=mask).tolist()
        sel = np.ones(mt.n, dtype=bool) if mask is None else mask
        entry["total_molecules"] = int(sel.sum())
        entry["total_reads"] = int(mt.nr[sel].sum())
        out["by_universe"][uni] = entry

    t, f, i = mt.tc > 0, mt.fc > 0, mt.ic > 0
    end_defs = [
        ("T_F_I", t & f & i), ("T_F", t & f & ~i), ("T_I", t & ~f & i),
        ("F_I", ~t & f & i), ("T", t & ~f & ~i), ("F", ~t & f & ~i),
        ("I", ~t & ~f & i), ("none", ~t & ~f & ~i),
    ]
    out["ends"] = {
        "values": [k for k, _ in end_defs],
        "labels": [sup_mod.END_CAT_LABEL[k] for k, _ in end_defs],
        "molecules": [int(m.sum()) for _, m in end_defs],
        "reads": [int(mt.nr[m].sum()) for _, m in end_defs],
        "per_sample": {
            str(sname): {
                "molecules": [int((m & (mt.sample == si)).sum())
                              for _, m in end_defs],
                "reads": [int(mt.nr[m & (mt.sample == si)].sum())
                          for _, m in end_defs],
            }
            for si, sname in enumerate(mt.sample_values)
        },
    }

    out["adaptation"] = asg.adaptation_summary(mt)
    out["polya"] = {
        "molecules": int((mt.polya > 0).sum()),
        "reads": int(mt.nr[mt.polya > 0].sum()),
        "total_molecules": int(mt.n),
        "total_reads": int(mt.nr.sum()),
    }

    nr = mt.nr.astype(np.int64)
    top = int(nr.max()) if nr.size else 0
    top = min(top, 1_000_000)
    hist = np.bincount(np.minimum(nr, top), minlength=top + 1) if top else np.zeros(1, dtype=np.int64)
    hist_fl = (np.bincount(np.minimum(nr[fl_loose], top), minlength=top + 1)
               if top and fl_loose.any() else np.zeros(top + 1, dtype=np.int64))
    nr_fl = nr[fl_loose] if fl_loose.any() else nr[:0]
    out["reads_per_molecule"] = {
        "counts": [int(v) for v in hist[1:top + 1]],
        "counts_fl": [int(v) for v in hist_fl[1:top + 1]],
        "mean": _finite(nr.mean()),
        "median": _finite(np.median(nr)),
        "max": int(nr.max()) if nr.size else 0,
        "mean_fl": _finite(nr_fl.mean()) if nr_fl.size else 0.0,
        "median_fl": _finite(np.median(nr_fl)) if nr_fl.size else 0.0,
        "max_fl": int(nr_fl.max()) if nr_fl.size else 0,
    }

    if mt.sample is not None and getattr(mt, "sample_values", None):
        rpm = out["reads_per_molecule"]
        names, per_all, per_fl, st_all, st_fl = [], [], [], [], []
        for si, sname in enumerate(mt.sample_values):
            sel = mt.sample == si
            if not sel.any():
                continue
            nr_s = nr[sel]
            nr_s_fl = nr_s[fl_loose[sel]]
            names.append(str(sname))
            h = (np.bincount(np.minimum(nr_s, top), minlength=top + 1)
                 if top else np.zeros(1, dtype=np.int64))
            h_fl = (np.bincount(np.minimum(nr_s_fl, top), minlength=top + 1)
                    if top and nr_s_fl.size else np.zeros(top + 1, dtype=np.int64))
            per_all.append([int(v) for v in h[1:top + 1]])
            per_fl.append([int(v) for v in h_fl[1:top + 1]])
            st_all.append({
                "n": int(nr_s.size), "mean": _finite(nr_s.mean()),
                "median": _finite(np.median(nr_s)), "max": int(nr_s.max()),
            })
            st_fl.append({
                "n": int(nr_s_fl.size),
                "mean": _finite(nr_s_fl.mean()) if nr_s_fl.size else 0.0,
                "median": _finite(np.median(nr_s_fl)) if nr_s_fl.size else 0.0,
                "max": int(nr_s_fl.max()) if nr_s_fl.size else 0,
            })
        rpm["samples"] = names
        rpm["per_sample_all"] = per_all
        rpm["per_sample_fl"] = per_fl
        rpm["per_sample_stats_all"] = st_all
        rpm["per_sample_stats_fl"] = st_fl

    if getattr(mt, "n_genes", None) is not None:
        ng = mt.n_genes.astype(np.int64)
        top_ng = int(ng.max()) if ng.size else 0
        ng_hist = np.bincount(ng, minlength=max(2, top_ng + 1)).astype(np.int64)
        multi = int(ng_hist[2:].sum()) if top_ng >= 2 else 0
        with_gene = int(ng_hist[1:].sum())
        ng_fl = ng[fl_loose] if fl_loose.any() else ng[:0]
        ng_hist_fl = (np.bincount(ng_fl, minlength=max(2, top_ng + 1)).astype(np.int64)
                      if ng_fl.size else np.zeros(max(2, top_ng + 1), dtype=np.int64))
        out["genes_per_molecule"] = {
            "counts": [int(v) for v in ng_hist],
            "with_gene": with_gene,
            "multi_gene": multi,
            "max": top_ng,
            "pairs": int((ng * 1).sum()),
            "counts_fl": [int(v) for v in ng_hist_fl],
            "with_gene_fl": int(ng_hist_fl[1:].sum()),
            "multi_gene_fl": int(ng_hist_fl[2:].sum()) if top_ng >= 2 else 0,
        }

    out["exon_intron"] = {
        "reads_total": int(nr.sum()),
        "reads_exonic": int(mt.er.sum()),
        "reads_intronic": int(mt.ir.sum()),
        "note": "These are independent annotations of the same reads and "
                "overlap; they do not partition each other.",
    }

    per_sample_ends = {}
    for si, sname in enumerate(mt.sample_values):
        sm = mt.sample == si
        per_sample_ends[sname] = {
            "molecules": int(sm.sum()),
            "reads": int(mt.nr[sm].sum()),
            "fl": int((sm & fl_loose).sum()),
            "fl_reads": int(mt.nr[sm & fl_loose].sum()),
            "fl_strict": int((sm & strict_fl).sum()) if strict_fl is not None else None,
            "polya": int((sm & (mt.polya > 0)).sum()),
            "reads_per_molecule": _finite(nr[sm].mean()) if sm.any() else 0.0,
        }
    out["per_sample"] = per_sample_ends
    log(f"    assignment QC: {len(universes)} universes x 2 weightings")
    return out


def build_discovery_assignment(model_reads: tuple, mt: asg.MoleculeTable,
                               models: mod_mod.Models, samples: list[str],
                               n_star: int, log: BuildLog) -> dict:
    mol, mcode, model_values = model_reads[0], model_reads[1], model_reads[4]
    w_all, fl_all = _molecule_weights(mt, model_reads[5])
    models_per_mol = np.bincount(mol, minlength=w_all.size)

    cls_of = {t: rec["class"] for t, rec in models.tx.items()}
    buckets = ("known", "nic", "nnic", "novel")
    bucket_of = np.empty(len(model_values), dtype=np.int64)
    for c, mid in enumerate(model_values):
        k = cls_of.get(mid, "novel")
        if k not in buckets:
            raise KeyError(k)
        bucket_of[c] = buckets.index(k)

    rb = bucket_of[mcode]
    w = w_all[mol]
    fl = fl_all[mol]
    wfl = np.where(fl, w, 0)
    nb = len(buckets)
    pair_mol = _ints(np.bincount(rb, minlength=nb))
    pair_read = _ints(np.bincount(rb, weights=w, minlength=nb))
    pair_fl = _ints(np.bincount(rb, weights=fl, minlength=nb))
    pair_read_fl = _ints(np.bincount(rb, weights=wfl, minlength=nb))
    pair_mol, pair_read, pair_fl, pair_read_fl = (
        dict(zip(buckets, v)) for v in (pair_mol, pair_read, pair_fl, pair_read_fl))
    n_missing_nr = int((mol >= mt.n).sum())

    one = models_per_mol == 1
    many = models_per_mol > 1
    uniq_mol, uniq_read = int(one.sum()), int(w_all[one].sum())
    uniq_mol_fl, uniq_read_fl = int((one & fl_all).sum()), int(w_all[one & fl_all].sum())
    amb_mol, amb_read = int(many.sum()), int(w_all[many].sum())
    amb_mol_fl, amb_read_fl = int((many & fl_all).sum()), int(w_all[many & fl_all].sum())

    un = models_per_mol[:mt.n] == 0
    un_fl = un & fl_all[:mt.n]
    un_mol, un_read = int(un.sum()), int(w_all[:mt.n][un].sum())
    un_mol_fl, un_read_fl = int(un_fl.sum()), int(w_all[:mt.n][un_fl].sum())

    log(f"    discovery assignment: {uniq_mol:,} uniquely attached, {amb_mol:,} "
        f"ambiguous, {un_mol:,} unattached; {n_missing_nr:,} pairs without an NR weight")
    return {
        "source": "transcript_model_reads.tsv.gz",
        "outcome": {
            "values": ["unique", "ambiguous", "unattached"],
            "labels": ["Attached to one model", "Compatible with several models",
                       "Not attached to any model"],
            "molecules": [uniq_mol, amb_mol, un_mol],
            "reads": [uniq_read, amb_read, un_read],
            "molecules_fl": [uniq_mol_fl, amb_mol_fl, un_mol_fl],
            "reads_fl": [uniq_read_fl, amb_read_fl, un_read_fl],
        },
        "by_class": {
            "unit": "(molecule, model) pairs",
            "values": list(buckets),
            "pairs": [pair_mol[k] for k in buckets],
            "reads": [pair_read[k] for k in buckets],
            "pairs_fl": [pair_fl[k] for k in buckets],
            "reads_fl": [pair_read_fl[k] for k in buckets],
        },
        "star_rows": int(n_star),
        "total_molecules": int(uniq_mol + amb_mol + un_mol),
        "missing_weight": int(n_missing_nr),
        "note": "A molecule can be compatible with more than one model, so "
                "per-model support sums exceed the molecule total.",
    }


class ModeBuild:
    def __init__(self, key: str, label: str):
        self.key = key
        self.label = label
        self.genes = Frame(f"{key}.genes")
        self.tx = Frame(f"{key}.tx")
        self.struct = Frame(f"{key}.struct")
        self.summary: dict = {}


def _sample_detected(mat: np.ndarray) -> np.ndarray:
    return (mat > 0).sum(axis=1).astype(np.int32)


def build_mode(*, key: str, label: str,
               gene_ids: list[str], gene_meta: dict,
               gene_counts: np.ndarray, gene_tpm: np.ndarray,
               tx_by_gene: dict[str, list[str]], tx_meta: dict,
               tx_counts_mat: ex.Matrix, tx_tpm_mat: ex.Matrix,
               exons: dict[str, list], cds: dict[str, tuple[int, int]],
               samples: list[str],
               gene_mol: dict[str, tuple[int, int, int, int]],
               gene_outcome: dict[str, tuple[int, int, int]] | None = None,
               tx_mol: dict[str, tuple[int, int, int, int]],
               support: sup_mod.Support | None,
               log: BuildLog,
               tx_mol_unique: dict[str, tuple[int, int]] | None = None,
               quantified: set[str] | None = None,
               annotated_tx: dict[str, list] | None = None,
               gene_mol_ps: dict[str, dict] | None = None,
               tx_mol_ps: dict[str, dict] | None = None,
               gene_outcome_ps: dict[str, dict] | None = None) -> ModeBuild:
    mb = ModeBuild(key, label)
    n_s = len(samples)
    n_g = len(gene_ids)

    tx_ids: list[str] = []
    tx_gene_idx: list[int] = []
    tx_off = np.zeros(n_g, dtype=np.int64)
    tx_n = np.zeros(n_g, dtype=np.int32)
    for gi, gid in enumerate(gene_ids):
        kids = tx_by_gene.get(gid, [])
        tx_off[gi] = len(tx_ids)
        tx_n[gi] = len(kids)
        tx_ids.extend(kids)
        tx_gene_idx.extend([gi] * len(kids))
    n_t = len(tx_ids)

    tx_tpm = tx_tpm_mat.reindex(tx_ids) if n_t else np.zeros((0, n_s), np.float32)
    tx_cnt = tx_counts_mat.reindex(tx_ids) if n_t else np.zeros((0, n_s), np.float32)

    offsets = np.concatenate([tx_off, [n_t]]).astype(np.int64)
    usage = metrics.GeneUsage(tx_tpm, offsets, n_s).compute()
    gene_cv = metrics.cv(gene_tpm.astype(np.float64)).astype(np.float32)

    ex_off = np.zeros(n_t, dtype=np.int64)
    ex_n = np.zeros(n_t, dtype=np.int32)
    flat_tx: list[int] = []
    flat_start: list[int] = []
    flat_end: list[int] = []
    flat_num: list[int] = []
    flat_eid: list[str] = []
    cds_start = np.zeros(n_t, dtype=np.int64)
    cds_end = np.zeros(n_t, dtype=np.int64)
    for ti, tid in enumerate(tx_ids):
        blocks = exons.get(tid) or []
        ex_off[ti] = len(flat_start)
        ex_n[ti] = len(blocks)
        for blk in blocks:
            s_, e_, num = blk[0], blk[1], blk[2]
            flat_tx.append(ti)
            flat_start.append(s_)
            flat_end.append(e_)
            flat_num.append(min(num, 65535))
            flat_eid.append(str(blk[3]) if len(blk) > 3 and blk[3] else "")
        cb = cds.get(tid)
        if cb:
            cds_start[ti], cds_end[ti] = cb

    tpm_mean = gene_tpm.mean(axis=1) if n_s else np.zeros(n_g, np.float32)
    gm = [gene_meta.get(g, {}) for g in gene_ids]

    mb.genes.add_text("id", gene_ids)
    mb.genes.add_text("name", [m.get("name") or g for m, g in zip(gm, gene_ids)])
    mb.genes.add_text("chr", [m.get("chr", "") for m in gm])
    mb.genes.add("start", np.array([m.get("start", 0) for m in gm], dtype=np.int64), dtype="i32")
    mb.genes.add("end", np.array([m.get("end", 0) for m in gm], dtype=np.int64), dtype="i32")
    mb.genes.add("strand", np.array([STRAND_CODE.get(m.get("strand", "."), 2) for m in gm]), dtype="u8")
    mb.genes.add_text("biotype", [m.get("type", "unknown") for m in gm])
    mb.genes.add("tpm_mean", tpm_mean.astype(np.float32))
    mb.genes.add("count", np.rint(gene_counts.sum(axis=1)).astype(np.int64), dtype="i32")
    mb.genes.add_matrix("tpm", gene_tpm, cols=samples)
    mb.genes.add_matrix("counts", gene_counts, cols=samples)
    mb.genes.add("n_detected", _sample_detected(gene_tpm), dtype="u8")
    mb.genes.add("cv", gene_cv)
    for name in ("entropy_norm", "entropy", "jsd_mean", "jsd_max", "switch",
                 "dominant_share"):
        mb.genes.add(name, usage[name].astype(np.float32))
    mb.genes.add("n_var", usage["n_variants"], dtype="u16")
    mb.genes.add("n_var_expressed", usage["n_variants_expressed"], dtype="u16")
    mb.genes.add("tx_off", tx_off, dtype="i32")
    mb.genes.add("tx_n", tx_n, dtype="u16")

    zeros4 = (0, 0, 0, 0)
    gmol = np.array([gene_mol.get(g, zeros4) for g in gene_ids], dtype=np.int64) \
        if n_g else np.zeros((0, 4), np.int64)
    for j, nm in enumerate(("mol", "mol_fl", "read", "read_fl")):
        mb.genes.add(nm, gmol[:, j], dtype="i32")

    if gene_mol_ps is not None and n_g and n_s:
        for nm in ("mol", "mol_fl", "read"):
            m = np.zeros((n_g, n_s), dtype=np.int64)
            for i, g in enumerate(gene_ids):
                e = gene_mol_ps.get(g)
                if e is not None:
                    m[i, :] = e[nm]
            mb.genes.add_matrix(nm + "_s", m.astype(np.int32), cols=list(samples))

    if gene_outcome is not None:
        zeros3 = (0, 0, 0)
        gout = np.array([gene_outcome.get(g, zeros3) for g in gene_ids],
                        dtype=np.int64) if n_g else np.zeros((0, 3), np.int64)
        for j, nm in enumerate(("mol_resolved", "mol_gene_only", "read_resolved")):
            mb.genes.add(nm, gout[:, j], dtype="i32")

    if gene_outcome_ps is not None and n_g and n_s:
        for nm in ("mol_resolved", "mol_gene_only"):
            m = np.zeros((n_g, n_s), dtype=np.int64)
            for i, g in enumerate(gene_ids):
                e = gene_outcome_ps.get(g)
                if e is not None:
                    m[i, :] = e[nm]
            mb.genes.add_matrix(nm + "_s", m.astype(np.int32), cols=list(samples))
        log(f"    per-sample outcome matrices: {n_g:,} genes x {n_s} samples")

    if quantified is not None:
        mb.genes.add("quantified",
                     np.array([1 if g in quantified else 0 for g in gene_ids]),
                     dtype="u8")

    if annotated_tx is not None:
        mb.genes.add(
            "n_annotated",
            np.array([len(annotated_tx.get(g, ())) for g in gene_ids], dtype=np.int64),
            dtype="u16")

    if key == "disc":
        mb.genes.add("novel", np.array([1 if m.get("novel") else 0 for m in gm]), dtype="u8")
        cls = [tx_meta.get(t, {}).get("class", "novel") for t in tx_ids]
        for tag in ("known", "nic", "nnic"):
            per_gene = np.zeros(n_g, dtype=np.int32)
            for ti, c in enumerate(cls):
                if c == tag:
                    per_gene[tx_gene_idx[ti]] += 1
            mb.genes.add(f"n_{tag}", per_gene, dtype="u16")

    tm = [tx_meta.get(t, {}) for t in tx_ids]
    tx_tpm_mean = tx_tpm.mean(axis=1) if n_s else np.zeros(n_t, np.float32)
    tx_count_tot = np.rint(tx_cnt.sum(axis=1)).astype(np.int64)

    gene_total = np.zeros(n_t, dtype=np.float64)
    for gi in range(n_g):
        a, b = tx_off[gi], tx_off[gi] + tx_n[gi]
        tot = tx_tpm_mean[a:b].sum()
        if tot > 0:
            gene_total[a:b] = tot
    share = np.divide(tx_tpm_mean, gene_total, out=np.zeros(n_t), where=gene_total > 0)

    exon_len = np.zeros(n_t, dtype=np.int64)
    for ti in range(n_t):
        a, b = ex_off[ti], ex_off[ti] + ex_n[ti]
        exon_len[ti] = sum(flat_end[k] - flat_start[k] + 1 for k in range(a, b))

    mb.tx.add_text("id", tx_ids)
    mb.tx.add_text("name", [m.get("name") or t for m, t in zip(tm, tx_ids)])
    mb.tx.add("gene_idx", np.asarray(tx_gene_idx, dtype=np.int64), dtype="i32")
    mb.tx.add_text("chr", [m.get("chr", "") for m in tm])
    mb.tx.add("start", np.array([m.get("start", 0) for m in tm], dtype=np.int64), dtype="i32")
    mb.tx.add("end", np.array([m.get("end", 0) for m in tm], dtype=np.int64), dtype="i32")
    mb.tx.add("strand", np.array([STRAND_CODE.get(m.get("strand", "."), 2) for m in tm]), dtype="u8")
    mb.tx.add("tpm_mean", tx_tpm_mean.astype(np.float32))
    mb.tx.add("count", tx_count_tot, dtype="i32")
    mb.tx.add("share", share.astype(np.float32))
    mb.tx.add_matrix("tpm", tx_tpm, cols=samples)
    mb.tx.add_matrix("counts", tx_cnt, cols=samples)
    mb.tx.add("n_detected", _sample_detected(tx_tpm), dtype="u8")
    mb.tx.add("n_exons", ex_n, dtype="u16")
    mb.tx.add("length", exon_len, dtype="i32")
    mb.tx.add("ex_off", ex_off, dtype="i32")
    mb.tx.add("ex_n", ex_n, dtype="u16")
    mb.tx.add("cds_start", cds_start, dtype="i32")
    mb.tx.add("cds_end", cds_end, dtype="i32")
    mb.tx.add("detected", (tx_count_tot > 0).astype(np.uint8), dtype="u8")

    tmol = np.array([tx_mol.get(t, zeros4) for t in tx_ids], dtype=np.int64) \
        if n_t else np.zeros((0, 4), np.int64)
    for j, nm in enumerate(("mol", "mol_fl", "read", "read_fl")):
        mb.tx.add(nm, tmol[:, j], dtype="i32")

    if tx_mol_ps is not None and n_t and n_s:
        for nm in ("mol", "mol_fl", "read"):
            m = np.zeros((n_t, n_s), dtype=np.int64)
            for i, t in enumerate(tx_ids):
                e = tx_mol_ps.get(t)
                if e is not None:
                    m[i, :] = e[nm]
            mb.tx.add_matrix(nm + "_s", m.astype(np.int32), cols=list(samples))

    if tx_mol_unique is not None:
        tuq = np.array([tx_mol_unique.get(t, (0, 0)) for t in tx_ids], dtype=np.int64) \
            if n_t else np.zeros((0, 2), np.int64)
        mb.tx.add("mol_unique", tuq[:, 0], dtype="i32")
        mb.tx.add("read_unique", tuq[:, 1], dtype="i32")

    if key == "ref":
        mb.tx.add_text("biotype", [m.get("type", "unknown") for m in tm])
        mb.tx.add_text("tsl", [m.get("tsl", "") for m in tm])
        mb.tx.add_text("tag", [",".join(m.get("tags", [])) for m in tm])
    else:
        mb.tx.add_text("class", [m.get("class", "novel") for m in tm])
        mb.tx.add("novel", np.array([1 if m.get("novel") else 0 for m in tm]), dtype="u8")
        mb.tx.add_text("source", [m.get("source", "") for m in tm])

    if support is not None:
        sup_cols = [
            ("sup_reads", "n_reads", "i32"),
            ("sup_fl", "n_full_length", "i32"),
            ("sup_gap", "n_gap", "i32"),
            ("sup_median_aligned", "median_aligned", "i32"),
        ]
        for out_name, src, dt in sup_cols:
            if support.has(src):
                mb.tx.add(out_name, support.align(tx_ids, src).astype(np.int64), dtype=dt)
        for out_name, src in (("sup_frac_fl", "frac_full_length"),
                              ("sup_frac_gap", "frac_gap"),
                              ("sup_mean_aligned", "mean_aligned")):
            if support.has(src):
                mb.tx.add(out_name, support.align(tx_ids, src).astype(np.float32))
        for cat in sup_mod.END_CATS:
            src = f"n_{cat}"
            if support.has(src):
                mb.tx.add(f"end_{cat}", support.align(tx_ids, src).astype(np.int64), dtype="i32")
        if key == "ref":
            for t in sup_mod.REF_TYPES:
                src = f"n_{t}"
                if support.has(src):
                    mb.tx.add(f"at_{t}", support.align(tx_ids, src).astype(np.int64), dtype="i32")

    mb.struct.add("tx_idx", np.asarray(flat_tx, dtype=np.int64), dtype="i32")
    mb.struct.add("start", np.asarray(flat_start, dtype=np.int64), dtype="i32")
    mb.struct.add("end", np.asarray(flat_end, dtype=np.int64), dtype="i32")
    mb.struct.add("num", np.asarray(flat_num, dtype=np.int64), dtype="u16")
    if any(flat_eid):
        mb.struct.add_text("exon_id", flat_eid)

    mb.summary = {
        "key": key,
        "label": label,
        "n_genes": n_g,
        "n_genes_quantified": len(quantified) if quantified is not None else n_g,
        "n_genes_evidence_only": (n_g - len(quantified)) if quantified is not None else 0,
        "n_transcripts": n_t,
        "n_transcripts_detected": int((tx_count_tot > 0).sum()),
        "n_multi_variant_genes": int((tx_n > 1).sum()),
        "n_exons_stored": len(flat_start),
        "mean_variants_per_gene": _finite(tx_n.mean()) if n_g else 0.0,
        "median_variants_per_gene": _finite(np.median(tx_n)) if n_g else 0.0,
        "mean_entropy_norm": _finite(usage["entropy_norm"][tx_n > 1].mean())
        if (tx_n > 1).any() else 0.0,
        "mean_jsd": _finite(usage["jsd_mean"][tx_n > 1].mean())
        if (tx_n > 1).any() else 0.0,
        "hist": {
            "gene_tpm": metrics.log_histogram(tpm_mean),
            "tx_tpm": metrics.log_histogram(tx_tpm_mean),
            "variants_per_gene": metrics.histogram(tx_n.astype(float), bins=40, lo=0),
            "entropy_norm": metrics.histogram(
                usage["entropy_norm"][tx_n > 1], bins=50, lo=0, hi=1),
            "jsd_mean": metrics.histogram(
                usage["jsd_mean"][tx_n > 1], bins=50, lo=0, hi=1),
            "cv": metrics.histogram(gene_cv, bins=50, lo=0),
            "gene_molecules": metrics.log_histogram(gmol[:, 0].astype(float))
            if n_g else {},
            "tx_molecules": metrics.log_histogram(tmol[:, 0].astype(float))
            if n_t else {},
        },
        "quantiles": {
            "gene_tpm": metrics.quantiles(tpm_mean),
            "tx_tpm": metrics.quantiles(tx_tpm_mean),
            "gene_molecules": metrics.quantiles(gmol[:, 0].astype(float)) if n_g else {},
        },
    }
    log(f"    {mb.genes.describe()}")
    log(f"    {mb.tx.describe()}")
    log(f"    {mb.struct.describe()}")
    return mb


def gene_molecule_totals(mt: asg.MoleculeTable) -> dict[str, tuple]:
    tot = asg.per_feature_totals(mt.gene, len(mt.gene_values), mt,
                                np.ones(mt.n, dtype=bool))
    out: dict[str, tuple] = {}
    for i, gid in enumerate(mt.gene_values):
        if not gid:
            continue
        out[gid] = (int(tot["mol"][i]), int(tot["mol_fl"][i]),
                    int(tot["read"][i]), int(tot["read_fl"][i]))
    return out


def per_sample_feature_totals(keys: np.ndarray, key_values: list,
                              mt: asg.MoleculeTable,
                              samples: list[str]) -> dict[str, dict]:
    n_keys = len(key_values)
    code_of = {name: i for i, name in enumerate(mt.sample_values)}
    per_sample: list[dict[str, np.ndarray]] = []
    for name in samples:
        code = code_of.get(name)
        if code is None:
            z = np.zeros(n_keys, dtype=np.int64)
            per_sample.append({"mol": z, "mol_fl": z, "read": z})
            continue
        sel = mt.sample == code
        tot = asg.per_feature_totals(keys, n_keys, mt, sel)
        per_sample.append({"mol": tot["mol"], "mol_fl": tot["mol_fl"],
                           "read": tot["read"]})

    out: dict[str, dict] = {}
    for i, fid in enumerate(key_values):
        if not fid:
            continue
        out[fid] = {
            "mol": [int(ps["mol"][i]) for ps in per_sample],
            "mol_fl": [int(ps["mol_fl"][i]) for ps in per_sample],
            "read": [int(ps["read"][i]) for ps in per_sample],
        }
    return out


def gene_outcome_totals(mt: asg.MoleculeTable) -> dict[str, tuple]:
    tot = asg.per_gene_totals(mt)
    out: dict[str, tuple] = {}
    for i, gid in enumerate(mt.gene_values):
        if not gid:
            continue
        out[gid] = (int(tot["mol_resolved"][i]), int(tot["mol_gene_only"][i]),
                    int(tot["read_resolved"][i]))
    return out


def gene_outcome_totals_per_sample(mt: asg.MoleculeTable,
                                   samples: list[str]) -> dict[str, dict]:
    n_s = len(samples)
    code_of = {name: i for i, name in enumerate(mt.sample_values)}
    per_sample = []
    for name in samples:
        code = code_of.get(name)
        if code is None:
            per_sample.append(None)
            continue
        per_sample.append(asg.per_gene_totals(mt, mask=(mt.sample == code)))

    out: dict[str, dict] = {}
    for i, gid in enumerate(mt.gene_values):
        if not gid:
            continue
        out[gid] = {
            "mol_resolved": [
                0 if t is None else int(t["mol_resolved"][i]) for t in per_sample],
            "mol_gene_only": [
                0 if t is None else int(t["mol_gene_only"][i]) for t in per_sample],
        }
    return out


def _ints(a: np.ndarray) -> list[int]:
    return a.astype(np.int64).tolist()


def _first_seen(codes: np.ndarray) -> np.ndarray:
    uniq, first = np.unique(codes, return_index=True)
    return uniq[np.argsort(first, kind="stable")]


def _dense_rank(order: np.ndarray, codes: np.ndarray) -> np.ndarray:
    rank = np.zeros(int(order.max()) + 1, dtype=np.int64)
    rank[order] = np.arange(order.size)
    return rank[codes]


def _resolved_iso_rows(mt: asg.MoleculeTable) -> np.ndarray:
    resolved = np.array([v in asg.RESOLVED for v in mt.assign_values], dtype=bool)
    named = np.array([bool(v) for v in mt.iso_values], dtype=bool)
    if not resolved.size or not named.size:
        return np.zeros(0, dtype=np.int64)
    return np.flatnonzero(resolved[mt.assign] & named[mt.iso])


def _molecule_weights(mt: asg.MoleculeTable, n_extra: int):
    w = np.ones(mt.n + n_extra, dtype=np.int64)
    w[:mt.n] = mt.nr
    fl = np.zeros(mt.n + n_extra, dtype=bool)
    fl[:mt.n] = asg.full_length_mask(mt)
    return w, fl


def ref_tx_molecule_totals(mt: asg.MoleculeTable) -> dict[str, tuple]:
    rows = _resolved_iso_rows(mt)
    if not rows.size:
        return {}
    codes = mt.iso[rows]
    order = _first_seen(codes)
    r = _dense_rank(order, codes)
    fl = asg.full_length_mask(mt)[rows]
    w = mt.nr[rows].astype(np.int64)
    k = order.size
    mol = _ints(np.bincount(r, minlength=k))
    mol_fl = _ints(np.bincount(r, weights=fl, minlength=k))
    read = _ints(np.bincount(r, weights=w, minlength=k))
    read_fl = _ints(np.bincount(r, weights=np.where(fl, w, 0), minlength=k))
    names = mt.iso_values
    return {names[c]: (mol[i], mol_fl[i], read[i], read_fl[i])
            for i, c in enumerate(order.tolist())}


def ref_tx_molecule_totals_per_sample(mt: asg.MoleculeTable,
                                      samples: list[str]) -> dict[str, dict]:
    n_s = len(samples)
    col_of = {}
    for j, name in enumerate(samples):
        for code, nm in enumerate(mt.sample_values):
            if nm == name:
                col_of[code] = j
                break
    colmap = np.full(max(len(mt.sample_values), 1), -1, dtype=np.int64)
    for code, j in col_of.items():
        colmap[code] = j
    rows = _resolved_iso_rows(mt)
    if rows.size:
        rows = rows[colmap[mt.sample[rows]] >= 0]
    if not rows.size:
        return {}
    codes = mt.iso[rows]
    order = _first_seen(codes)
    k = order.size
    flat = _dense_rank(order, codes) * n_s + colmap[mt.sample[rows]]
    fl = asg.full_length_mask(mt)[rows]
    w = mt.nr[rows].astype(np.int64)
    size = k * n_s
    mol = np.bincount(flat, minlength=size).reshape(k, n_s).astype(np.int64)
    mol_fl = np.bincount(flat, weights=fl, minlength=size).reshape(k, n_s).astype(np.int64)
    read = np.bincount(flat, weights=w, minlength=size).reshape(k, n_s).astype(np.int64)
    names = mt.iso_values
    return {names[c]: {"mol": mol[i].tolist(), "mol_fl": mol_fl[i].tolist(),
                       "read": read[i].tolist()}
            for i, c in enumerate(order.tolist())}


def disc_molecule_totals(model_reads: tuple, mt: asg.MoleculeTable,
                         tx_gene: dict[str, str], log: BuildLog):
    mol, mcode, model_values = model_reads[0], model_reads[1], model_reads[4]
    w_all, fl_all = _molecule_weights(mt, model_reads[5])
    models_per_mol = np.bincount(mol, minlength=w_all.size)
    w = w_all[mol]
    fl = fl_all[mol]
    wfl = np.where(fl, w, 0)
    n_models = len(model_values)

    cnt = _ints(np.bincount(mcode, minlength=n_models))
    cnt_fl = _ints(np.bincount(mcode, weights=fl, minlength=n_models))
    rd = _ints(np.bincount(mcode, weights=w, minlength=n_models))
    rd_fl = _ints(np.bincount(mcode, weights=wfl, minlength=n_models))
    per_model = {model_values[c]: (cnt[c], cnt_fl[c], rd[c], rd_fl[c])
                 for c in range(n_models)}

    per_model_unique: dict[str, tuple] = {}
    q = np.flatnonzero(models_per_mol[mol] == 1)
    if q.size:
        qc = mcode[q]
        u_n = _ints(np.bincount(qc, minlength=n_models))
        u_w = _ints(np.bincount(qc, weights=w[q], minlength=n_models))
        per_model_unique = {model_values[c]: (u_n[c], u_w[c])
                            for c in _first_seen(qc).tolist()}

    gene_vals: list[str] = []
    gene_idx: dict[str, int] = {}
    gene_of_model = np.full(n_models, -1, dtype=np.int64)
    for c, mid in enumerate(model_values):
        gid = tx_gene.get(mid)
        if gid:
            j = gene_idx.get(gid)
            if j is None:
                j = gene_idx[gid] = len(gene_vals)
                gene_vals.append(gid)
            gene_of_model[c] = j
    per_gene: dict[str, tuple] = {}
    rg = gene_of_model[mcode]
    r = np.flatnonzero(rg >= 0)
    if r.size:
        n_g = len(gene_vals)
        _, first = np.unique(mol[r] * n_g + rg[r], return_index=True)
        ur = r[first]
        gg = rg[ur]
        g_n = _ints(np.bincount(gg, minlength=n_g))
        g_fl = _ints(np.bincount(gg, weights=fl[ur], minlength=n_g))
        g_w = _ints(np.bincount(gg, weights=w[ur], minlength=n_g))
        g_wfl = _ints(np.bincount(gg, weights=wfl[ur], minlength=n_g))
        per_gene = {gene_vals[j]: (g_n[j], g_fl[j], g_w[j], g_wfl[j])
                    for j in _first_seen(rg[r]).tolist()}

    present = models_per_mol[models_per_mol > 0]
    stats = {
        "rows": int(mol.size),
        "distinct_molecules": int(present.size),
        "multi_model_molecules": int((present > 1).sum()),
        "max_models_per_molecule": int(present.max()) if present.size else 0,
    }
    n_multi = stats["multi_model_molecules"]
    log(f"    {stats['rows']:,} (molecule, model) pairs over "
        f"{stats['distinct_molecules']:,} molecules; {n_multi:,} on more than one "
        f"model (max {stats['max_models_per_molecule']})")
    return per_model, per_gene, per_model_unique, stats
