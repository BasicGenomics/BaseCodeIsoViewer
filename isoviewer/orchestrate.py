from __future__ import annotations

import datetime as _dt
import os
import time
from collections import defaultdict

import numpy as np

from . import build as B
from . import metrics
from .discovery import RunPaths, discover
from .loaders import annotation as ann_mod
from .loaders import assignments as asg
from .loaders import expression as ex
from .loaders import features as feat_mod
from .loaders import models as mod_mod
from .loaders import sqanti as sqanti_mod
from .loaders import support as sup_mod
from .loaders import upstream as up_mod
from .payload import Block, encode_frame, encode_json_block


class BuildResult:
    def __init__(self) -> None:
        self.blocks: list[Block] = []
        self.core: dict = {}
        self.log: B.BuildLog | None = None

    @property
    def total_bytes(self) -> int:
        return sum(b.size for b in self.blocks)


_REQUIRED: dict[str, str] = {
    "read_assignments": "IsoQuant assignment",
    "model_reads": "IsoQuant transcript-model construction",
    "gene_counts": "IsoQuant gene quantification",
    "gene_tpm": "IsoQuant gene quantification",
    "gene_grouped_counts": "IsoQuant gene quantification (grouped)",
    "gene_grouped_tpm": "IsoQuant gene quantification (grouped)",
    "transcript_counts": "IsoQuant transcript quantification",
    "transcript_tpm": "IsoQuant transcript quantification",
    "transcript_grouped_counts": "IsoQuant transcript quantification (grouped)",
    "transcript_grouped_tpm": "IsoQuant transcript quantification (grouped)",
    "disc_gene_counts": "IsoQuant discovered-gene quantification",
    "disc_gene_tpm": "IsoQuant discovered-gene quantification",
    "disc_transcript_counts": "IsoQuant discovered-transcript quantification",
    "disc_transcript_tpm": "IsoQuant discovered-transcript quantification",
    "ref_support": "IsoQuant assess_variant_support",
    "disc_support": "IsoQuant assess_variant_support",
    "support_summary": "IsoQuant assess_variant_support",
}


def _require_all(rp: RunPaths) -> None:
    missing = [k for k in _REQUIRED if rp.files.get(k) is None]
    if not missing:
        return
    steps = sorted({_REQUIRED[k] for k in missing})
    raise FileNotFoundError(
        "this run is missing inputs IsoViewer needs:\n"
        + "".join(f"    {k}\n" for k in missing)
        + "\n  Not written by: " + "; ".join(steps)
        + f"\n  Under: {rp.out_dir}"
        + "\n\n  The IsoQuant run looks incomplete - check results/dones/ and the"
        + "\n  step's own log under results/isoquant/logs/, then rerun"
        + " run_isoquant.sh."
    )


