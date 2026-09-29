from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict

TAG_RANK = (
    "MANE_Select",
    "MANE_Plus_Clinical",
    "Ensembl_canonical",
    "GENCODE_Primary",
    "basic",
)


def source_info(path: str) -> dict:
    out: dict = {}
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    except Exception:
        return out
    try:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        if "directives" not in names:
            return out
        raw = [r[0] for r in conn.execute("SELECT directive FROM directives")]
    except Exception:
        return out
    finally:
        conn.close()
    out["directives"] = raw
    for line in raw:
        key, _, val = str(line).partition(":")
        k, v = key.strip().lower(), val.strip()
        if k == "provider":
            out["provider"] = v
        elif k == "description":
            out["description"] = v
            m = re.search(r"\(([^)]*(?:GRCh|GRCm|T2T)[^)]*)\)", v)
            if m:
                out["assembly"] = m.group(1)
            m = re.search(r"version\s+(\S+)", v)
            if m:
                out["version"] = m.group(1).rstrip(",.")
            m = re.search(r"Ensembl\s+(\S+?)\)", v)
            if m:
                out["ensembl"] = m.group(1)
        elif k == "date":
            out["date"] = v
    prov, ver = out.get("provider"), out.get("version")
    if prov and ver:
        out["label"] = f"{prov} {ver}"
    elif prov:
        out["label"] = prov
    return out


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.execute("PRAGMA query_only = 1")
    conn.execute("PRAGMA cache_size = -262144")
    return conn


def _one(attrs: dict, key: str, default: str = "") -> str:
    v = attrs.get(key)
    if not v:
        return default
    return str(v[0]) if isinstance(v, list) else str(v)


class Annotation:
    def __init__(self) -> None:
        self.genes: dict[str, dict] = {}
        self.tx: dict[str, dict] = {}
        self.tx_by_gene: dict[str, list[str]] = defaultdict(list)
        self.gene_type_counts: dict[str, int] = {}
        self.tx_type_counts: dict[str, int] = {}
        self.n_genes = 0
        self.n_tx = 0

    def gene_of(self, tx_id: str) -> str | None:
        rec = self.tx.get(tx_id)
        return rec["gene"] if rec else None

    def variants_per_gene_histogram(self) -> list[int]:
        counts: dict[int, int] = defaultdict(int)
        for gid in self.genes:
            counts[len(self.tx_by_gene.get(gid, []))] += 1
        top = max((k for k in counts if k > 0), default=0)
        return [counts.get(i, 0) for i in range(1, top + 1)]

    def n_multi_transcript_genes(self) -> int:
        return sum(1 for gid in self.genes if len(self.tx_by_gene.get(gid, [])) > 1)


ANN_CACHE_VERSION = 1

_GENE_FIELDS = ("name", "chr", "strand", "type", "hgnc", "level")
_TX_FIELDS = ("gene", "name", "chr", "strand", "type", "tsl", "tags")


def _u(values):
    return _np.array(list(values), dtype="U") if values else _np.zeros(0, dtype="U1")


def load(db_path: str, *, cache_dir: str | None = None, use_cache: bool = True,
         log=print) -> Annotation:
    path = None
    if use_cache:
        try:
            path = _os.path.join(cache_dir or default_cache_dir(),
                                 _cache_key(db_path) + f".ann{ANN_CACHE_VERSION}.npz")
        except OSError:
            path = None

    if path and _os.path.isfile(path):
        try:
            ann = _ann_read(path)
            log(f"    annotation from cache ({ann.n_genes:,} genes, "
                f"{ann.n_tx:,} transcripts)")
            return ann
        except Exception as exc:
            log(f"    annotation cache unreadable ({exc}); rescanning")

    ann = _load_uncached(db_path, log=log)
    if path:
        _ann_write(path, ann, log=log)
    return ann


