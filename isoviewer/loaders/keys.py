from __future__ import annotations

import numpy as np
import pandas as pd

_KEY1 = "0123456789123456"
_KEY2 = "IsoViewer-key-02"


def fingerprint(names) -> tuple[np.ndarray, np.ndarray]:
    a = names if isinstance(names, np.ndarray) else np.asarray(names, dtype=object)
    if a.dtype != object:
        a = a.astype(object)
    return (pd.util.hash_array(a, hash_key=_KEY1, categorize=False),
            pd.util.hash_array(a, hash_key=_KEY2, categorize=False))


def sort_keys(k1: np.ndarray, k2: np.ndarray) -> np.ndarray:
    return np.lexsort((k2, k1))


class KeyIndex:
    __slots__ = ("pos", "s1", "s2")

    def __init__(self, k1: np.ndarray, k2: np.ndarray, *, keep: str = "first"):
        order = sort_keys(k1, k2)
        s1 = k1[order]
        s2 = k2[order]
        if order.size > 1:
            same = (s1[1:] == s1[:-1]) & (s2[1:] == s2[:-1])
            if same.any():
                if keep == "first":
                    sel = np.concatenate(([True], ~same))
                else:
                    sel = np.concatenate((~same, [True]))
                order, s1, s2 = order[sel], s1[sel], s2[sel]
        dtype = np.int32 if k1.size < 2 ** 31 else np.int64
        self.pos = order.astype(dtype, copy=False)
        self.s1 = s1
        self.s2 = s2

    def __len__(self) -> int:
        return int(self.pos.size)

    def lookup(self, q1: np.ndarray, q2: np.ndarray) -> np.ndarray:
        n = self.s1.size
        out = np.full(q1.size, -1, dtype=np.int64)
        if n == 0 or q1.size == 0:
            return out
        at = np.searchsorted(self.s1, q1, side="left")
        inside = at < n
        atc = np.where(inside, at, 0)
        hit1 = inside & (self.s1[atc] == q1)
        hit = hit1 & (self.s2[atc] == q2)
        out[hit] = self.pos[atc[hit]]
        for i in np.flatnonzero(hit1 & ~hit):
            j = int(atc[i])
            while j < n and self.s1[j] == q1[i]:
                if self.s2[j] == q2[i]:
                    out[i] = self.pos[j]
                    break
                j += 1
        return out
