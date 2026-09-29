from __future__ import annotations

import numpy as np
import pandas as pd

POSITION_FLAG = {
    "X": "Terminal in all isoforms",
    "T": "Terminal in some isoforms",
    "I": "Internal in all isoforms",
}
MODIFIER_FLAG = {
    "S": "Similar to another feature (within delta)",
    "C": "Contained in another feature",
    "U": "Unique to one isoform",
    "M": "Shared across genes",
}


def _load_one(path: str, kind: str, log) -> dict | None:
    if not path:
        return None
    try:
        df = pd.read_csv(path, sep="\t", header=0, dtype={"chr": str, "flags": str,
                                                          "gene_ids": str,
                                                          "group_id": str})
    except Exception as exc:
        log(f"    WARN: could not read {kind}_counts: {exc}")
        return None
    for c in ("include_counts", "exclude_counts", "flags"):
        if c not in df.columns:
            log(f"    WARN: {kind}_counts missing column '{c}'")
            return None

    inc = pd.to_numeric(df["include_counts"], errors="coerce").fillna(0).to_numpy(np.int64)
    exc = pd.to_numeric(df["exclude_counts"], errors="coerce").fillna(0).to_numpy(np.int64)
    flags = df["flags"].fillna("").astype(str).to_numpy()

    total = inc + exc
    informative = total > 0
    ratio = np.divide(inc, total, out=np.zeros(len(inc), dtype=np.float64),
                      where=total > 0)

    pos_codes = np.array([f[:1] if f else "" for f in flags])
    pos_counts: dict[str, int] = {}
    for code in ("X", "T", "I"):
        pos_counts[code] = int((pos_codes == code).sum())

    mod_counts: dict[str, int] = {}
    for code in ("S", "C", "U", "M"):
        mod_counts[code] = int(np.fromiter((code in f[1:] for f in flags),
                                          dtype=bool, count=len(flags)).sum())

    n = len(df)
    log(f"    {kind}: {n:,} features, {int(informative.sum()):,} with evidence; "
        f"position {pos_counts}, modifiers {mod_counts}")
    return {
        "kind": kind,
        "n_features": n,
        "n_informative": int(informative.sum()),
        "n_include_only": int(((inc > 0) & (exc == 0)).sum()),
        "n_exclude_only": int(((inc == 0) & (exc > 0)).sum()),
        "n_both": int(((inc > 0) & (exc > 0)).sum()),
        "include_total": int(inc.sum()),
        "exclude_total": int(exc.sum()),
        "position": {
            "values": ["X", "T", "I"],
            "labels": [POSITION_FLAG[c] for c in ("X", "T", "I")],
            "counts": [pos_counts[c] for c in ("X", "T", "I")],
        },
        "modifiers": {
            "values": ["S", "C", "U", "M"],
            "labels": [MODIFIER_FLAG[c] for c in ("S", "C", "U", "M")],
            "counts": [mod_counts[c] for c in ("S", "C", "U", "M")],
        },
        "ratio_hist": _hist(ratio[(inc > 0) & (exc > 0)], 40, 0.0, 1.0),
        "ratio_hist_by_position": {
            code: _hist(ratio[(pos_codes == code) & (inc > 0) & (exc > 0)],
                        20, 0.0, 1.0)
            for code in ("X", "T", "I")
        },
    }


def _hist(values: np.ndarray, bins: int, lo: float, hi: float) -> dict:
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return {"edges": [], "counts": []}
    counts, edges = np.histogram(v, bins=bins, range=(lo, hi))
    return {"edges": [round(float(e), 4) for e in edges],
            "counts": [int(c) for c in counts]}


def load_summary(exon_path: str | None, intron_path: str | None, *, log=print) -> dict:
    out: dict = {
        "flag_legend": {
            "position": POSITION_FLAG,
            "modifier": MODIFIER_FLAG,
        },
        "note": "include / (include + exclude) is a per-feature usage ratio; only "
                "features with evidence on both sides are informative.",
    }
    exon = _load_one(exon_path, "exon", log)
    intron = _load_one(intron_path, "intron", log)
    if exon:
        out["exon"] = exon
    if intron:
        out["intron"] = intron
    out["available"] = bool(exon or intron)
    return out
