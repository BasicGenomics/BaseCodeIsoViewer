from __future__ import annotations

import csv
import gzip
import os
import re
import time
from collections import defaultdict

import numpy as np
import pandas as pd

from .keys import KeyIndex, fingerprint

SUMMARY_COLUMNS = [
    ("5' Counts", "reads_5p", "5′ reads"),
    ("3' Counts", "reads_3p", "3′ reads"),
    ("Internal Counts", "reads_internal", "Internal reads"),
    ("Total Counts", "reads_total", "Total reads"),
    ("Genes Detected", "genes_detected", "Genes detected"),
    ("Reconstructed Molecules with 5' Coverage", "mol_5p", "Molecules with 5′ coverage"),
    ("Reconstructed Molecules with Internal Coverage", "mol_internal", "Molecules with internal coverage"),
    ("Reconstructed Molecules with 3' Coverage", "mol_3p", "Molecules with 3′ coverage"),
    ("Percentage Reconstructed End-to-End Molecules (%)", "pct_end_to_end", "End-to-end molecules (%)"),
    ("Median Length Reconstructed End-to-End Molecules (aligned bp)", "median_e2e_len", "Median end-to-end length (bp)"),
    ("gA Conversion Rate (%)", "conversion_ga", "gA conversion rate (%)"),
]

_HISAT2_PATTERNS = {
    "total_pairs": r"Total pairs:\s*([0-9]+)",
    "concordant_0": r"Aligned concordantly or discordantly 0 time:\s*([0-9]+)",
    "concordant_1": r"Aligned concordantly 1 time:\s*([0-9]+)",
    "concordant_multi": r"Aligned concordantly >1 times:\s*([0-9]+)",
    "discordant_1": r"Aligned discordantly 1 time:\s*([0-9]+)",
    "unpaired_total": r"Total unpaired reads:\s*([0-9]+)",
    "unpaired_0": r"Aligned 0 time:\s*([0-9]+)",
    "unpaired_1": r"Aligned 1 time:\s*([0-9]+)",
    "unpaired_multi": r"Aligned >1 times:\s*([0-9]+)",
    "overall_pct": r"Overall alignment rate:\s*([0-9.]+)%",
}


def load_summary_stats(path: str, samples: list[str]) -> dict | None:
    try:
        df = pd.read_csv(path)
    except Exception:
        return None
    if df.empty:
        return None
    key = df.columns[0]
    present = [(raw, k, label) for raw, k, label in SUMMARY_COLUMNS if raw in df.columns]

    rows: dict[str, dict] = {}
    for _, r in df.iterrows():
        sid = str(r[key]).strip()
        if samples and sid not in samples:
            continue
        entry: dict = {}
        for raw, k, _label in present:
            try:
                entry[k] = float(r[raw])
            except (TypeError, ValueError):
                entry[k] = None
        rows[sid] = entry
    if not rows:
        return None
    return {
        "columns": [{"key": k, "label": label} for _raw, k, label in present],
        "per_sample": rows,
        "source": os.path.basename(path),
        "sample_column": str(key),
    }


def load_hisat2(path: str) -> dict | None:
    try:
        with open(path) as fh:
            text = fh.read()
    except OSError:
        return None
    out: dict = {}
    for key, pat in _HISAT2_PATTERNS.items():
        m = re.search(pat, text)
        if m:
            raw = m.group(1)
            out[key] = float(raw) if "." in raw else int(raw)
    return out or None


def load_conversion_summary(path: str, samples: list[str]) -> dict | None:
    try:
        df = pd.read_csv(path)
    except Exception:
        return None
    if df.empty or "SAMPLE_ID" not in df.columns:
        return None
    if "strand" in df.columns:
        df = df[df["strand"].astype(str) == "total"]
    subs = [c for c in df.columns
            if len(c) == 2 and c[0].islower() and c[1].isupper()]
    if not subs:
        return None
    grouped = df.groupby("SAMPLE_ID")[subs].mean(numeric_only=True)
    per_sample = {}
    for sid, row in grouped.iterrows():
        sid = str(sid)
        if samples and sid not in samples:
            continue
        per_sample[sid] = {c: (None if pd.isna(row[c]) else float(row[c])) for c in subs}
    if not per_sample:
        return None
    return {
        "substitutions": subs,
        "per_sample": per_sample,
        "source": os.path.basename(path),
        "n_barcodes": int(df["SAMPLE_ID"].isin(list(per_sample)).sum()),
    }