def _ann_read(path: str) -> Annotation:
    z = _np.load(path, allow_pickle=False)
    ann = Annotation()

    gids = [str(x) for x in z["gene_id"]]
    cols = {f: z["gene_" + f] for f in _GENE_FIELDS}
    gstart, gend = z["gene_start"], z["gene_end"]
    for i, gid in enumerate(gids):
        ann.genes[gid] = {
            "name": str(cols["name"][i]), "chr": str(cols["chr"][i]),
            "start": int(gstart[i]), "end": int(gend[i]),
            "strand": str(cols["strand"][i]), "type": str(cols["type"][i]),
            "hgnc": str(cols["hgnc"][i]), "level": str(cols["level"][i]),
        }

    tids = [str(x) for x in z["tx_id"]]
    tc = {f: z["tx_" + f] for f in _TX_FIELDS}
    tstart, tend = z["tx_start"], z["tx_end"]
    for i, tid in enumerate(tids):
        gid = str(tc["gene"][i])
        tags = str(tc["tags"][i])
        ann.tx[tid] = {
            "gene": gid, "name": str(tc["name"][i]), "chr": str(tc["chr"][i]),
            "start": int(tstart[i]), "end": int(tend[i]),
            "strand": str(tc["strand"][i]), "type": str(tc["type"][i]),
            "tsl": str(tc["tsl"][i]),
            "tags": tags.split("|") if tags else [],
        }
        if gid:
            ann.tx_by_gene[gid].append(tid)

    ann.n_genes = len(ann.genes)
    ann.n_tx = len(ann.tx)
    gt: dict[str, int] = defaultdict(int)
    for g in ann.genes.values():
        gt[g["type"]] += 1
    ann.gene_type_counts = dict(gt)
    tt: dict[str, int] = defaultdict(int)
    for t in ann.tx.values():
        tt[t["type"]] += 1
    ann.tx_type_counts = dict(tt)
    return ann


def _ann_write(path: str, ann: Annotation, *, log=print) -> None:
    tmp = path + ".tmp"
    try:
        _os.makedirs(_os.path.dirname(path), exist_ok=True)
        gids = list(ann.genes)
        tids = list(ann.tx)
        out = {
            "gene_id": _u(gids),
            "gene_start": _np.array([ann.genes[g]["start"] for g in gids],
                                    dtype=_np.int64),
            "gene_end": _np.array([ann.genes[g]["end"] for g in gids],
                                  dtype=_np.int64),
            "tx_id": _u(tids),
            "tx_start": _np.array([ann.tx[t]["start"] for t in tids],
                                  dtype=_np.int64),
            "tx_end": _np.array([ann.tx[t]["end"] for t in tids],
                                dtype=_np.int64),
        }
        for f in _GENE_FIELDS:
            out["gene_" + f] = _u([ann.genes[g][f] for g in gids])
        for f in _TX_FIELDS:
            if f == "tags":
                out["tx_tags"] = _u(["|".join(ann.tx[t]["tags"]) for t in tids])
            else:
                out["tx_" + f] = _u([ann.tx[t][f] for t in tids])
        with open(tmp, "wb") as fh:
            _np.savez_compressed(fh, **out)
        _os.replace(tmp, path)
        log(f"    annotation cached to {path} "
            f"({_os.path.getsize(path) / 1e6:.1f} MB)")
    except Exception as exc:
        log(f"    could not write annotation cache ({exc}); continuing")
        try:
            if _os.path.exists(tmp):
                _os.remove(tmp)
        except OSError:
            pass


def _load_uncached(db_path: str, *, log=print) -> Annotation:
    ann = Annotation()
    conn = _connect(db_path)
    cur = conn.cursor()

    log("  genes ...")
    gt_counts: dict[str, int] = defaultdict(int)
    cur.execute(
        "SELECT id, seqid, start, end, strand, attributes "
        "FROM features WHERE featuretype = 'gene'"
    )
    for gid, chrom, start, end, strand, attrs_json in cur:
        attrs = json.loads(attrs_json) if attrs_json else {}
        gtype = _one(attrs, "gene_type", "unknown")
        gt_counts[gtype] += 1
        ann.genes[gid] = {
            "name": _one(attrs, "gene_name", gid),
            "chr": chrom,
            "start": int(start),
            "end": int(end),
            "strand": strand,
            "type": gtype,
            "hgnc": _one(attrs, "hgnc_id"),
            "level": _one(attrs, "level"),
        }
    ann.gene_type_counts = dict(gt_counts)
    ann.n_genes = len(ann.genes)
    log(f"    {ann.n_genes:,} genes, {len(gt_counts)} biotypes")

    log("  transcripts ...")
    tt_counts: dict[str, int] = defaultdict(int)
    cur.execute(
        "SELECT id, seqid, start, end, strand, attributes "
        "FROM features WHERE featuretype = 'transcript'"
    )
    for tid, chrom, start, end, strand, attrs_json in cur:
        attrs = json.loads(attrs_json) if attrs_json else {}
        gid = _one(attrs, "gene_id") or _one(attrs, "Parent")
        ttype = _one(attrs, "transcript_type", "unknown")
        tt_counts[ttype] += 1
        tags = attrs.get("tag") or []
        if not isinstance(tags, list):
            tags = [str(tags)]
        ann.tx[tid] = {
            "gene": gid,
            "name": _one(attrs, "transcript_name", tid),
            "chr": chrom,
            "start": int(start),
            "end": int(end),
            "strand": strand,
            "type": ttype,
            "tsl": _one(attrs, "transcript_support_level"),
            "tags": [t for t in TAG_RANK if t in tags],
        }
        if gid:
            ann.tx_by_gene[gid].append(tid)
    ann.tx_type_counts = dict(tt_counts)
    ann.n_tx = len(ann.tx)
    log(f"    {ann.n_tx:,} transcripts, {len(tt_counts)} biotypes")

    conn.close()
    return ann


