from __future__ import annotations

import gzip
import json
import struct
from dataclasses import dataclass, field

import numpy as np

from .frame import Frame, _Matrix, dtype_tag

_DICT_RATIO = 0.5
_DICT_MIN_ROWS = 64

_ALIGN = 8


def _pad_to(n: int, align: int = _ALIGN) -> int:
    rem = n % align
    return 0 if rem == 0 else align - rem


@dataclass
class Block:
    name: str
    data: bytes
    n_rows: int
    raw_bytes: int
    columns: list[str] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.data)


def encode_frame(frame: Frame) -> Block:
    header: dict = {
        "name": frame.name,
        "n": len(frame),
        "meta": frame.meta,
        "columns": {},
    }
    body: list[bytes] = []
    offset = 0

    def emit(buf: bytes) -> int:
        nonlocal offset
        pad = _pad_to(offset)
        if pad:
            body.append(b"\0" * pad)
            offset += pad
        at = offset
        body.append(buf)
        offset += len(buf)
        return at

    for key, col in frame.columns.items():
        if isinstance(col, _Matrix):
            buf = col.arr.tobytes()
            header["columns"][key] = {
                "kind": "matrix",
                "dtype": "f32",
                "rows": int(col.arr.shape[0]),
                "cols": col.cols,
                "offset": emit(buf),
                "bytes": len(buf),
            }

        elif isinstance(col, np.ndarray):
            arr = np.ascontiguousarray(col)
            buf = arr.tobytes()
            header["columns"][key] = {
                "kind": "num",
                "dtype": dtype_tag(arr),
                "offset": emit(buf),
                "bytes": len(buf),
            }

        else:
            spec, buf = _encode_text(col)
            if buf:
                spec["offset"] = emit(buf)
            header["columns"][key] = spec

    header_bytes = json.dumps(header, separators=(",", ":")).encode()
    head_pad = _pad_to(4 + len(header_bytes))
    raw = (struct.pack("<I", len(header_bytes) + head_pad)
           + header_bytes + b" " * head_pad
           + b"".join(body))
    packed = gzip.compress(raw, compresslevel=9, mtime=0)

    return Block(
        name=frame.name,
        data=packed,
        n_rows=len(frame),
        raw_bytes=len(raw),
        columns=list(frame.columns.keys()),
    )


def _encode_text(values: list[str]):
    uniq = sorted(set(values))
    worth_dict = (
        len(values) >= _DICT_MIN_ROWS
        and len(uniq) <= max(1, int(len(values) * _DICT_RATIO))
    )
    if not worth_dict:
        return {"kind": "str", "values": values}, b""

    index = {v: i for i, v in enumerate(uniq)}
    codes = np.fromiter((index[v] for v in values), dtype=np.uint32, count=len(values))
    buf = codes.tobytes()
    return {"kind": "dict", "dtype": "u32", "values": uniq, "bytes": len(buf)}, buf


def encode_json_block(name: str, obj) -> Block:
    payload = json.dumps(obj, separators=(",", ":"), allow_nan=False).encode()
    header = {"name": name, "kind": "json", "bytes": len(payload)}
    header_bytes = json.dumps(header, separators=(",", ":")).encode()
    raw = struct.pack("<I", len(header_bytes)) + header_bytes + payload
    return Block(
        name=name,
        data=gzip.compress(raw, compresslevel=9, mtime=0),
        n_rows=0,
        raw_bytes=len(raw),
    )
