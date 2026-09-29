from __future__ import annotations

import numpy as np
import pandas as pd

END_CATS = ("T_F_I", "T_F", "T_I", "F_I", "T", "F", "I", "none")

END_CAT_LABEL = {
    "T_F_I": "3′ + Internal + 5′",
    "T_F": "3′ + 5′",
    "T_I": "3′ + Internal",
    "F_I": "5′ + Internal",
    "T": "3′ only",
    "F": "5′ only",
    "I": "Internal only",
    "none": "No end tag",
}

REF_TYPES = (
    "unique",
    "unique_minor_difference",
    "ambiguous",
    "inconsistent_non_intronic",
    "inconsistent",
    "inconsistent_ambiguous",
    "other_type",
)

_INT_COLS = (
    ["n_reads", "n_full_length", "n_gap", "median_aligned"]
    + [f"n_{c}" for c in END_CATS]
    + [f"n_{t}" for t in REF_TYPES]
    + ["is_novel", "n_exons", "model_len"]
)
_FLOAT_COLS = ("frac_full_length", "frac_gap", "mean_aligned")


class Support:
    def __init__(self, ids: list[str], cols: dict[str, np.ndarray]):
        self.ids = ids
        self.cols = cols
        self.index = {fid: i for i, fid in enumerate(ids)}

    @property
    def n(self) -> int:
        return len(self.ids)

    def has(self, key: str) -> bool:
        return key in self.cols

    def get(self, key: str, default: float = 0.0) -> np.ndarray:
        arr = self.cols.get(key)
        if arr is None:
            return np.full(self.n, default, dtype=np.float32)
        return arr

    def align(self, ids: list[str], key: str, default: float = 0.0) -> np.ndarray:
        src = self.get(key, default)
        out = np.full(len(ids), default, dtype=src.dtype if src.dtype.kind == "f" else np.float64)
        for k, fid in enumerate(ids):
            i = self.index.get(fid)
            if i is not None:
                out[k] = src[i]
        return out


def load(path: str, *, log=print) -> Support:
    df = pd.read_csv(path, sep="\t", header=0, dtype={"feature_id": str,
                                                      "gene_id": str,
                                                      "chrom": str})
    ids = df["feature_id"].astype(str).tolist()
    cols: dict[str, np.ndarray] = {}

    for c in ("gene_id", "chrom"):
        if c in df.columns:
            cols[c] = df[c].fillna("").astype(str).to_numpy()

    for c in _INT_COLS:
        if c in df.columns:
            cols[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).to_numpy(dtype=np.int64)
    for c in _FLOAT_COLS:
        if c in df.columns:
            cols[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0).to_numpy(dtype=np.float32)

    log(f"    {len(ids):,} features, columns: {sorted(k for k in cols if k.startswith('n_'))[:6]}…")
    return Support(ids, cols)


def parse_summary(path: str) -> dict:
    try:
        with open(path) as fh:
            text = fh.read()
    except OSError:
        return {}
    lines = [ln.rstrip() for ln in text.splitlines()]
    body = [ln for ln in lines if ln.strip() and not set(ln.strip()) <= {"="}]
    return {"text": "\n".join(body)}