def load_exons(db_path: str, tx_ids, *, batch: int = 800, log=print) -> dict[str, list]:
    tx_list = [t for t in dict.fromkeys(tx_ids) if t]
    if not tx_list:
        return {}
    conn = _connect(db_path)
    cur = conn.cursor()
    out: dict[str, list] = defaultdict(list)
    for i in range(0, len(tx_list), batch):
        chunk = tx_list[i:i + batch]
        ph = ",".join("?" * len(chunk))
        cur.execute(
            f"SELECT r.parent, f.start, f.end, f.attributes "
            f"FROM relations r JOIN features f ON r.child = f.id "
            f"WHERE r.parent IN ({ph}) AND r.level = 1 AND f.featuretype = 'exon'",
            chunk,
        )
        for tid, s, e, attrs_json in cur:
            num = 0
            eid = ""
            if attrs_json:
                attrs = json.loads(attrs_json)
                raw = _one(attrs, "exon_number")
                if raw.isdigit():
                    num = int(raw)
                eid = _one(attrs, "exon_id")
            out[tid].append([int(s), int(e), num, eid])
    conn.close()
    for tid in out:
        out[tid].sort(key=lambda x: x[0])
    log(f"    exon structures for {len(out):,}/{len(tx_list):,} transcripts")
    return dict(out)


def load_cds_bounds(db_path: str, tx_ids, *, batch: int = 800) -> dict[str, tuple[int, int]]:
    tx_list = [t for t in dict.fromkeys(tx_ids) if t]
    if not tx_list:
        return {}
    conn = _connect(db_path)
    cur = conn.cursor()
    out: dict[str, tuple[int, int]] = {}
    for i in range(0, len(tx_list), batch):
        chunk = tx_list[i:i + batch]
        ph = ",".join("?" * len(chunk))
        cur.execute(
            f"SELECT r.parent, MIN(f.start), MAX(f.end) "
            f"FROM relations r JOIN features f ON r.child = f.id "
            f"WHERE r.parent IN ({ph}) AND r.level = 1 AND f.featuretype = 'CDS' "
            f"GROUP BY r.parent",
            chunk,
        )
        for tid, s, e in cur:
            if s is not None and e is not None:
                out[tid] = (int(s), int(e))
    conn.close()
    return out


import hashlib
import os as _os

import numpy as _np

CACHE_VERSION = 1


def default_cache_dir() -> str:
    base = _os.environ.get("XDG_CACHE_HOME") or _os.path.expanduser("~/.cache")
    return _os.path.join(base, "isoviewer", "annotation")


def _cache_key(db_path: str) -> str:
    st = _os.stat(db_path)
    raw = f"{CACHE_VERSION}|{_os.path.abspath(db_path)}|{st.st_size}|{int(st.st_mtime)}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


class Structures:
    __slots__ = ("tx_ids", "offsets", "start", "end", "num", "cds_lo", "cds_hi",
                 "_index")

    def exons_for(self, tx_id: str):
        i = self._index.get(tx_id)
        if i is None:
            return None
        a, b = self.offsets[i], self.offsets[i + 1]
        return [[int(self.start[k]), int(self.end[k]), int(self.num[k])]
                for k in range(a, b)]

    def cds_for(self, tx_id: str):
        i = self._index.get(tx_id)
        if i is None:
            return None
        lo, hi = int(self.cds_lo[i]), int(self.cds_hi[i])
        return (lo, hi) if hi > 0 else None

    def as_dicts(self, tx_ids=None):
        ids = list(tx_ids) if tx_ids is not None else self.tx_ids
        exons, cds = {}, {}
        for t in ids:
            e = self.exons_for(t)
            if e:
                exons[t] = e
            c = self.cds_for(t)
            if c:
                cds[t] = c
        return exons, cds


_EXON_NUM_KEY = '"exon_number":["'


