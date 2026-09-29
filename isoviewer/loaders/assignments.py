from __future__ import annotations

import contextlib
import gzip
import io
import os
import shutil
import subprocess
import time
from array import array
from collections import defaultdict

import numpy as np

from .keys import KeyIndex, fingerprint, sort_keys

RESOLVED = ("unique", "unique_minor_difference")
GENE_ONLY = ("ambiguous", "inconsistent", "inconsistent_non_intronic",
             "inconsistent_ambiguous")
NO_GENE = ("noninformative", "intergenic")

ASSIGN_ORDER = RESOLVED + GENE_ONLY + NO_GENE
OUTCOME_OF = (
    {t: "resolved" for t in RESOLVED}
    | {t: "gene_only" for t in GENE_ONLY}
    | {t: "no_gene" for t in NO_GENE}
)

PRIORITY = {t: i for i, t in enumerate(
    ("unique", "unique_minor_difference", "ambiguous", "inconsistent_ambiguous",
     "inconsistent_non_intronic", "inconsistent", "noninformative", "intergenic")
)}

AD_ORDER = ("none", "polya", "gap", "gap+polya")


class MoleculeTable:
    __slots__ = ("n", "key1", "key2", "sample", "assign", "classification",
                 "gene", "iso", "nr", "tc", "ic", "fc", "er", "ir", "ad", "polya",
                 "n_rows",
                 "n_genes",
                 "assign_values", "class_values", "ad_values", "sample_values",
                 "gene_values", "iso_values", "stats", "split", "_index")

    def __init__(self) -> None:
        self.stats: dict = {}
        self._index = None

    def index(self) -> KeyIndex:
        if self._index is None:
            self._index = KeyIndex(self.key1, self.key2)
        return self._index

    def drop_index(self) -> None:
        self._index = None


def _majority(counts: dict[str, int], order: list[str]) -> str:
    best, best_n = "", -1
    for k in order:
        n = counts.get(k, 0)
        if n > best_n:
            best_n, best = n, k
    return best


class _Interner:
    __slots__ = ("codes", "values")

    def __init__(self) -> None:
        self.codes: dict[str, int] = {}
        self.values: list[str] = []

    def __call__(self, s: str) -> int:
        c = self.codes.get(s)
        if c is None:
            c = len(self.values)
            self.codes[s] = c
            self.values.append(s)
        return c


def _parse_info(info: str) -> tuple[str, int, int, int, int, int, int, str, int]:
    cls = ad = ""
    nr = tc = ic = fc = er = ir = 0
    polya = 0
    for item in info.split(";"):
        eq = item.find("=")
        if eq < 0:
            continue
        key = item[:eq].strip()
        val = item[eq + 1:].strip()
        if key == "NR":
            nr = int(val or 0)
        elif key == "TC":
            tc = int(val or 0)
        elif key == "IC":
            ic = int(val or 0)
        elif key == "FC":
            fc = int(val or 0)
        elif key == "ER":
            er = int(val or 0)
        elif key == "IR":
            ir = int(val or 0)
        elif key == "AD":
            ad = val
        elif key == "Classification":
            cls = val
        elif key == "PolyA":
            polya = 1 if val == "True" else 0
    return cls, nr, tc, ic, fc, er, ir, ad, polya


_FP_BATCH = 1 << 20


@contextlib.contextmanager
def _open_gz_text(path: str):
    pigz = shutil.which("pigz")
    if not pigz:
        with gzip.open(path, "rt") as fh:
            yield fh
        return
    proc = subprocess.Popen([pigz, "-dc", path], stdout=subprocess.PIPE)
    done = False
    try:
        with io.TextIOWrapper(proc.stdout) as fh:
            yield fh
        done = True
    finally:
        if not done:
            proc.kill()
        proc.wait()
    if proc.returncode != 0:
        raise OSError(f"pigz failed on {path} (exit {proc.returncode})")