def run_build(root: str, *, name: str | None = None,
              max_unexpressed_per_gene: int = 0,
              skip_upstream: bool = False,
              annotation_cache: bool = True,
              verbose: bool = True) -> BuildResult:
    log = B.BuildLog(verbose)
    checks = B.Checks()
    res = BuildResult()
    res.log = log
    t0 = time.time()

    log.step(f"Discovering run under {root}")
    rp: RunPaths = discover(root, name)
    log(f"  run '{rp.name}', group token '{rp.group_token}', "
        f"{len(rp.files)} inputs found")
    if rp.missing:
        log(f"  absent: {', '.join(rp.missing)}")
    if rp.upstream_root:
        log(f"  upstream BaseCode results: {rp.upstream_root} "
            f"({len(rp.upstream)} artefacts)")
    else:
        log("  upstream BaseCode results: not detected — library QC unavailable")

    _require_all(rp)

    samples = ex.samples_from_matrix(rp.require("gene_grouped_counts"))
    log(f"  samples ({len(samples)}): {', '.join(samples)}")

    log.step("Reading per-molecule assignments")
    mt = asg.load_molecules(rp.require("read_assignments"), log=log)
    model_reads = asg.load_model_reads(rp.require("model_reads"), mt, log=log)
    mt.drop_index()

    strict_fl = None
    recon = None
    if not skip_upstream and rp.upstream.get("recon_stats"):
        log.step("Reading upstream reconstruction stats")
        recon = up_mod.load_recon_stats(rp.upstream["recon_stats"], log=log)
        if recon is not None and recon.has_strict_fl():
            strict_fl = up_mod.strict_fl_for(recon, mt.key1, mt.key2)
            log(f"    strict full-length flags joined for "
                f"{int(strict_fl.sum()):,} molecules")

    log.step("Reading expression tables")
    ref_gene_agg = ex.load_aggregate(rp.require("gene_counts"), rp.require("gene_tpm"))
    ref_tx_agg = ex.load_aggregate(rp.require("transcript_counts"), rp.require("transcript_tpm"))
    ref_gc, ref_gt = ex.load_pair(rp.require("gene_grouped_counts"),
                                  rp.require("gene_grouped_tpm"))
    ref_tc, ref_tt = ex.load_pair(rp.require("transcript_grouped_counts"),
                                  rp.require("transcript_grouped_tpm"))
    disc_gene_agg = ex.load_aggregate(rp.require("disc_gene_counts"), rp.require("disc_gene_tpm"))
    disc_tx_agg = ex.load_aggregate(rp.require("disc_transcript_counts"),
                                    rp.require("disc_transcript_tpm"))
    disc_gc, disc_gt = ex.load_pair(rp.require("disc_gene_grouped_counts"),
                                    rp.require("disc_gene_grouped_tpm"))
    disc_tc, disc_tt = ex.load_pair(rp.require("disc_transcript_grouped_counts"),
                                    rp.require("disc_transcript_grouped_tpm"))
    log(f"  reference: {ref_gene_agg.n_features:,} annotated genes, "
        f"{ref_tx_agg.n_features:,} annotated transcripts; "
        f"{ref_gc.n:,} / {ref_tc.n:,} detected")
    log(f"  discovery: {disc_gc.n:,} model genes, {disc_tc.n:,} models detected")

    log.step("Reading reference annotation DB")
    annotation = ann_mod.load(rp.require("genedb"), use_cache=annotation_cache,
                              log=log)

    log.step("Reading discovered transcript models")
    models = mod_mod.load(rp.require("models_gtf"), log=log)

    log.step("Reading per-variant support")
    ref_support = sup_mod.load(rp.require("ref_support"), log=log)
    disc_support = sup_mod.load(rp.require("disc_support"), log=log)
    support_summary = sup_mod.parse_summary(rp.require("support_summary"))

    log.step("Reading SQANTI-like classification")
    sqanti = sqanti_mod.load(rp.require("sqanti"), log=log)

    log.step("Reading exon / intron usage")
    features = feat_mod.load_summary(rp.get("exon_counts"), rp.get("intron_counts"), log=log)

    log.step("Aggregating molecules and reads per feature")
    ref_gene_mol = B.gene_molecule_totals(mt)
    ref_gene_outcome = B.gene_outcome_totals(mt)
    ref_tx_mol = B.ref_tx_molecule_totals(mt)
    log(f"    reference: {len(ref_gene_mol):,} genes, {len(ref_tx_mol):,} "
        f"resolved isoforms")

    log.step("Splitting molecules and reads per sample")
    ref_gene_mol_ps = B.per_sample_feature_totals(
        mt.gene, list(mt.gene_values), mt, samples)
    ref_gene_outcome_ps = B.gene_outcome_totals_per_sample(mt, samples)
    ref_tx_mol_ps = B.ref_tx_molecule_totals_per_sample(mt, samples)
    log(f"    per-sample: {len(ref_gene_mol_ps):,} genes"
        + (f", {len(ref_tx_mol_ps):,} isoforms" if ref_tx_mol_ps else ""))
    disc_tx_mol, disc_gene_mol, disc_tx_uniq, disc_pair_stats = B.disc_molecule_totals(
        model_reads, mt, {t: r["gene"] for t, r in models.tx.items()}, log)

    log.step("Building reference mode")
    quantified_genes = list(ref_gc.ids)
    quantified_set = set(quantified_genes)
    support_gene_of = dict(zip(ref_support.ids,
                               ref_support.cols.get("gene_id", [])))
    extra: list[str] = []
    seen = set(quantified_set)
    for gid in ref_gene_mol:
        if gid and gid not in seen and gid in annotation.genes:
            seen.add(gid)
            extra.append(gid)
    for gid in support_gene_of.values():
        if gid and gid not in seen and gid in annotation.genes:
            seen.add(gid)
            extra.append(gid)
    ref_gene_ids = quantified_genes + sorted(extra)
    log(f"  gene universe: {len(quantified_genes):,} quantified + "
        f"{len(extra):,} with read evidence only = {len(ref_gene_ids):,}")

    ref_detected_tx = set(ref_tc.ids)
    ref_supported_tx: dict[str, set[str]] = defaultdict(set)
    for tid, gid in zip(ref_support.ids, support_gene_of.values()):
        if gid:
            ref_supported_tx[gid].add(tid)

    ref_tx_by_gene: dict[str, list[str]] = {}
    for gid in ref_gene_ids:
        annotated = annotation.tx_by_gene.get(gid, [])
        supported = ref_supported_tx.get(gid, set())
        keep, rest = [], []
        for t in annotated:
            (keep if (t in ref_detected_tx or t in supported) else rest).append(t)
        ref_tx_by_gene[gid] = (keep + rest[:max_unexpressed_per_gene]
                               if max_unexpressed_per_gene > 0 else keep)
    ref_all_tx = [t for g in ref_gene_ids for t in ref_tx_by_gene[g]]

    ref_tx_set = set(ref_all_tx)
    covered = sum(1 for tid in ref_support.ids if tid in ref_tx_set)
    log(f"  support isoforms represented: {covered:,}/{ref_support.n:,}")

    log(f"  fetching exon structures for {len(ref_all_tx):,} transcripts")
    ref_exons = ann_mod.load_exons(rp.require("genedb"), ref_all_tx, log=log)
    ref_cds = ann_mod.load_cds_bounds(rp.require("genedb"), ref_all_tx)

    ref_mb = B.build_mode(
        key="ref", label="Reference",
        gene_ids=ref_gene_ids,
        gene_meta=annotation.genes,
        gene_counts=ref_gc.reindex(ref_gene_ids),
        gene_tpm=ref_gt.reindex(ref_gene_ids),
        tx_by_gene=ref_tx_by_gene, tx_meta=annotation.tx,
        tx_counts_mat=ref_tc, tx_tpm_mat=ref_tt,
        exons=ref_exons, cds=ref_cds,
        samples=samples,
        gene_mol=ref_gene_mol, gene_outcome=ref_gene_outcome, tx_mol=ref_tx_mol,
        support=ref_support, log=log,
        quantified=quantified_set,
        annotated_tx=annotation.tx_by_gene,
        gene_mol_ps=ref_gene_mol_ps, tx_mol_ps=ref_tx_mol_ps,
        gene_outcome_ps=ref_gene_outcome_ps)

    log.step("Building discovery mode")
    disc_gene_ids = list(disc_gc.ids)
    disc_tx_by_gene = {g: sorted(models.tx_by_gene.get(g, [])) for g in disc_gene_ids}
    disc_mb = B.build_mode(
        key="disc", label="Discovery",
        gene_ids=disc_gene_ids,
        gene_meta=models.genes,
        gene_counts=disc_gc.values, gene_tpm=disc_gt.values,
        tx_by_gene=disc_tx_by_gene, tx_meta=models.tx,
        tx_counts_mat=disc_tc, tx_tpm_mat=disc_tt,
        exons=models.exons, cds=models.cds,
        samples=samples,
        gene_mol=disc_gene_mol, tx_mol=disc_tx_mol,
        support=disc_support, log=log, tx_mol_unique=disc_tx_uniq,
        annotated_tx=annotation.tx_by_gene)

    log.step("Linking the two modes")
    cross = _cross_mode(ref_gene_ids, annotation.genes, disc_gene_ids, models.genes, log)

    log.step("Building assignment QC")
    assignment_qc = B.build_assignment_qc(mt, samples, strict_fl, log)
    ql_aligned = (up_mod.lengths_aligned_to(recon, mt.key1, mt.key2)
                  if recon else None)
    assignment_qc["end_cube"] = asg.end_support_cube(mt, annotation.genes,
                                                     ql=ql_aligned)
    log(f"    end-support cube: {assignment_qc['end_cube']['size']}³ cells "
        f"over TC/IC/FC")
    discovery_qc = B.build_discovery_assignment(
        model_reads, mt, models, samples, model_reads[2], log)

    log.step("Computing sample-level structure")
    sample_stats = _sample_stats(samples, ref_gt, ref_tt, disc_gt, mt, recon)
    multivariate = {
        "ref": _multivariate(ref_gt.values, samples),
        "disc": _multivariate(disc_gt.values, samples),
    }

    log.step("Assembling core payload")
    library = None
    if not skip_upstream and rp.upstream:
        library = {
            "root": rp.upstream_root,
            "summary_stats": up_mod.load_summary_stats(
                rp.upstream.get("summary_stats", ""), samples),
            "hisat2": up_mod.load_hisat2(rp.upstream["hisat2"])
            if rp.upstream.get("hisat2") else None,
            "conversion": up_mod.load_conversion_summary(
                rp.upstream.get("conversion_summary", ""), samples),
            "read_type": up_mod.load_csv_table(rp.upstream.get("read_type_summary")),
            "mapping_categories": up_mod.load_csv_table(rp.upstream.get("mapping_categories")),
            "mapping_quality": up_mod.load_csv_table(rp.upstream.get("mapping_quality")),
            "recon_status": up_mod.load_csv_table(rp.upstream.get("recon_status_read_type")),
            "tso_capture": up_mod.load_csv_table(rp.upstream.get("tso_capture")),
            "reconstruction": (recon.stats if recon is not None else None),
            "per_sample_molecules": up_mod.per_sample_molecules(recon) if recon else {},
            "molecule_lengths": up_mod.molecule_lengths(recon) if recon else {},
        }
    sample_meta = up_mod.load_samplesheet(
        rp.upstream.get("samplesheet", ""), samples) if rp.upstream else None

    _add_checks(checks, mt, model_reads, recon, ref_gene_agg, ref_tx_agg,
                disc_tx_agg, ref_gc, ref_tc, disc_tc, models, sqanti,
                ref_support, disc_support, disc_pair_stats)
    checks.report(log)

    res.core = B._clean({
        "isoviewer": {
            "version": B.VERSION,
            "built": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        },
        "run": _run_meta(rp),
        "samples": samples,
        "sample_meta": sample_meta,
        "sample_stats": sample_stats,
        "library": library,
        "assignment": assignment_qc,
        "discovery_assignment": discovery_qc,
        "modes": {"ref": ref_mb.summary, "disc": disc_mb.summary},
        "universe": {
            "ref": {
                "annotated_genes": ref_gene_agg.n_features,
                "annotated_transcripts": ref_tx_agg.n_features,
                "detected_genes": ref_gc.n,
                "genes_in_scope": len(ref_gene_ids),
                "genes_evidence_only": len(extra),
                "detected_transcripts": ref_tc.n,
                "counted_molecules_gene": int(ref_gc.values.sum()),
                "counted_molecules_transcript": int(ref_tc.values.sum()),
                "counted_molecules_gene_s":
                    [int(v) for v in ref_gc.values.sum(axis=0)],
                "counted_molecules_transcript_s":
                    [int(v) for v in ref_tc.values.sum(axis=0)],
                "counted_samples": list(ref_gc.samples),
                "support_isoforms_represented": covered,
                "gene_residual": ref_gene_agg.meta,
                "transcript_residual": ref_tx_agg.meta,
                "isoforms_with_support": ref_support.n,
                "biotypes_gene": annotation.gene_type_counts,
                "biotypes_transcript": annotation.tx_type_counts,
                "multi_transcript_genes": annotation.n_multi_transcript_genes(),
                "variants_per_gene_hist": annotation.variants_per_gene_histogram(),
            },
            "disc": {
                "model_genes": len(models.genes),
                "models": len(models.tx),
                "detected_models": disc_tc.n,
                "counted_molecules_gene": int(disc_gc.values.sum()),
                "counted_molecules_gene_s":
                    [int(v) for v in disc_gc.values.sum(axis=0)],
                "counted_samples": list(disc_gc.samples),
                "counted_molecules_transcript": int(disc_tc.values.sum()),
                "counted_molecules_transcript_s":
                    [int(v) for v in disc_tc.values.sum(axis=0)],
                "gene_residual": disc_gene_agg.meta,
                "transcript_residual": disc_tx_agg.meta,
                "sources": models.source_counts,
                "classes": models.class_counts,
                "models_with_support": disc_support.n,
                "model_reads": disc_pair_stats,
            },
        },
        "support": {
            "summary_text": support_summary.get("text", ""),
            "ref": _support_summary(ref_support, "ref"),
            "disc": _support_summary(disc_support, "disc"),
        },
        "sqanti": _sqanti_summary(sqanti),
        "features": features,
        "multivariate": multivariate,
        "cross_mode": cross,
        "checks": checks.items,
        "build_log": log.lines,
    })

    log.step("Encoding blocks")
    res.blocks.append(encode_json_block("core", res.core))
    for mb in (ref_mb, disc_mb):
        res.blocks.append(encode_frame(mb.genes))
        res.blocks.append(encode_frame(mb.tx))
        res.blocks.append(encode_frame(mb.struct))
    res.blocks.append(encode_frame(_sqanti_frame(sqanti)))

    for b in res.blocks:
        log(f"    {b.name:16s} {b.n_rows:>9,} rows  "
            f"{b.raw_bytes / 1e6:7.2f} MB raw -> {b.size / 1e6:6.2f} MB gz")
    log.step(f"Done in {time.time() - t0:.1f}s; payload "
             f"{res.total_bytes / 1e6:.2f} MB compressed")
    return res


