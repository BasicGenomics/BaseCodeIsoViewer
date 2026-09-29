from __future__ import annotations

import re
from collections import defaultdict

RX_GID = re.compile(r'gene_id "([^"]+)"')
RX_TID = re.compile(r'transcript_id "([^"]+)"')
RX_GNAME = re.compile(r'gene_name "([^"]+)"')
RX_GTYPE = re.compile(r'gene_type "([^"]+)"')
RX_ENUM = re.compile(r'exon_number "([^"]+)"')

NOVEL_SOURCE = "IsoQuant"


class Models:
    def __init__(self) -> None:
        self.genes: dict[str, dict] = {}
        self.tx: dict[str, dict] = {}
        self.tx_by_gene: dict[str, list[str]] = defaultdict(list)
        self.exons: dict[str, list] = {}
        self.cds: dict[str, tuple[int, int]] = {}
        self.source_counts: dict[str, int] = {}
        self.class_counts: dict[str, int] = {}


def _novel_class(tx_id: str, is_novel: bool) -> str:
    if not is_novel:
        return "known"
    if tx_id.endswith(".nnic"):
        return "nnic"
    if tx_id.endswith(".nic"):
        return "nic"
    return "novel"


def load(gtf_path: str, *, log=print) -> Models:
    m = Models()
    exons: dict[str, list] = defaultdict(list)
    cds_min: dict[str, int] = {}
    cds_max: dict[str, int] = {}
    src_counts: dict[str, int] = defaultdict(int)
    cls_counts: dict[str, int] = defaultdict(int)
    n_lines = 0

    with open(gtf_path) as fh:
        for line in fh:
            if not line or line[0] == "#":
                continue
            parts = line.rstrip("\n").split("\t", 8)
            if len(parts) < 9:
                continue
            seqid, source, feature, start_s, end_s, _score, strand = parts[:7]
            attrs = parts[8]
            n_lines += 1
            start, end = int(start_s), int(end_s)

            if feature == "gene":
                gm = RX_GID.search(attrs)
                if not gm:
                    continue
                gid = gm.group(1)
                is_novel = source == NOVEL_SOURCE
                gname = RX_GNAME.search(attrs)
                gtype = RX_GTYPE.search(attrs)
                m.genes[gid] = {
                    "name": gname.group(1) if gname else gid,
                    "chr": seqid,
                    "start": start,
                    "end": end,
                    "strand": strand,
                    "type": gtype.group(1) if gtype else ("novel" if is_novel else "unknown"),
                    "novel": is_novel,
                    "source": source,
                }
                continue

            tm = RX_TID.search(attrs)
            if not tm:
                continue
            tid = tm.group(1)

            if feature == "transcript":
                gm = RX_GID.search(attrs)
                gid = gm.group(1) if gm else ""
                is_novel = source == NOVEL_SOURCE
                klass = _novel_class(tid, is_novel)
                src_counts[source] += 1
                cls_counts[klass] += 1
                m.tx[tid] = {
                    "gene": gid,
                    "chr": seqid,
                    "start": start,
                    "end": end,
                    "strand": strand,
                    "novel": is_novel,
                    "class": klass,
                    "source": source,
                }
                if gid:
                    m.tx_by_gene[gid].append(tid)
                    g = m.genes.get(gid)
                    if g is None:
                        m.genes[gid] = {
                            "name": gid, "chr": seqid, "start": start, "end": end,
                            "strand": strand,
                            "type": "novel" if is_novel else "unknown",
                            "novel": is_novel, "source": source,
                        }
                    else:
                        g["start"] = min(g["start"], start)
                        g["end"] = max(g["end"], end)

            elif feature == "exon":
                en = RX_ENUM.search(attrs)
                exons[tid].append([start, end, int(en.group(1)) if en else 0])

            elif feature == "CDS":
                lo = cds_min.get(tid)
                cds_min[tid] = start if lo is None else min(lo, start)
                hi = cds_max.get(tid)
                cds_max[tid] = end if hi is None else max(hi, end)

    for tid in exons:
        exons[tid].sort(key=lambda x: x[0])
    m.exons = dict(exons)
    m.cds = {t: (cds_min[t], cds_max[t]) for t in cds_min if t in cds_max}
    m.source_counts = dict(src_counts)
    m.class_counts = dict(cls_counts)

    log(f"    {n_lines:,} GTF lines: {len(m.genes):,} model genes, "
        f"{len(m.tx):,} models ({dict(cls_counts)})")
    log(f"    sources: {dict(src_counts)}")
    return m