def load_molecules(path: str, *, log=print, progress_every: int = 20_000_000) -> MoleculeTable:
    t0 = time.time()
    itn_sample = _Interner()
    itn_assign = _Interner()
    itn_class = _Interner()
    itn_ad = _Interner()
    itn_gene = _Interner()
    itn_iso = _Interner()
    itn_multi = _Interner()

    names: list[str] = []
    key1 = array("Q")
    key2 = array("Q")
    sample_c = array("I")
    assign_c = array("I")
    class_c = array("I")
    ad_c = array("I")
    gene_c = array("I")
    iso_c = array("I")
    nr_l = array("I")
    tc_l = array("I")
    ic_l = array("I")
    fc_l = array("I")
    er_l = array("I")
    ir_l = array("I")
    polya_l = array("B")
    nrows_l = array("I")
    ngene_l = array("B")
    pri_l = array("B")
    multi_at = array("Q")
    multi_start = array("Q", [0])
    multi_codes = array("I")

    cur_read: str | None = None
    cur_best_pri = 99
    cur_assign = ""
    cur_gene = ""
    cur_iso = ""
    cur_sample = ""
    cur_nr = cur_tc = cur_ic = cur_fc = cur_er = cur_ir = 0
    cur_ad = ""
    cur_polya = 0
    cur_rows = 0
    cur_gene_set: set[str] = set()
    cls_counts: dict[str, int] = {}
    cls_order: list[str] = []

    n_rows = 0
    n_cls_disagree = 0

    def fp_flush() -> None:
        if names:
            a, b = fingerprint(names)
            key1.frombytes(a.tobytes())
            key2.frombytes(b.tobytes())
            names.clear()

    def flush() -> None:
        nonlocal n_cls_disagree
        if cur_read is None:
            return
        names.append(cur_read)
        if len(names) >= _FP_BATCH:
            fp_flush()
        pri_l.append(cur_best_pri)
        sample_c.append(itn_sample(cur_sample))
        assign_c.append(itn_assign(cur_assign))
        cls = _majority(cls_counts, cls_order) if cls_counts else ""
        if len(cls_counts) > 1:
            n_cls_disagree += 1
        class_c.append(itn_class(cls))
        ad_c.append(itn_ad(cur_ad))
        gene_c.append(itn_gene(cur_gene))
        ngene_l.append(min(len(cur_gene_set), 255))
        if len(cur_gene_set) > 1:
            multi_at.append(len(pri_l) - 1)
            for g in cur_gene_set:
                multi_codes.append(itn_multi(g))
            multi_start.append(len(multi_codes))
        iso_c.append(itn_iso(cur_iso))
        nr_l.append(cur_nr)
        tc_l.append(cur_tc)
        ic_l.append(cur_ic)
        fc_l.append(cur_fc)
        er_l.append(cur_er)
        ir_l.append(cur_ir)
        polya_l.append(cur_polya)
        nrows_l.append(cur_rows)

    with _open_gz_text(path) as fh:
        for line in fh:
            if line[0] == "#":
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 9:
                continue
            if parts[0] == "read_id":
                continue
            n_rows += 1
            if progress_every and n_rows % progress_every == 0:
                log(f"    {n_rows:,} rows, {len(pri_l):,} molecules "
                    f"({time.time() - t0:.0f}s)")

            rid = parts[0]
            iso = parts[3]
            gene = parts[4]
            atype = parts[5]
            info = parts[8]
            group = parts[9] if len(parts) > 9 else ""

            if rid != cur_read:
                flush()
                cur_read = rid
                cur_best_pri = 99
                cur_gene_set = set()
                cur_assign = atype
                cur_gene = ""
                cur_iso = ""
                cur_sample = group
                cur_rows = 0
                cls_counts = {}
                cls_order = []
                cls, nr, tc, ic, fc, er, ir, ad, polya = _parse_info(info)
                cur_nr, cur_tc, cur_ic, cur_fc = nr, tc, ic, fc
                cur_er, cur_ir, cur_ad, cur_polya = er, ir, ad, polya
            else:
                cls = _row_class(info)

            cur_rows += 1
            if cls:
                if cls not in cls_counts:
                    cls_order.append(cls)
                cls_counts[cls] = cls_counts.get(cls, 0) + 1

            if gene != ".":
                cur_gene_set.add(gene)

            pri = PRIORITY.get(atype, 90)
            if pri < cur_best_pri:
                cur_best_pri = pri
                cur_assign = atype
                cur_gene = "" if gene == "." else gene
                cur_iso = "" if iso == "." else iso

    flush()
    fp_flush()

    k1 = np.frombuffer(key1, dtype=np.uint64)
    k2 = np.frombuffer(key2, dtype=np.uint64)
    multi = (np.frombuffer(multi_at, dtype=np.uint64),
             np.frombuffer(multi_start, dtype=np.uint64),
             np.frombuffer(multi_codes, dtype=np.uint32))
    keep, n_merged, winners = _merge_split(k1, k2, pri_l, nrows_l,
                                           gene_c, ngene_l, multi)
    if n_merged:
        log(f"    {n_merged:,} molecules had non-contiguous rows; fragments merged")

    def col(buf, dtype):
        arr = np.frombuffer(buf, dtype=buf.typecode)
        if keep is not None:
            arr = arr[keep]
        return arr.astype(dtype)

    n_frag = len(pri_l)
    mt = MoleculeTable()
    mt.key1 = k1.copy() if keep is None else k1[keep]
    mt.key2 = k2.copy() if keep is None else k2[keep]
    del k1, k2, key1, key2, multi, multi_at, multi_start, multi_codes
    mt.iso = col(iso_c, np.uint32)
    del iso_c
    mt.sample = col(sample_c, np.uint16)
    mt.assign = col(assign_c, np.uint8)
    mt.classification = col(class_c, np.uint8)
    mt.ad = col(ad_c, np.uint8)
    mt.gene = col(gene_c, np.uint32)
    del sample_c, assign_c, class_c, ad_c, gene_c
    mt.nr = col(nr_l, np.uint32)
    mt.tc = col(tc_l, np.uint32)
    mt.ic = col(ic_l, np.uint32)
    mt.fc = col(fc_l, np.uint32)
    mt.er = col(er_l, np.uint32)
    mt.ir = col(ir_l, np.uint32)
    del nr_l, tc_l, ic_l, fc_l, er_l, ir_l
    mt.polya = col(polya_l, np.uint8)
    mt.n_genes = col(ngene_l, np.uint8)
    mt.n_rows = col(nrows_l, np.uint16)
    mt.sample_values = itn_sample.values
    mt.assign_values = itn_assign.values
    mt.class_values = itn_class.values
    mt.ad_values = itn_ad.values
    mt.gene_values = itn_gene.values
    mt.iso_values = itn_iso.values
    mt.n = n_frag if keep is None else int(keep.size)
    split = np.zeros(n_frag, dtype=bool)
    if winners:
        split[np.asarray(winners, dtype=np.int64)] = True
    mt.split = split if keep is None else split[keep]

    n_mol = mt.n
    mt.stats = {
        "source": os.path.basename(path),
        "n_rows": n_rows,
        "n_molecules": n_mol,
        "rows_per_molecule": n_rows / n_mol if n_mol else 0.0,
        "classification_disagree": n_cls_disagree,
        "split_molecules_merged": n_merged,
        "n_reads": int(mt.nr.sum()),
        "elapsed_s": round(time.time() - t0, 1),
    }
    log(f"    {n_rows:,} rows -> {n_mol:,} molecules, "
        f"{mt.stats['n_reads']:,} reads ({mt.stats['elapsed_s']}s)")
    if n_cls_disagree:
        log(f"    {n_cls_disagree:,} molecules "
            f"({100 * n_cls_disagree / max(n_mol, 1):.2f}%) had disagreeing "
            f"Classification across rows; majority applied")
    return mt