def _run_meta(rp: RunPaths) -> dict:
    p = rp.params
    params = []
    for key, label in B.PARAM_LABELS:
        if key in p and p[key] is not None:
            val = p[key]
            if isinstance(val, bool):
                val = "on" if val else "off"
            params.append({"key": key, "label": label, "value": val})

    artefacts = []
    for key, path in sorted(rp.files.items()):
        try:
            artefacts.append({"key": key, "file": os.path.basename(path),
                              "bytes": os.path.getsize(path)})
        except OSError:
            pass

    genedb = rp.get("genedb") or ""
    return {
        "name": rp.name,
        "root": rp.root,
        "isoquant_version": p.get("_version", "unknown"),
        "pipeline_version": rp.manifest.get("version"),
        "pipeline_timestamp": rp.manifest.get("timestamp"),
        "snakemake_cmd": rp.manifest.get("snakemake_cmd"),
        "threads": rp.manifest.get("threads"),
        "command_line": p.get("_cmd_line", ""),
        "versions_log": rp.versions_log,
        "group_token": rp.group_token,
        "read_group": p.get("read_group"),
        "annotation": {
            "genedb": os.path.basename(genedb),
            "collapsed": "collapsed" in os.path.basename(genedb),
            "reference": _tail2(str(p.get("reference", ""))),
            "reference_name": _parent_name(str(p.get("reference", ""))),
            "genedb_path": _tail2(genedb),
            **ann_mod.source_info(genedb),
        },
        "params": params,
        "artefacts": artefacts,
        "missing": rp.missing,
        "upstream_root": rp.upstream_root,
        "has_annotated_bam": rp.has("annotated_bam"),
        "has_mudata": rp.has("h5mu"),
        "mudata": os.path.basename(rp.get("h5mu") or ""),
    }