def _exon_number(attrs_json) -> int:
    if not attrs_json:
        return 0
    i = attrs_json.find(_EXON_NUM_KEY)
    if i < 0:
        return 0
    i += len(_EXON_NUM_KEY)
    j = attrs_json.find('"', i)
    if j < 0:
        return 0
    raw = attrs_json[i:j]
    return int(raw) if raw.isdigit() else 0


def _scan_structures(db_path: str, log=print) -> Structures:
    conn = _connect(db_path)
    cur = conn.cursor()

    log("    scanning transcripts …")
    tx_ids: list[str] = []
    index: dict[str, int] = {}
    cur.execute("SELECT id FROM features WHERE featuretype = 'transcript'")
    for (tid,) in cur:
        index[tid] = len(tx_ids)
        tx_ids.append(tid)
    n_tx = len(tx_ids)

    log("    scanning exon parents …")
    parent_of: dict[str, int] = {}
    cur.execute("SELECT parent, child FROM relations WHERE level = 1")
    for parent, child in cur:
        pi = index.get(parent)
        if pi is not None:
            parent_of[child] = pi

    log("    scanning exon coordinates …")
    per_tx: list[list] = [[] for _ in range(n_tx)]
    cds_lo = _np.zeros(n_tx, dtype=_np.int64)
    cds_hi = _np.zeros(n_tx, dtype=_np.int64)
    cur.execute("SELECT id, featuretype, start, end, attributes FROM features "
                "WHERE featuretype IN ('exon', 'CDS')")
    for fid, ftype, fs, fe, attrs_json in cur:
        pi = parent_of.get(fid)
        if pi is None:
            continue
        if ftype == "exon":
            per_tx[pi].append((int(fs), int(fe), _exon_number(attrs_json)))
        else:
            lo = cds_lo[pi]
            cds_lo[pi] = int(fs) if lo == 0 else min(lo, int(fs))
            cds_hi[pi] = max(cds_hi[pi], int(fe))
    conn.close()

    total = sum(len(v) for v in per_tx)
    offsets = _np.zeros(n_tx + 1, dtype=_np.int64)
    start = _np.zeros(total, dtype=_np.int32)
    end = _np.zeros(total, dtype=_np.int32)
    num = _np.zeros(total, dtype=_np.uint16)
    k = 0
    for i, blocks in enumerate(per_tx):
        offsets[i] = k
        blocks.sort(key=lambda x: x[0])
        for (s, e, n) in blocks:
            start[k] = s
            end[k] = e
            num[k] = min(n, 65535)
            k += 1
    offsets[n_tx] = k

    st = Structures()
    st.tx_ids = tx_ids
    st.offsets = offsets
    st.start = start
    st.end = end
    st.num = num
    st.cds_lo = cds_lo
    st.cds_hi = cds_hi
    st._index = index
    log(f"    {n_tx:,} transcripts, {total:,} exons, "
        f"{int((cds_hi > 0).sum()):,} with CDS bounds")
    return st


def load_structures(db_path: str, *, cache_dir: str | None = None,
                    use_cache: bool = True, log=print) -> Structures:
    cache_dir = cache_dir or default_cache_dir()
    path = None
    if use_cache:
        try:
            path = _os.path.join(cache_dir, _cache_key(db_path) + ".npz")
        except OSError:
            path = None

    if path and _os.path.isfile(path):
        try:
            z = _np.load(path, allow_pickle=False)
            st = Structures()
            st.tx_ids = list(z["tx_ids"])
            st.offsets = z["offsets"]
            st.start = z["start"]
            st.end = z["end"]
            st.num = z["num"]
            st.cds_lo = z["cds_lo"]
            st.cds_hi = z["cds_hi"]
            st._index = {t: i for i, t in enumerate(st.tx_ids)}
            log(f"    annotation structures from cache "
                f"({len(st.tx_ids):,} transcripts, {len(st.start):,} exons)")
            return st
        except Exception as exc:
            log(f"    cache unreadable ({exc}); rescanning")

    st = _scan_structures(db_path, log=log)
    if path:
        try:
            _os.makedirs(cache_dir, exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "wb") as fh:
                _np.savez_compressed(
                    fh, tx_ids=_np.array(st.tx_ids, dtype="U"),
                    offsets=st.offsets, start=st.start, end=st.end, num=st.num,
                    cds_lo=st.cds_lo, cds_hi=st.cds_hi)
            _os.replace(tmp, path)
            log(f"    cached to {path} ({_os.path.getsize(path) / 1e6:.1f} MB)")
        except Exception as exc:
            log(f"    could not write cache ({exc}); continuing")
            try:
                if _os.path.exists(path + ".tmp"):
                    _os.remove(path + ".tmp")
            except OSError:
                pass
    return st