def load_csv_table(path: str, *, max_rows: int = 5000) -> dict | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt", newline="") as fh:
            rdr = csv.reader(fh)
            rows = []
            header = next(rdr, None)
            if header is None:
                return None
            for i, row in enumerate(rdr):
                if i >= max_rows:
                    break
                rows.append(row)
    except Exception:
        return None
    return {"columns": [str(c) for c in header], "rows": rows,
            "source": os.path.basename(path), "truncated": len(rows) >= max_rows}


_SHEET_MAX_CELL = 160

_SEQ_CHARS = frozenset("ACGTUN;,:|- ")


def _looks_like_barcode(values: list[str]) -> bool:
    non_empty = [v for v in values if v]
    if not non_empty:
        return False
    hits = 0
    for v in non_empty:
        u = v.upper()
        if not u:
            continue
        seqish = sum(1 for c in u if c in _SEQ_CHARS)
        if seqish / len(u) > 0.9 and any(c in "ACGT" for c in u):
            hits += 1
    return hits / len(non_empty) > 0.5


_INDEX_TOKENS = ("PCR", "IDX", "INDEX", "PRIMER", "FW1", "FW2", "RV1", "RV2",
                 "BARCODE", "_SEQ", "PLATE", "WELL", "LANE")

_SHEET_LABELS = {
    "DESC": "Description",
    "DESCRIPTION": "Description",
    "SAMPLE_DESC": "Description",
    "CONDITION": "Condition",
    "GROUP": "Group",
    "REPLICATE": "Replicate",
    "TISSUE": "Tissue",
    "CELL_LINE": "Cell line",
    "TREATMENT": "Treatment",
}


def _is_index_column(name: str) -> bool:
    u = str(name).upper()
    if u in _SHEET_LABELS:
        return False
    return any(tok in u for tok in _INDEX_TOKENS)


def _sheet_label(name: str) -> str:
    u = str(name).upper().strip()
    if u in _SHEET_LABELS:
        return _SHEET_LABELS[u]
    pretty = str(name).replace("_", " ").strip()
    return pretty[:1].upper() + pretty[1:].lower() if pretty.isupper() else pretty


def load_samplesheet(path: str, samples: list[str]) -> dict | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, newline="") as fh:
            raw = list(csv.reader(fh))
    except Exception:
        return None
    if len(raw) < 2:
        return None

    hdr_idx = 0
    key_idx = 0
    for i, row in enumerate(raw[:5]):
        upper = [str(c).strip().upper() for c in row]
        if "SAMPLE_ID" in upper:
            hdr_idx = i
            key_idx = upper.index("SAMPLE_ID")
            break

    hdr = [str(c).strip() for c in raw[hdr_idx]]
    seen: dict[str, int] = {}
    cols: list[str] = []
    for j, h in enumerate(hdr):
        base = h or (f"column {j + 1}" if j != key_idx else "SAMPLE_ID")
        seen[base] = seen.get(base, 0) + 1
        cols.append(base if seen[base] == 1 else f"{base} ({seen[base]})")

    body = [r for r in raw[hdr_idx + 1:] if r and len(r) > key_idx
            and str(r[key_idx]).strip()]
    if not body:
        return None

    keep: list[int] = []
    dropped: list[str] = []
    for j, name in enumerate(cols):
        if j == key_idx:
            continue
        if not hdr[j]:
            continue
        cells = [str(r[j]).strip() if len(r) > j else "" for r in body]
        non_empty = [c for c in cells if c and c.lower() != "nan"]
        if not non_empty:
            continue
        longest = max(len(c) for c in cells)
        if longest > _SHEET_MAX_CELL or _looks_like_barcode(cells):
            dropped.append(name)
        elif _is_index_column(name):
            dropped.append(name)
        else:
            keep.append(j)

    wanted = set(samples) if samples else None
    rows: dict[str, dict] = {}
    for r in body:
        sid = str(r[key_idx]).strip()
        if wanted is not None and sid not in wanted:
            continue
        rows[sid] = {
            cols[j]: (str(r[j]).strip() if len(r) > j else "") for j in keep
        }
    if not rows:
        return None
    return {
        "columns": [cols[j] for j in keep],
        "column_labels": [_sheet_label(cols[j]) for j in keep],
        "rows": rows,
        "source": os.path.basename(path),
        "omitted_columns": dropped,
        "n_samples_in_sheet": len({str(r[key_idx]).strip() for r in body}),
    }