def _cross_mode(ref_ids, ref_meta, disc_ids, disc_meta, log) -> dict:
    def strip(x: str) -> str:
        return x.split(".")[0]

    disc_by_id = {}
    disc_by_bare = {}
    disc_by_name = {}
    for j, gid in enumerate(disc_ids):
        disc_by_id[gid] = j
        disc_by_bare.setdefault(strip(gid), j)
        nm = (disc_meta.get(gid) or {}).get("name")
        if nm:
            disc_by_name.setdefault(nm, j)

    ref_to_disc: dict[str, int] = {}
    for i, gid in enumerate(ref_ids):
        j = disc_by_id.get(gid)
        if j is None:
            j = disc_by_bare.get(strip(gid))
        if j is None:
            nm = (ref_meta.get(gid) or {}).get("name")
            if nm:
                j = disc_by_name.get(nm)
        if j is not None:
            ref_to_disc[str(i)] = j

    disc_to_ref = {}
    for i_s, j in ref_to_disc.items():
        disc_to_ref.setdefault(str(j), int(i_s))

    log(f"    cross-mode links: {len(ref_to_disc):,} reference genes map into "
        f"discovery ({len(disc_to_ref):,} back)")
    return {"ref_to_disc": ref_to_disc, "disc_to_ref": disc_to_ref}