def _merge_split(k1: np.ndarray, k2: np.ndarray, pri, nrows, gene_c=None,
                 ngene=None, multi=None):
    n = k1.size
    if n == 0:
        return None, 0, []
    order = sort_keys(k1, k2)
    s1 = k1[order]
    s2 = k2[order]
    dup = np.flatnonzero((s1[1:] == s1[:-1]) & (s2[1:] == s2[:-1]))
    del s1, s2
    if dup.size == 0:
        return None, 0, []

    if multi is not None and multi[0].size:
        m_at, m_start, m_codes = multi
    else:
        m_at = None

    drop: list[int] = []
    winners: list[int] = []
    n_merged = 0
    i = 0
    while i < dup.size:
        j = i
        while j + 1 < dup.size and dup[j + 1] == dup[j] + 1:
            j += 1
        group = [int(k) for k in order[dup[i]: dup[j] + 2]]
        i = j + 1

        winner = min(group, key=lambda k: (pri[k], -nrows[k]))
        winners.append(winner)
        total = sum(nrows[k] for k in group)
        nrows[winner] = min(total, 0xFFFF)
        if ngene is not None and gene_c is not None:
            seen = set()
            for k in group:
                at = -1
                if m_at is not None:
                    p = int(np.searchsorted(m_at, k))
                    if p < m_at.size and int(m_at[p]) == k:
                        at = p
                if at >= 0:
                    lo, hi = int(m_start[at]), int(m_start[at + 1])
                    seen.update(("name", int(c)) for c in m_codes[lo:hi])
                elif ngene[k]:
                    seen.add(("code", gene_c[k]))
            ngene[winner] = min(len(seen), 255)
        drop.extend(k for k in group if k != winner)
        n_merged += 1

    mask = np.ones(n, dtype=bool)
    mask[np.asarray(drop, dtype=np.int64)] = False
    return np.flatnonzero(mask), n_merged, winners


