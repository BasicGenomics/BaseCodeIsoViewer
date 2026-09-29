from __future__ import annotations

import numpy as np
import pandas as pd

NUMERIC = (
    "length", "exons", "ref_length", "ref_exons",
    "diff_to_TSS", "diff_to_TTS", "diff_to_gene_TSS", "diff_to_gene_TTS",
    "perc_A_downstream_TTS", "n_indels", "n_indels_junc",
    "iso_exp", "gene_exp", "ratio_exp", "ratio_TSS",
    "ORF_length", "CDS_length", "min_cov", "sd_cov", "FL",
    "dist_to_CAGE_peak", "dist_to_polyA_site", "polyA_dist",
)
TEXT = (
    "chrom", "strand", "structural_category", "subcategory",
    "associated_gene", "associated_transcript", "FSM_class", "coding",
    "RTS_stage", "all_canonical", "predicted_NMD",
    "within_CAGE_peak", "within_polyA_site", "polyA_motif",
    "polyA_motif_found", "seq_A_downstream_TTS", "bite",
)

STRUCTURAL_ORDER = (
    "full_splice_match",
    "incomplete_splice_match",
    "mono_exon_match",
    "novel_in_catalog",
    "novel_not_in_catalog",
    "genic",
    "genic_intron",
    "antisense",
    "fusion",
    "intergenic",
)

STRUCTURAL_LABEL = {
    "full_splice_match": "Full splice match",
    "incomplete_splice_match": "Incomplete splice match",
    "mono_exon_match": "Mono-exon match",
    "novel_in_catalog": "Novel in catalog (NIC)",
    "novel_not_in_catalog": "Novel not in catalog (NNIC)",
    "genic": "Genic",
    "genic_intron": "Genic intron",
    "antisense": "Antisense",
    "fusion": "Fusion",
    "intergenic": "Intergenic",
}

_NA = {"NA", "na", "N/A", "", ".", "nan", "NaN", "None"}


class Sqanti:
    def __init__(self, ids: list[str], cols: dict[str, np.ndarray], populated: set[str]):
        self.ids = ids
        self.cols = cols
        self.populated = populated
        self.index = {t: i for i, t in enumerate(ids)}

    @property
    def n(self) -> int:
        return len(self.ids)

    def has(self, key: str) -> bool:
        return key in self.populated

    def get(self, key: str):
        return self.cols.get(key)

    def category_counts(self) -> dict[str, int]:
        cat = self.cols.get("structural_category")
        if cat is None:
            return {}
        vals, counts = np.unique(cat, return_counts=True)
        return {str(v): int(c) for v, c in zip(vals, counts)}

    def subcategory_events(self) -> dict[str, int]:
        sub = self.cols.get("subcategory")
        if sub is None:
            return {}
        out: dict[str, int] = {}
        for s in sub:
            if not s or s == ".":
                continue
            for part in str(s).split(";"):
                part = part.strip()
                if part:
                    out[part] = out.get(part, 0) + 1
        return out


def load(path: str, *, log=print) -> Sqanti:
    df = pd.read_csv(path, sep="\t", header=0, dtype=str, keep_default_na=False)
    if "isoform" not in df.columns:
        raise ValueError(f"{path}: expected an 'isoform' column")
    ids = df["isoform"].astype(str).tolist()

    cols: dict[str, np.ndarray] = {}
    populated: set[str] = set()

    for c in TEXT:
        if c not in df.columns:
            continue
        vals = df[c].astype(str).str.strip()
        arr = vals.where(~vals.isin(_NA), "").to_numpy()
        cols[c] = arr
        if (arr != "").any():
            populated.add(c)

    for c in NUMERIC:
        if c not in df.columns:
            continue
        raw = df[c].astype(str).str.strip()
        num = pd.to_numeric(raw.where(~raw.isin(_NA), None), errors="coerce")
        if num.notna().any():
            populated.add(c)
        cols[c] = num.fillna(np.nan).to_numpy(dtype=np.float32)

    log(f"    {len(ids):,} novel models; {len(populated)} populated columns, "
        f"{len(cols) - len(populated)} all-NA (hidden)")
    return Sqanti(ids, cols, populated)