def _tail2(path: str) -> str:
    if not path:
        return ""
    parts = [q for q in str(path).replace("\\", "/").split("/") if q]
    return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[0] if parts else "")


def _parent_name(path: str) -> str:
    if not path:
        return ""
    parts = [q for q in str(path).replace("\\", "/").split("/") if q]
    return parts[-2] if len(parts) >= 2 else ""


def _support_summary(s: sup_mod.Support, key: str) -> dict:
    if s is None or s.n == 0:
        return {}
    reads = s.get("n_reads").astype(np.float64)
    frac_fl = s.get("frac_full_length").astype(np.float64)
    frac_gap = s.get("frac_gap").astype(np.float64)
    fid = np.asarray(s.ids, dtype=object)
    out = {
        "n_features": s.n,
        "evidence_unit": "assignment rows" if key == "ref" else "molecules",
        "reads": metrics.quantiles(reads),
        "hist_reads": metrics.log_histogram(reads, labels=fid),
        "hist_frac_fl": metrics.histogram(frac_fl, bins=50, lo=0, hi=1,
                                         labels=fid, rank=reads),
        "hist_frac_gap": metrics.histogram(frac_gap, bins=50, lo=0, hi=1,
                                           labels=fid, rank=reads),
        "n_ge2": int((reads >= 2).sum()),
        "n_ge10": int((reads >= 10).sum()),
        "mean_frac_fl": B._finite(frac_fl.mean()),
        "median_frac_fl": B._finite(np.median(frac_fl)),
        "mean_frac_gap": B._finite(frac_gap.mean()),
    }
    ends = {}
    for cat in sup_mod.END_CATS:
        col = f"n_{cat}"
        if s.has(col):
            ends[cat] = int(s.get(col).sum())
    if ends:
        out["ends"] = {
            "values": list(ends),
            "labels": [sup_mod.END_CAT_LABEL[k] for k in ends],
            "counts": [ends[k] for k in ends],
        }
    if s.has("mean_aligned"):
        out["hist_aligned"] = metrics.histogram(
            s.get("mean_aligned").astype(np.float64), bins=60, lo=0)
        out["aligned"] = metrics.quantiles(s.get("mean_aligned").astype(np.float64))
    if key == "ref":
        at = {}
        for t in sup_mod.REF_TYPES:
            col = f"n_{t}"
            if s.has(col):
                at[t] = int(s.get(col).sum())
        if at:
            out["assignment_types"] = {"values": list(at),
                                       "counts": [at[k] for k in at]}
    else:
        if s.has("is_novel"):
            novel = s.get("is_novel").astype(bool)
            out["novel"] = {"novel": int(novel.sum()),
                            "known": int((~novel).sum())}
            out["hist_reads_novel"] = metrics.log_histogram(reads[novel], labels=fid[novel])
            out["hist_reads_known"] = metrics.log_histogram(reads[~novel], labels=fid[~novel])
        if s.has("n_exons"):
            out["hist_exons"] = metrics.histogram(
                s.get("n_exons").astype(np.float64), bins=40, lo=0,
                labels=fid, rank=reads)
        if s.has("model_len"):
            out["hist_model_len"] = metrics.log_histogram(
                s.get("model_len").astype(np.float64), labels=fid, rank=reads)
    return out