def _row_class(info: str) -> str:
    i = info.find("Classification=")
    if i < 0:
        return ""
    j = info.find(";", i)
    return info[i + 15: j if j >= 0 else len(info)].strip()


def load_model_reads(path: str, mt: MoleculeTable, *, log=print) -> tuple:
    t0 = time.time()
    itn_model = _Interner()
    names: list[str] = []
    mol = array("q")
    model = array("I")
    extra: dict[tuple[int, int], int] = {}
    idx = mt.index()
    n_star = 0

    def fp_flush() -> None:
        if not names:
            return
        a, b = fingerprint(names)
        names.clear()
        pos = idx.lookup(a, b)
        for i in np.flatnonzero(pos < 0):
            key = (int(a[i]), int(b[i]))
            e = extra.get(key)
            if e is None:
                e = extra[key] = mt.n + len(extra)
            pos[i] = e
        mol.frombytes(pos.tobytes())

    with _open_gz_text(path) as fh:
        for line in fh:
            if line[0] == "#":
                continue
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2 or parts[0] == "read_id":
                continue
            if parts[1] == "*":
                n_star += 1
                continue
            names.append(parts[0])
            model.append(itn_model(parts[1]))
            if len(names) >= _FP_BATCH:
                fp_flush()
    fp_flush()

    mol_a = np.frombuffer(mol, dtype=np.int64)
    model_a = np.frombuffer(model, dtype=np.uint32)
    n_dup = 0
    if mt.split.any() and mol_a.size:
        in_mt = np.flatnonzero(mol_a < mt.n)
        cand = in_mt[mt.split[mol_a[in_mt]]]
        if cand.size:
            key = mol_a[cand] * len(itn_model.values) + model_a[cand]
            _, first = np.unique(key, return_index=True)
            dup = np.ones(cand.size, dtype=bool)
            dup[first] = False
            n_dup = int(dup.sum())
            if n_dup:
                keep = np.ones(mol_a.size, dtype=bool)
                keep[cand[dup]] = False
                mol_a = mol_a[keep]
                model_a = model_a[keep]
    log(f"    {mol_a.size + n_star:,} rows, {mol_a.size:,} (molecule, model) pairs, "
        f"{n_star:,} unassigned"
        + (f", {n_dup:,} repeated pairs dropped" if n_dup else "")
        + f" ({time.time() - t0:.0f}s)")
    return mol_a, model_a, n_star, n_dup, itn_model.values, len(extra)


def _weights(mt: MoleculeTable, weight: str) -> np.ndarray:
    if weight == "read":
        return mt.nr.astype(np.int64)
    return np.ones(mt.n, dtype=np.int64)


def full_length_mask(mt: MoleculeTable) -> np.ndarray:
    return (mt.tc > 0) & (mt.fc > 0)


def crosstab(mt: MoleculeTable, codes: np.ndarray, n_values: int,
             *, weight: str, mask: np.ndarray | None = None) -> np.ndarray:
    w = _weights(mt, weight)
    if mask is not None:
        w = np.where(mask, w, 0)
    return np.bincount(codes, weights=w, minlength=n_values).astype(np.int64)


def crosstab_2d(mt: MoleculeTable, rows: np.ndarray, n_rows: int,
                cols: np.ndarray, n_cols: int,
                *, weight: str, mask: np.ndarray | None = None) -> np.ndarray:
    w = _weights(mt, weight)
    if mask is not None:
        w = np.where(mask, w, 0)
    flat = rows.astype(np.int64) * n_cols + cols.astype(np.int64)
    return (np.bincount(flat, weights=w, minlength=n_rows * n_cols)
            .astype(np.int64).reshape(n_rows, n_cols))


