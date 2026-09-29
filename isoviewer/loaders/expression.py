from __future__ import annotations

import numpy as np
import pandas as pd

META_ROWS = ("__ambiguous", "__no_feature", "__not_aligned", "__unassigned")


class Aggregate:
    __slots__ = ("counts", "tpm", "meta", "n_features")

    def __init__(self, counts: dict[str, float], tpm: dict[str, float],
                 meta: dict[str, dict], n_features: int):
        self.counts = counts
        self.tpm = tpm
        self.meta = meta
        self.n_features = n_features


class Matrix:
    __slots__ = ("ids", "samples", "values", "index")

    def __init__(self, ids: list[str], samples: list[str], values: np.ndarray):
        self.ids = ids
        self.samples = samples
        self.values = values
        self.index = {fid: i for i, fid in enumerate(ids)}

    @property
    def n(self) -> int:
        return len(self.ids)

    def row(self, fid: str) -> np.ndarray | None:
        i = self.index.get(fid)
        return None if i is None else self.values[i]

    def reindex(self, ids: list[str]) -> np.ndarray:
        out = np.zeros((len(ids), len(self.samples)), dtype=np.float32)
        for k, fid in enumerate(ids):
            i = self.index.get(fid)
            if i is not None:
                out[k] = self.values[i]
        return out


def _read_two_col(path: str, value_name: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", comment="#", header=0,
                     names=["feature_id", value_name], dtype={0: str})
    df[value_name] = pd.to_numeric(df[value_name], errors="coerce").fillna(0.0)
    return df


def load_aggregate(counts_path: str, tpm_path: str | None) -> Aggregate:
    cdf = _read_two_col(counts_path, "count")
    if tpm_path:
        tdf = _read_two_col(tpm_path, "tpm")
        df = cdf.merge(tdf, on="feature_id", how="outer")
        df["count"] = df["count"].fillna(0.0)
        df["tpm"] = df["tpm"].fillna(0.0)
    else:
        df = cdf
        df["tpm"] = 0.0

    is_meta = df["feature_id"].str.startswith("__")
    meta = {
        str(r.feature_id): {"count": float(r.count), "tpm": float(r.tpm)}
        for r in df[is_meta].itertuples()
    }
    bio = df[~is_meta]
    return Aggregate(
        counts=dict(zip(bio["feature_id"], bio["count"].astype(float))),
        tpm=dict(zip(bio["feature_id"], bio["tpm"].astype(float))),
        meta=meta,
        n_features=int(len(bio)),
    )


def load_matrix(path: str) -> Matrix:
    df = pd.read_csv(path, sep="\t", comment="#", header=0, dtype={0: str})
    id_col = df.columns[0]
    samples = [str(c) for c in df.columns[1:]]
    ids = df[id_col].astype(str).tolist()
    values = df[df.columns[1:]].apply(pd.to_numeric, errors="coerce") \
                               .fillna(0.0).to_numpy(dtype=np.float32)

    keep = [i for i, fid in enumerate(ids) if not fid.startswith("__")]
    if len(keep) != len(ids):
        ids = [ids[i] for i in keep]
        values = values[keep]
    return Matrix(ids, samples, np.ascontiguousarray(values))


def samples_from_matrix(path: str) -> list[str]:
    with open(path) as fh:
        header = fh.readline().rstrip("\n").lstrip("#")
    return [c for c in header.split("\t")[1:] if c]


def load_pair(counts_path: str, tpm_path: str) -> tuple[Matrix, Matrix]:
    cm = load_matrix(counts_path)
    tm = load_matrix(tpm_path)
    if tm.ids != cm.ids:
        tm = Matrix(cm.ids, tm.samples, tm.reindex(cm.ids))
    if tm.samples != cm.samples:
        order = [tm.samples.index(s) for s in cm.samples if s in tm.samples]
        if len(order) == len(cm.samples):
            tm = Matrix(cm.ids, cm.samples, np.ascontiguousarray(tm.values[:, order]))
    return cm, tm