class ReconStats:
    __slots__ = ("n", "key1", "key2", "sample", "sample_values", "t1", "f1",
                 "ql", "gaps", "tc", "fc", "stats")

    def has_strict_fl(self) -> bool:
        return self.t1 is not None and self.f1 is not None

    def sample_groups(self):
        for name in sorted(self.sample_values):
            code = self.sample_values.index(name)
            yield name, np.flatnonzero(self.sample == code)


_RECON_CHUNK = 2_000_000


def load_recon_stats(path: str, *, log=print) -> ReconStats | None:
    if not path or not os.path.isfile(path):
        return None
    t0 = time.time()
    want = {"MOL_NAME", "SM", "T1", "F1", "QL", "GAPS", "TC", "FC"}
    try:
        head = pd.read_csv(path, nrows=0)
    except Exception as exc:
        log(f"    WARN: could not read {os.path.basename(path)}: {exc}")
        return None
    usecols = [c for c in head.columns if c in want]
    if "MOL_NAME" not in usecols:
        log(f"    WARN: {os.path.basename(path)} has no MOL_NAME column")
        return None

    def num(col, dtype):
        return pd.to_numeric(col, errors="coerce").fillna(0).to_numpy(dtype=dtype)

    parts: dict[str, list] = defaultdict(list)
    for col, name in (("MOL_NAME", "key1"), ("MOL_NAME", "key2"), ("SM", "sample"),
                      ("T1", "t1"), ("F1", "f1"), ("QL", "ql"), ("GAPS", "gaps"),
                      ("TC", "tc"), ("FC", "fc")):
        if col in usecols:
            parts[name] = []
    sample_values: list[str] = []
    sample_code: dict[str, int] = {}
    try:
        reader = pd.read_csv(path, usecols=usecols, chunksize=_RECON_CHUNK,
                             dtype={"MOL_NAME": str, "SM": str, "T1": str, "F1": str})
        for df in reader:
            k1, k2 = fingerprint(df["MOL_NAME"].to_numpy(dtype=object))
            parts["key1"].append(k1)
            parts["key2"].append(k2)
            if "SM" in df.columns:
                codes, uniq = pd.factorize(df["SM"].astype(str))
                remap = np.empty(len(uniq), dtype=np.uint32)
                for j, name in enumerate(uniq):
                    c = sample_code.get(name)
                    if c is None:
                        c = sample_code[name] = len(sample_values)
                        sample_values.append(name)
                    remap[j] = c
                parts["sample"].append(remap[codes])
            if "T1" in df.columns:
                parts["t1"].append((df["T1"].astype(str) == "Y").to_numpy())
            if "F1" in df.columns:
                parts["f1"].append((df["F1"].astype(str) == "Y").to_numpy())
            if "QL" in df.columns:
                parts["ql"].append(num(df["QL"], np.int32))
            if "GAPS" in df.columns:
                parts["gaps"].append(num(df["GAPS"], np.uint8))
            if "TC" in df.columns:
                parts["tc"].append(num(df["TC"], np.int32))
            if "FC" in df.columns:
                parts["fc"].append(num(df["FC"], np.int32))
            del df
    except Exception as exc:
        log(f"    WARN: could not read {os.path.basename(path)}: {exc}")
        return None

    def cat(name, dtype):
        if name not in parts:
            return None
        chunks = parts.pop(name)
        return np.concatenate(chunks) if chunks else np.zeros(0, dtype=dtype)

    rs = ReconStats()
    rs.key1 = cat("key1", np.uint64)
    rs.key2 = cat("key2", np.uint64)
    rs.sample = cat("sample", np.uint32)
    rs.sample_values = sample_values
    rs.t1 = cat("t1", bool)
    rs.f1 = cat("f1", bool)
    rs.ql = cat("ql", np.int32)
    rs.gaps = cat("gaps", np.uint8)
    rs.tc = cat("tc", np.int32)
    rs.fc = cat("fc", np.int32)

    n = rs.n = int(rs.key1.size)
    strict = int((rs.t1 & rs.f1).sum()) if rs.has_strict_fl() else 0
    loose = int(((rs.tc > 0) & (rs.fc > 0)).sum()) if rs.tc is not None else 0
    rs.stats = {
        "source": os.path.basename(path),
        "n_molecules": n,
        "n_full_length_strict": strict,
        "n_full_length_loose": loose,
        "elapsed_s": round(time.time() - t0, 1),
    }
    log(f"    {n:,} molecules; full length strict (T1&F1) {strict:,} "
        f"({100 * strict / max(n, 1):.1f}%), loose (TC&FC) {loose:,} "
        f"({100 * loose / max(n, 1):.1f}%)  [{rs.stats['elapsed_s']}s]")
    return rs