def per_gene_totals(mt: MoleculeTable,
                    mask: np.ndarray | None = None) -> dict[str, np.ndarray]:
    n_g = len(mt.gene_values)
    fl = full_length_mask(mt)
    keep = None if mask is None else np.asarray(mask, dtype=bool)
    outcome = np.asarray(
        [OUTCOME_OF.get(v, "no_gene") for v in mt.assign_values]
    )
    out_code = {"resolved": 0, "gene_only": 1, "no_gene": 2}
    per_assign_outcome = np.asarray([out_code[o] for o in outcome], dtype=np.uint8)
    mol_outcome = per_assign_outcome[mt.assign]

    ones = np.ones(n_g, dtype=np.int64)
    del ones

    res: dict[str, np.ndarray] = {}
    for weight, tag in (("mol", "mol"), ("read", "read")):
        w = _weights(mt, weight)
        if keep is not None:
            w = np.where(keep, w, 0)
        res[f"{tag}_total"] = np.bincount(mt.gene, weights=w, minlength=n_g).astype(np.int64)
        res[f"{tag}_fl"] = np.bincount(mt.gene, weights=np.where(fl, w, 0),
                                       minlength=n_g).astype(np.int64)
        for name, code in out_code.items():
            sel = mol_outcome == code
            res[f"{tag}_{name}"] = np.bincount(
                mt.gene, weights=np.where(sel, w, 0), minlength=n_g
            ).astype(np.int64)
    return res


def per_feature_totals(keys: np.ndarray, n_keys: int, mt: MoleculeTable,
                       sel: np.ndarray) -> dict[str, np.ndarray]:
    fl = full_length_mask(mt)
    w1 = np.where(sel, 1, 0).astype(np.int64)
    wr = np.where(sel, mt.nr, 0).astype(np.int64)
    return {
        "mol": np.bincount(keys, weights=w1, minlength=n_keys).astype(np.int64),
        "mol_fl": np.bincount(keys, weights=np.where(fl, w1, 0),
                              minlength=n_keys).astype(np.int64),
        "read": np.bincount(keys, weights=wr, minlength=n_keys).astype(np.int64),
        "read_fl": np.bincount(keys, weights=np.where(fl, wr, 0),
                               minlength=n_keys).astype(np.int64),
    }


END_CUBE_CAP = 20

ENDCUBE_MAX_SAMPLES = 16

_TRIPLE_MAX_SAMPLES = 12


def end_support_cube(mt: MoleculeTable, gene_meta: dict | None = None,
                     ql: np.ndarray | None = None) -> dict:
    cap = END_CUBE_CAP
    s = cap + 1
    tc = np.minimum(mt.tc, cap).astype(np.int64)
    ic = np.minimum(mt.ic, cap).astype(np.int64)
    fc = np.minimum(mt.fc, cap).astype(np.int64)
    flat = tc * s * s + ic * s + fc
    mol = np.bincount(flat, minlength=s ** 3).astype(np.int64)
    read = np.bincount(flat, weights=mt.nr.astype(np.int64),
                       minlength=s ** 3).astype(np.int64)
    out = {
        "cap": cap,
        "size": s,
        "molecules": mol.tolist(),
        "reads": read.tolist(),
        "total_molecules": int(mol.sum()),
        "total_reads": int(read.sum()),
        "marginals": _end_marginals(mt, gene_meta),
        "triples": _end_triples(mt, ql),
        "note": f"3′, internal and 5′ read counts above {cap} are "
                f"pooled into the {cap} bin, so a threshold of {cap} means "
                f"'{cap} or more'.",
    }

    good = None
    if ql is not None and len(ql) == len(flat):
        good = np.isfinite(ql) & (ql > 0)
        qsum = np.bincount(flat[good], weights=ql[good].astype(np.float64),
                           minlength=s ** 3)
        qn = np.bincount(flat[good], minlength=s ** 3).astype(np.int64)
        out["ql_sum"] = [int(round(v)) for v in qsum]
        out["ql_n"] = qn.tolist()

    if mt.sample is not None and getattr(mt, "sample_values", None) \
            and len(mt.sample_values) <= ENDCUBE_MAX_SAMPLES:
        names, mols, reads, qsums, qns = [], [], [], [], []
        for si, sname in enumerate(mt.sample_values):
            sel = mt.sample == si
            if not sel.any():
                continue
            f = flat[sel]
            names.append(str(sname))
            mols.append(np.bincount(f, minlength=s ** 3).astype(np.int64).tolist())
            reads.append(np.bincount(f, weights=mt.nr[sel].astype(np.int64),
                                     minlength=s ** 3).astype(np.int64).tolist())
            if good is not None:
                g = sel & good
                qsums.append([int(round(v)) for v in np.bincount(
                    flat[g], weights=ql[g].astype(np.float64), minlength=s ** 3)])
                qns.append(np.bincount(flat[g], minlength=s ** 3)
                           .astype(np.int64).tolist())
        block = {"samples": names, "molecules": mols, "reads": reads}
        if qsums:
            block["ql_sum"] = qsums
            block["ql_n"] = qns
        out["per_sample"] = block
    return out