def _sqanti_summary(s: sqanti_mod.Sqanti) -> dict:
    if s is None or s.n == 0:
        return {}
    cats = s.category_counts()
    ordered = [c for c in sqanti_mod.STRUCTURAL_ORDER if c in cats]
    ordered += sorted(c for c in cats if c not in sqanti_mod.STRUCTURAL_ORDER)
    out = {
        "n": s.n,
        "populated": sorted(s.populated),
        "hidden": sorted(k for k in s.cols if k not in s.populated),
        "categories": {
            "values": ordered,
            "labels": [sqanti_mod.STRUCTURAL_LABEL.get(c, c) for c in ordered],
            "counts": [cats[c] for c in ordered],
        },
        "events": dict(sorted(s.subcategory_events().items(),
                              key=lambda kv: -kv[1])[:30]),
    }
    if s.has("all_canonical"):
        col = s.get("all_canonical")
        out["all_canonical"] = {
            "True": int((col == "True").sum()),
            "False": int((col == "False").sum()),
        }
    if s.has("RTS_stage"):
        col = s.get("RTS_stage")
        vals, counts = np.unique(col[col != ""], return_counts=True)
        out["rts_stage"] = {str(v): int(c) for v, c in zip(vals, counts)}
    assoc = s.get("associated_gene") if s.has("associated_gene") else None
    def _labels(mask):
        base = np.asarray(assoc if assoc is not None else s.ids, dtype=object)
        if assoc is not None:
            ids_arr = np.asarray(s.ids, dtype=object)
            base = np.array([a if a not in ("", "novel", None) else ids_arr[i]
                             for i, a in enumerate(base)], dtype=object)
        return base[mask]

    for key, bins in (("length", 60), ("exons", 40),
                      ("perc_A_downstream_TTS", 40)):
        if s.has(key):
            col = s.get(key)
            m = np.isfinite(col)
            lab = _labels(m)
            col = col[m]
            out[f"hist_{key}"] = (
                metrics.log_histogram(col, labels=lab) if key == "length"
                else metrics.histogram(col, bins=bins, labels=lab))
    for key in ("diff_to_TSS", "diff_to_TTS"):
        if s.has(key):
            col = s.get(key)
            m = np.isfinite(col)
            lab = _labels(m)
            col = col[m]
            clipped = np.clip(col, -1000, 1000)
            out[f"hist_{key}"] = metrics.histogram(clipped, bins=60,
                                                   lo=-1000, hi=1000,
                                                   labels=lab,
                                                   rank=np.abs(clipped))
            out[f"q_{key}"] = metrics.quantiles(col)
    return out