def strict_fl_for(rs: ReconStats, key1: np.ndarray, key2: np.ndarray) -> np.ndarray:
    pos = KeyIndex(rs.key1, rs.key2, keep="last").lookup(key1, key2)
    flags = rs.t1 & rs.f1
    out = np.zeros(pos.size, dtype=bool)
    hit = pos >= 0
    out[hit] = flags[pos[hit]]
    return out


def lengths_aligned_to(rs: ReconStats, key1: np.ndarray,
                       key2: np.ndarray) -> "np.ndarray | None":
    if rs is None or rs.ql is None or not rs.n:
        return None
    pos = KeyIndex(rs.key1, rs.key2, keep="first").lookup(key1, key2)
    out = np.zeros(pos.size, dtype=np.float64)
    hit = pos >= 0
    out[hit] = rs.ql[pos[hit]]
    return out


def molecule_lengths(rs: ReconStats, *, bin_w: int = 50, cap: int = 5000) -> dict:
    if rs is None or rs.ql is None or not len(rs.ql):
        return {}
    ql = rs.ql.astype(np.int64)
    fl = ((rs.tc > 0) & (rs.fc > 0)) if rs.tc is not None and rs.fc is not None else None
    n_bins = int(cap // bin_w)

    def hist(a: np.ndarray) -> list[int]:
        if not a.size:
            return [0] * (n_bins + 1)
        idx = np.minimum(a // bin_w, n_bins)
        return [int(v) for v in np.bincount(idx, minlength=n_bins + 1)[:n_bins + 1]]

    def summary(a: np.ndarray) -> dict:
        if not a.size:
            return {"n": 0}
        return {
            "n": int(a.size),
            "median": float(np.median(a)),
            "mean": float(a.mean()),
            "p95": float(np.percentile(a, 95)),
            "max": int(a.max()),
        }

    out: dict = {
        "bin_w": bin_w, "n_bins": n_bins, "cap": cap,
        "all": hist(ql), "stats_all": summary(ql),
    }
    if fl is not None:
        out["fl"] = hist(ql[fl])
        out["stats_fl"] = summary(ql[fl])

    if rs.sample is not None:
        names, per_all, per_fl, st_all, st_fl = [], [], [], [], []
        for sid, sel in rs.sample_groups():
            names.append(str(sid))
            per_all.append(hist(ql[sel]))
            st_all.append(summary(ql[sel]))
            if fl is not None:
                m = sel[fl[sel]]
                per_fl.append(hist(ql[m]))
                st_fl.append(summary(ql[m]))
        out["samples"] = names
        out["per_sample_all"] = per_all
        out["per_sample_stats_all"] = st_all
        if fl is not None:
            out["per_sample_fl"] = per_fl
            out["per_sample_stats_fl"] = st_fl
    return out


def per_sample_molecules(rs: ReconStats) -> dict[str, dict]:
    if rs is None or rs.sample is None:
        return {}
    out: dict[str, dict] = {}
    strict = (rs.t1 & rs.f1) if rs.has_strict_fl() else None
    loose = ((rs.tc > 0) & (rs.fc > 0)) if rs.tc is not None and rs.fc is not None else None
    for sid, sel in rs.sample_groups():
        entry = {"n_molecules": int(sel.size)}
        if strict is not None:
            entry["n_fl_strict"] = int(strict[sel].sum())
        if loose is not None:
            entry["n_fl_loose"] = int(loose[sel].sum())
        if rs.ql is not None:
            entry["median_aligned"] = float(np.median(rs.ql[sel]))
        if rs.gaps is not None:
            entry["n_with_gap"] = int((rs.gaps[sel] > 0).sum())
        out[str(sid)] = entry
    return out