_TRIPLE_MAX = 400_000


def _end_triples(mt: MoleculeTable, ql: np.ndarray | None = None) -> dict:
    tc = mt.tc.astype(np.int64)
    ic = mt.ic.astype(np.int64)
    fc = mt.fc.astype(np.int64)
    key = (tc << np.int64(42)) | (ic << np.int64(21)) | fc
    uniq, inv = np.unique(key, return_inverse=True)
    mol = np.bincount(inv, minlength=uniq.size).astype(np.int64)
    read = np.bincount(inv, weights=mt.nr.astype(np.float64),
                       minlength=uniq.size).astype(np.int64)
    utc = (uniq >> np.int64(42)).astype(np.int64)
    uic = ((uniq >> np.int64(21)) & np.int64((1 << 21) - 1)).astype(np.int64)
    ufc = (uniq & np.int64((1 << 21) - 1)).astype(np.int64)

    qsum = qn = None
    if ql is not None and len(ql) == len(inv):
        good = np.isfinite(ql) & (ql > 0)
        qsum = np.bincount(inv[good], weights=ql[good].astype(np.float64),
                           minlength=uniq.size)
        qn = np.bincount(inv[good], minlength=uniq.size).astype(np.int64)

    per_s = None
    if (mt.sample is not None and getattr(mt, "sample_values", None)
            and len(mt.sample_values) <= _TRIPLE_MAX_SAMPLES):
        names, s_mol, s_read, s_qsum, s_qn = [], [], [], [], []
        for si, sname in enumerate(mt.sample_values):
            sel = mt.sample == si
            if not sel.any():
                continue
            names.append(str(sname))
            iv = inv[sel]
            s_mol.append(np.bincount(iv, minlength=uniq.size).astype(np.int64))
            s_read.append(np.bincount(iv, weights=mt.nr[sel].astype(np.float64),
                                      minlength=uniq.size).astype(np.int64))
            if qsum is not None:
                g = sel & good
                s_qsum.append(np.bincount(inv[g], weights=ql[g].astype(np.float64),
                                          minlength=uniq.size))
                s_qn.append(np.bincount(inv[g], minlength=uniq.size).astype(np.int64))
        per_s = {"samples": names, "molecules": s_mol, "reads": s_read}
        if s_qsum:
            per_s["ql_sum"] = s_qsum
            per_s["ql_n"] = s_qn

    dropped_mol = 0
    if uniq.size > _TRIPLE_MAX:
        order = np.argsort(mol)[::-1][:_TRIPLE_MAX]
        dropped_mol = int(mol.sum() - mol[order].sum())
        utc, uic, ufc, mol, read = (utc[order], uic[order], ufc[order],
                                    mol[order], read[order])
        if qsum is not None:
            qsum, qn = qsum[order], qn[order]
        if per_s is not None:
            per_s["molecules"] = [a[order] for a in per_s["molecules"]]
            per_s["reads"] = [a[order] for a in per_s["reads"]]
            if "ql_sum" in per_s:
                per_s["ql_sum"] = [a[order] for a in per_s["ql_sum"]]
                per_s["ql_n"] = [a[order] for a in per_s["ql_n"]]

    extra = {}
    if qsum is not None:
        extra["ql_sum"] = [int(round(v)) for v in qsum]
        extra["ql_n"] = [int(v) for v in qn]
    if per_s is not None:
        extra["per_sample"] = {
            "samples": per_s["samples"],
            "molecules": [[int(v) for v in a] for a in per_s["molecules"]],
            "reads": [[int(v) for v in a] for a in per_s["reads"]],
        }
        if "ql_sum" in per_s:
            extra["per_sample"]["ql_sum"] = [[int(round(v)) for v in a]
                                             for a in per_s["ql_sum"]]
            extra["per_sample"]["ql_n"] = [[int(v) for v in a] for a in per_s["ql_n"]]
    return {**extra,
        "tc": [int(v) for v in utc],
        "ic": [int(v) for v in uic],
        "fc": [int(v) for v in ufc],
        "molecules": [int(v) for v in mol],
        "reads": [int(v) for v in read],
        "n_combinations": int(uniq.size),
        "dropped_molecules": dropped_mol,
        "max": {"tc": int(tc.max()) if tc.size else 0,
                "ic": int(ic.max()) if ic.size else 0,
                "fc": int(fc.max()) if fc.size else 0},
    }


