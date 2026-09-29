from __future__ import annotations

from typing import Any, Iterable, Sequence

import numpy as np

_DTYPE_TAG = {
    np.dtype("float32"): "f32",
    np.dtype("float64"): "f32",
    np.dtype("int8"): "i8",
    np.dtype("uint8"): "u8",
    np.dtype("int16"): "i16",
    np.dtype("uint16"): "u16",
    np.dtype("int32"): "i32",
    np.dtype("uint32"): "u32",
    np.dtype("int64"): "i32",
    np.dtype("bool"): "u8",
}

_TAG_DTYPE = {
    "f32": np.float32,
    "i8": np.int8,
    "u8": np.uint8,
    "i16": np.int16,
    "u16": np.uint16,
    "i32": np.int32,
    "u32": np.uint32,
}


class Frame:
    __slots__ = ("name", "columns", "meta", "_n")

    def __init__(self, name: str, meta: dict | None = None):
        self.name = name
        self.columns: dict[str, Any] = {}
        self.meta: dict = dict(meta or {})
        self._n: int | None = None

    def add(self, key: str, values: Sequence | np.ndarray, *, dtype: str | None = None) -> "Frame":
        if dtype is not None:
            arr = np.asarray(values, dtype=_TAG_DTYPE[dtype])
            self._set(key, arr)
            return self

        if isinstance(values, np.ndarray):
            if values.dtype.kind in "OUS":
                self._set(key, [("" if v is None else str(v)) for v in values.tolist()])
            else:
                self._set(key, self._narrow(values))
            return self

        vals = list(values)
        if vals and all(isinstance(v, str) for v in vals):
            self._set(key, vals)
        elif not vals:
            self._set(key, [])
        else:
            self._set(key, self._narrow(np.asarray(vals)))
        return self

    def add_text(self, key: str, values: Iterable) -> "Frame":
        self._set(key, [("" if v is None else str(v)) for v in values])
        return self

    def add_matrix(self, key: str, mat: np.ndarray, *, cols: Sequence[str]) -> "Frame":
        arr = np.ascontiguousarray(mat, dtype=np.float32)
        if arr.ndim != 2:
            raise ValueError(f"{self.name}.{key}: expected 2-D, got {arr.shape}")
        if arr.shape[1] != len(cols):
            raise ValueError(
                f"{self.name}.{key}: {arr.shape[1]} matrix columns vs {len(cols)} names"
            )
        self._check_len(arr.shape[0], key)
        self.columns[key] = _Matrix(arr, list(cols))
        return self

    def _set(self, key: str, col) -> None:
        self._check_len(len(col), key)
        self.columns[key] = col

    def _check_len(self, n: int, key: str) -> None:
        if self._n is None:
            self._n = n
        elif n != self._n:
            raise ValueError(
                f"{self.name}.{key}: length {n} does not match frame length {self._n}"
            )

    @staticmethod
    def _narrow(arr: np.ndarray) -> np.ndarray:
        if arr.dtype == np.bool_:
            return arr.astype(np.uint8)
        if arr.dtype.kind == "f":
            return arr.astype(np.float32)
        if arr.dtype.kind in "iu":
            lo, hi = (int(arr.min()), int(arr.max())) if arr.size else (0, 0)
            if lo >= 0:
                for tag, top in (("u8", 0xFF), ("u16", 0xFFFF), ("u32", 0xFFFFFFFF)):
                    if hi <= top:
                        return arr.astype(_TAG_DTYPE[tag])
            else:
                for tag, bound in (("i8", 0x7F), ("i16", 0x7FFF), ("i32", 0x7FFFFFFF)):
                    if -bound - 1 <= lo and hi <= bound:
                        return arr.astype(_TAG_DTYPE[tag])
            raise ValueError(f"integer column out of int32 range: [{lo}, {hi}]")
        raise TypeError(f"unsupported column dtype {arr.dtype}")

    def __len__(self) -> int:
        return self._n or 0

    def __contains__(self, key: str) -> bool:
        return key in self.columns

    def __getitem__(self, key: str):
        return self.columns[key]

    def keys(self):
        return self.columns.keys()

    def describe(self) -> str:
        parts = []
        for k, v in self.columns.items():
            if isinstance(v, _Matrix):
                parts.append(f"{k}[{v.arr.shape[0]}x{v.arr.shape[1]}]")
            elif isinstance(v, np.ndarray):
                parts.append(f"{k}:{_DTYPE_TAG[v.dtype]}")
            else:
                parts.append(f"{k}:str")
        return f"{self.name} n={len(self)} " + " ".join(parts)


class _Matrix:
    __slots__ = ("arr", "cols")

    def __init__(self, arr: np.ndarray, cols: list[str]):
        self.arr = arr
        self.cols = cols

    def __len__(self) -> int:
        return self.arr.shape[0]


def dtype_tag(arr: np.ndarray) -> str:
    return _DTYPE_TAG[arr.dtype]