def _sqanti_frame(s: sqanti_mod.Sqanti) -> "B.Frame":
    from .frame import Frame
    fr = Frame("disc.sqanti", meta={"populated": sorted(s.populated)})
    if s is None or s.n == 0:
        fr.add_text("id", [])
        return fr
    fr.add_text("id", s.ids)
    for key in ("structural_category", "subcategory", "associated_gene",
                "associated_transcript", "all_canonical", "RTS_stage",
                "FSM_class", "coding", "seq_A_downstream_TTS"):
        if s.has(key):
            fr.add_text(key, [str(v) for v in s.get(key)])
    for key in ("length", "exons", "ref_length", "ref_exons", "diff_to_TSS",
                "diff_to_TTS", "diff_to_gene_TSS", "diff_to_gene_TTS",
                "perc_A_downstream_TTS"):
        if s.has(key):
            col = np.nan_to_num(s.get(key), nan=0.0, posinf=0.0, neginf=0.0)
            fr.add(key, col.astype(np.float32))
    return fr


def _sample_stats(samples, ref_gt, ref_tt, disc_gt, mt, recon) -> list[dict]:
    per_sample = {s: {} for s in samples}
    sample_index = {s: i for i, s in enumerate(mt.sample_values)}
    fl = asg.full_length_mask(mt)

    for si, s in enumerate(samples):
        row = per_sample[s]
        gi = ref_gt.samples.index(s) if s in ref_gt.samples else None
        if gi is not None:
            row["ref_genes_detected"] = int((ref_gt.values[:, gi] > 0).sum())
            row["ref_tx_detected"] = int((ref_tt.values[:, gi] > 0).sum())
        di = disc_gt.samples.index(s) if s in disc_gt.samples else None
        if di is not None:
            row["disc_genes_detected"] = int((disc_gt.values[:, di] > 0).sum())

        mi = sample_index.get(s)
        if mi is not None:
            sel = mt.sample == mi
            row["molecules"] = int(sel.sum())
            row["reads"] = int(mt.nr[sel].sum())
            row["molecules_fl"] = int((sel & fl).sum())
            row["reads_per_molecule"] = B._finite(mt.nr[sel].mean()) if sel.any() else 0.0
        if recon is not None:
            rs = up_mod.per_sample_molecules(recon).get(s)
            if rs:
                row.update({f"recon_{k}": v for k, v in rs.items()})
    return [{"sample": s, **per_sample[s]} for s in samples]