_MARGINAL_TOP_N = 10

_MARGINAL_EXACT = 20
_MARGINAL_PER_DECADE = 24


def _fold_bins(top: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    v = 0
    while v <= min(top, _MARGINAL_EXACT):
        out.append((v, v))
        v += 1
    step = 10.0 ** (1.0 / _MARGINAL_PER_DECADE)
    while v <= top:
        hi = max(v, int(round(v * step)) - 1)
        if hi > top:
            hi = top
        out.append((v, hi))
        v = hi + 1
    return out


def _end_marginals(mt: MoleculeTable, gene_meta: dict | None = None) -> dict:
    genes = mt.gene_values
    n_g = len(genes)
    drop = {j for j, g in enumerate(genes) if not str(g).strip()}

    def label(gid: str) -> str:
        if gene_meta:
            meta = gene_meta.get(gid) or gene_meta.get(gid.split(".")[0])
            if meta and meta.get("name"):
                return str(meta["name"])
        return gid.split(".")[0]

    fl_mask = (mt.tc > 0) & (mt.fc > 0)
    axes = (("tc", mt.tc), ("ic", mt.ic), ("fc", mt.fc))
    out: dict = {}
    for uni, keep in (("all", None), ("fl", fl_mask)):
        per_axis: dict = {}
        for name, arr in axes:
            vals = arr if keep is None else arr[keep]
            gsel = mt.gene if keep is None else mt.gene[keep]
            nr = mt.nr if keep is None else mt.nr[keep]
            top = int(vals.max()) if vals.size else 0
            bins = []
            for lo, hi in _fold_bins(top):
                sel = (vals >= lo) & (vals <= hi)
                n = int(sel.sum())
                entry = {
                    "lo": lo, "hi": hi, "n": n,
                    "reads": int(nr[sel].sum()) if n else 0,
                    "top": [],
                }
                if n:
                    counts = np.bincount(gsel[sel], minlength=n_g)
                    for j in drop:
                        counts[j] = 0
                    take = min(_MARGINAL_TOP_N, max(1, n_g - 1))
                    idx = np.argpartition(counts, -take)[-take:]
                    idx = idx[counts[idx] > 0]
                    idx = idx[np.argsort(-counts[idx])]
                    entry["top"] = [[label(str(genes[k])), int(counts[k])]
                                    for k in idx]
                bins.append(entry)
            per_axis[name] = {"max": top, "bins": bins}
        out[uni] = per_axis
    return out


def adaptation_summary(mt: MoleculeTable) -> dict:
    n_ad = len(mt.ad_values)
    mol = np.bincount(mt.ad, minlength=n_ad).astype(np.int64)
    read = np.bincount(mt.ad, weights=mt.nr.astype(np.int64),
                       minlength=n_ad).astype(np.int64)
    return {
        "values": list(mt.ad_values),
        "molecules": mol.tolist(),
        "reads": read.tolist(),
    }


def group_by_sample(mt: MoleculeTable):
    return {s: (mt.sample == i) for i, s in enumerate(mt.sample_values)}


def resolved_per_isoform(mt: MoleculeTable) -> dict[str, dict[str, int]]:
    resolved = {i for i, v in enumerate(mt.assign_values) if v in RESOLVED}
    out: dict[str, dict[str, int]] = defaultdict(dict)
    genes = mt.gene_values
    for k in range(mt.n):
        if mt.assign[k] not in resolved:
            continue
        iso = mt.iso_values[mt.iso[k]]
        if not iso:
            continue
        g = genes[mt.gene[k]]
        if not g:
            continue
        d = out[g]
        d[iso] = d.get(iso, 0) + 1
    return dict(out)
