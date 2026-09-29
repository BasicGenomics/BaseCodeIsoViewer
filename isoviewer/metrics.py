from __future__ import annotations

import numpy as np

_EPS = 1e-12


def normalised_entropy(shares: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        terms = np.where(shares > 0, shares * np.log2(shares + _EPS), 0.0)
    h = -terms.sum(axis=1)
    n = (shares > 0).sum(axis=1)
    max_h = np.log2(np.maximum(n, 1))
    out = np.zeros_like(h)
    ok = max_h > 0
    out[ok] = h[ok] / max_h[ok]
    return np.clip(out, 0.0, 1.0)


def entropy_of_shares(shares: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        terms = np.where(shares > 0, shares * np.log2(shares + _EPS), 0.0)
    return -terms.sum(axis=1)


def cv(values: np.ndarray) -> np.ndarray:
    mu = values.mean(axis=1)
    sd = values.std(axis=1, ddof=0)
    out = np.zeros_like(mu, dtype=np.float64)
    ok = mu > 0
    out[ok] = sd[ok] / mu[ok]
    return out


def _jsd_pair(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    m = 0.5 * (p + q)
    with np.errstate(divide="ignore", invalid="ignore"):
        kp = np.where(p > 0, p * np.log2((p + _EPS) / (m + _EPS)), 0.0)
        kq = np.where(q > 0, q * np.log2((q + _EPS) / (m + _EPS)), 0.0)
    return 0.5 * kp.sum(axis=0) + 0.5 * kq.sum(axis=0)


class GeneUsage:
    def __init__(self, tx_tpm: np.ndarray, offsets: np.ndarray, n_samples: int):
        self.tx_tpm = np.ascontiguousarray(tx_tpm, dtype=np.float64)
        self.offsets = np.asarray(offsets, dtype=np.int64)
        self.n_genes = len(self.offsets) - 1
        self.n_samples = n_samples

    def compute(self) -> dict[str, np.ndarray]:
        n_g, n_s = self.n_genes, self.n_samples
        ent = np.zeros(n_g, dtype=np.float32)
        ent_raw = np.zeros(n_g, dtype=np.float32)
        jsd_mean = np.zeros(n_g, dtype=np.float32)
        jsd_max = np.zeros(n_g, dtype=np.float32)
        switch = np.zeros(n_g, dtype=np.float32)
        n_var = np.zeros(n_g, dtype=np.int32)
        n_var_expressed = np.zeros(n_g, dtype=np.int32)
        dominant_share = np.zeros(n_g, dtype=np.float32)

        pairs = [(i, j) for i in range(n_s) for j in range(i + 1, n_s)]

        for g in range(n_g):
            a, b = self.offsets[g], self.offsets[g + 1]
            block = self.tx_tpm[a:b]
            k = block.shape[0]
            n_var[g] = k
            if k == 0:
                continue

            mean_tpm = block.mean(axis=1)
            total = mean_tpm.sum()
            n_var_expressed[g] = int((mean_tpm > 0).sum())
            if total > 0:
                shares = mean_tpm / total
                ent[g] = normalised_entropy(shares[None, :])[0]
                ent_raw[g] = entropy_of_shares(shares[None, :])[0]
                dominant_share[g] = float(shares.max())
            if k < 2 or n_s < 2:
                continue

            col_sum = block.sum(axis=0)
            usable = col_sum > 0
            if usable.sum() < 2:
                continue
            frac = np.zeros_like(block)
            frac[:, usable] = block[:, usable] / col_sum[usable]

            vals = []
            for i, j in pairs:
                if not (usable[i] and usable[j]):
                    continue
                vals.append(float(_jsd_pair(frac[:, i:i + 1], frac[:, j:j + 1])[0]))
            if vals:
                jsd_mean[g] = float(np.mean(vals))
                jsd_max[g] = float(np.max(vals))

            dom = frac.argmax(axis=0)
            best = 0.0
            for i, j in pairs:
                if not (usable[i] and usable[j]) or dom[i] == dom[j]:
                    continue
                best = max(best,
                           abs(frac[dom[i], i] - frac[dom[i], j]),
                           abs(frac[dom[j], j] - frac[dom[j], i]))
            switch[g] = best

        return {
            "entropy_norm": np.clip(ent, 0, 1),
            "entropy": ent_raw,
            "jsd_mean": np.clip(jsd_mean, 0, 1),
            "jsd_max": np.clip(jsd_max, 0, 1),
            "switch": np.clip(switch, 0, 1),
            "n_variants": n_var,
            "n_variants_expressed": n_var_expressed,
            "dominant_share": np.clip(dominant_share, 0, 1),
        }


def group_jsd(tx_tpm: np.ndarray, offsets: np.ndarray,
              group_a: list[int], group_b: list[int]) -> np.ndarray:
    n_g = len(offsets) - 1
    out = np.zeros(n_g, dtype=np.float32)
    for g in range(n_g):
        a, b = offsets[g], offsets[g + 1]
        block = tx_tpm[a:b]
        if block.shape[0] < 2:
            continue
        pa = block[:, group_a].mean(axis=1)
        pb = block[:, group_b].mean(axis=1)
        sa, sb = pa.sum(), pb.sum()
        if sa <= 0 or sb <= 0:
            continue
        out[g] = float(_jsd_pair((pa / sa)[:, None], (pb / sb)[:, None])[0])
    return np.clip(out, 0, 1)


def _bin_tops(v: np.ndarray, edges: np.ndarray, labels, rank, top_n: int) -> list:
    if labels is None:
        return []
    lab = list(labels)
    r = np.asarray(rank, dtype=np.float64) if rank is not None else v
    idx = np.clip(np.digitize(v, edges[1:-1], right=False), 0, len(edges) - 2)
    n_bins = len(edges) - 1
    order = np.argsort(-r, kind="stable")
    tops: list[list] = [[] for _ in range(n_bins)]
    remaining = n_bins
    for j in order:
        b = int(idx[j])
        bucket = tops[b]
        if len(bucket) >= top_n:
            continue
        k = int(j)
        if k < len(lab):
            bucket.append([str(lab[k]), _finite_num(r[j])])
        if len(bucket) == top_n:
            remaining -= 1
            if remaining <= 0:
                break
    return tops


def _finite_num(x) -> float | None:
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def histogram(values: np.ndarray, *, bins: int = 60,
              lo: float | None = None, hi: float | None = None,
              labels=None, rank=None, top_n: int = 10) -> dict:
    v = np.asarray(values, dtype=np.float64)
    keep = np.isfinite(v)
    if labels is not None:
        labels = np.asarray(labels, dtype=object)[keep]
    if rank is not None:
        rank = np.asarray(rank, dtype=np.float64)[keep]
    v = v[keep]
    if v.size == 0:
        return {"edges": [], "counts": []}
    a = float(v.min()) if lo is None else lo
    b = float(v.max()) if hi is None else hi
    if b <= a:
        b = a + 1.0
    counts, edges = np.histogram(v, bins=bins, range=(a, b))
    out = {"edges": [round(float(e), 6) for e in edges],
           "counts": [int(c) for c in counts]}
    if labels is not None:
        inr = (v >= a) & (v <= b)
        out["tops"] = _bin_tops(v[inr], edges,
                                labels[inr],
                                None if rank is None else rank[inr], top_n)
    return out


def log_histogram(values: np.ndarray, *, bins: int = 60,
                  labels=None, rank=None, top_n: int = 10) -> dict:
    v = np.asarray(values, dtype=np.float64)
    keep = np.isfinite(v) & (v >= 0)
    if labels is not None:
        labels = np.asarray(labels, dtype=object)[keep]
    if rank is not None:
        rank = np.asarray(rank, dtype=np.float64)[keep]
    v = v[keep]
    if v.size == 0:
        return {"edges": [], "counts": [], "log": True}
    h = histogram(np.log10(v + 1.0), bins=bins, lo=0.0,
                  labels=labels, rank=v if rank is None else rank, top_n=top_n)
    h["log"] = True
    return h


def quantiles(values: np.ndarray,
              qs: tuple[float, ...] = (0, 0.05, 0.25, 0.5, 0.75, 0.95, 1.0)) -> dict:
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if v.size == 0:
        return {}
    out = {f"q{int(q * 100)}": float(np.quantile(v, q)) for q in qs}
    out["mean"] = float(v.mean())
    out["n"] = int(v.size)
    return out


def pca(matrix: np.ndarray, n_components: int = 4) -> dict:
    x = np.asarray(matrix, dtype=np.float64)
    if x.size == 0 or x.shape[1] < 2:
        return {}
    x = x - x.mean(axis=1, keepdims=True)
    keep = x.std(axis=1) > 0
    x = x[keep]
    if x.shape[0] < 2:
        return {}
    u, s, vt = np.linalg.svd(x.T, full_matrices=False)
    k = int(min(n_components, len(s)))
    var = (s ** 2)
    total = var.sum()
    return {
        "scores": (u[:, :k] * s[:k]).tolist(),
        "explained": [float(v / total) for v in var[:k]] if total > 0 else [],
        "loadings": vt[:k].tolist(),
        "feature_mask": np.flatnonzero(keep).tolist(),
        "n_features": int(x.shape[0]),
    }


def correlation(matrix: np.ndarray) -> list[list[float]]:
    x = np.asarray(matrix, dtype=np.float64)
    if x.shape[0] < 2 or x.shape[1] < 2:
        return [[1.0]] * x.shape[1]
    c = np.corrcoef(x, rowvar=False)
    c = np.nan_to_num(c, nan=0.0)
    return [[round(float(v), 6) for v in row] for row in c]