def _multivariate(tpm: np.ndarray, samples: list[str], *, n_hvg: int = 2000) -> dict:
    if tpm.shape[0] < 3 or tpm.shape[1] < 2:
        return {"n_samples": len(samples), "available": False}
    lg = np.log2(tpm.astype(np.float64) + 1.0)
    var = lg.var(axis=1)
    order = np.argsort(-var)
    hvg = order[:min(n_hvg, len(order))]
    return {
        "available": True,
        "n_samples": len(samples),
        "n_features": int(tpm.shape[0]),
        "n_hvg": int(len(hvg)),
        "correlation_all": metrics.correlation(lg),
        "correlation_hvg": metrics.correlation(lg[hvg]),
        "pca": metrics.pca(lg[hvg]),
        "hvg_index": hvg.astype(int).tolist(),
    }


def _add_checks(checks: B.Checks, mt, model_reads, recon, ref_gene_agg,
                ref_tx_agg, disc_tx_agg, ref_gc, ref_tc, disc_tc, models,
                sqanti, ref_support, disc_support, disc_pair_stats) -> None:
    n_mol = mt.stats["n_molecules"]
    if recon is not None:
        checks.add_subset("molecules: read_assignments vs reconstruction stats",
                          recon.stats["n_molecules"], n_mol,
                          note="reconstruction stats include molecules IsoQuant "
                               "did not assign")

    ni = mt.assign_values.index("noninformative") if "noninformative" in mt.assign_values else None
    ig = mt.assign_values.index("intergenic") if "intergenic" in mt.assign_values else None
    if ni is not None:
        mol = asg.crosstab(mt, mt.assign, len(mt.assign_values), weight="mol")
        no_gene = int(mol[ni]) + (int(mol[ig]) if ig is not None else 0)
        checks.add("gene __no_feature vs molecules with no gene",
                   int(ref_gene_agg.meta.get("__no_feature", {}).get("count", 0)),
                   no_gene, tolerance=1)
        amb = mt.assign_values.index("ambiguous") if "ambiguous" in mt.assign_values else None
        if amb is not None:
            checks.add("transcript __ambiguous vs ambiguous molecules",
                       int(ref_tx_agg.meta.get("__ambiguous", {}).get("count", 0)),
                       int(mol[amb]),
                       tolerance=max(2, int(mt.stats.get("split_molecules_merged", 0))),
                       note="a molecule resolved in one locus and ambiguous in "
                            "another counts as resolved here")

    checks.add("discovered __no_feature vs '*' rows in transcript_model_reads",
               int(disc_tx_agg.meta.get("__no_feature", {}).get("count", 0)),
               model_reads[2])
    split = int(mt.stats.get("split_molecules_merged", 0))
    checks.add("discovered __ambiguous vs molecules on more than one model",
               int(disc_tx_agg.meta.get("__ambiguous", {}).get("count", 0)),
               disc_pair_stats["multi_model_molecules"],
               tolerance=max(2, split),
               note="residual traces to molecules whose rows IsoQuant wrote in "
                    "more than one place")

    nz_g = sum(1 for v in ref_gene_agg.counts.values() if v > 0)
    checks.add("genes with count > 0 vs grouped matrix rows", nz_g, ref_gc.n)
    nz_t = sum(1 for v in ref_tx_agg.counts.values() if v > 0)
    checks.add("transcripts with count > 0 vs grouped matrix rows", nz_t, ref_tc.n)
    nz_d = sum(1 for v in disc_tx_agg.counts.values() if v > 0)
    checks.add("models with count > 0 vs grouped matrix rows", nz_d, disc_tc.n)

    checks.add("novel models in GTF vs SQANTI rows",
               models.source_counts.get("IsoQuant", 0), sqanti.n)
    checks.add("models in GTF vs discovered support rows",
               len(models.tx), disc_support.n)
    if disc_support.has("is_novel"):
        checks.add("novel models in support vs SQANTI rows",
                   int(disc_support.get("is_novel").astype(bool).sum()), sqanti.n)
