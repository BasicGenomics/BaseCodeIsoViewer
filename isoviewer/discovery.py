from __future__ import annotations

import glob
import json
import os
import pickle
from dataclasses import dataclass, field

UPSTREAM_MARKERS = ("QC_files", "summaries", "metadata", "read_flow_files")


@dataclass
class RunPaths:
    root: str
    name: str
    out_dir: str
    group_token: str
    files: dict[str, str] = field(default_factory=dict)
    upstream: dict[str, str] = field(default_factory=dict)
    upstream_root: str | None = None
    params: dict = field(default_factory=dict)
    manifest: dict = field(default_factory=dict)
    versions_log: str = ""
    missing: list[str] = field(default_factory=list)

    def has(self, key: str) -> bool:
        return key in self.files

    def get(self, key: str) -> str | None:
        return self.files.get(key)

    def require(self, key: str) -> str:
        p = self.files.get(key)
        if p is None:
            raise FileNotFoundError(
                f"required input '{key}' not found under {self.out_dir}"
            )
        return p


def _first(*candidates: str) -> str | None:
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def _glob1(pattern: str) -> str | None:
    hits = sorted(glob.glob(pattern))
    return hits[0] if hits else None


def detect_run_name(root: str) -> str:
    params = load_params(root)
    if params.get("prefix"):
        return str(params["prefix"])

    for entry in sorted(os.listdir(root)):
        sub = os.path.join(root, entry)
        if os.path.isdir(sub) and glob.glob(os.path.join(sub, "*.read_assignments.tsv.gz")):
            hit = glob.glob(os.path.join(sub, "*.read_assignments.tsv.gz"))[0]
            return os.path.basename(hit)[: -len(".read_assignments.tsv.gz")]
    raise FileNotFoundError(
        f"could not determine run name under {root}: no <name>/<name>.read_assignments.tsv.gz"
    )


def load_params(root: str) -> dict:
    path = os.path.join(root, ".params")
    if not os.path.isfile(path):
        return {}

    class _Missing:
        def __init__(self, *a, **k):
            self.args = a
            self.kwargs = k

        def __repr__(self):
            return "<unavailable>"

        def __setstate__(self, state):
            self.state = state

        def __reduce__(self):
            return (_Missing, ())

    class _Loader(pickle.Unpickler):
        def find_class(self, module, name):
            try:
                return super().find_class(module, name)
            except Exception:
                return _Missing

    try:
        with open(path, "rb") as fh:
            obj = _Loader(fh).load()
    except Exception:
        return {}

    raw = getattr(obj, "__dict__", None)
    if not isinstance(raw, dict):
        return {}

    out: dict = {}
    for k, v in raw.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, (list, tuple)):
            if all(isinstance(x, (str, int, float, bool)) or x is None for x in v):
                out[k] = list(v)
    return out


def load_manifest(root: str) -> dict:
    path = os.path.join(root, "logs", "run_manifest.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return {}


def load_versions_log(root: str, name: str) -> str:
    for cand in (os.path.join(root, "logs", f"{name}.versions.log"),
                 _glob1(os.path.join(root, "logs", "*.versions.log")) or ""):
        if cand and os.path.isfile(cand):
            try:
                with open(cand, encoding="utf-8", errors="replace") as fh:
                    return fh.read()
            except OSError:
                return ""
    return ""


def detect_group_token(out_dir: str, name: str, params: dict) -> str:
    candidates: list[str] = []
    rg = params.get("read_group")
    if isinstance(rg, list):
        candidates += [str(x).replace(":", "_") for x in rg if x]
    elif isinstance(rg, str) and rg:
        candidates.append(rg.replace(":", "_"))

    for tok in candidates:
        if os.path.isfile(os.path.join(out_dir, f"{name}.gene_grouped_{tok}_counts.tsv")):
            return tok

    hit = _glob1(os.path.join(out_dir, f"{name}.gene_grouped_*_counts.tsv"))
    if hit:
        base = os.path.basename(hit)
        return base[len(f"{name}.gene_grouped_"): -len("_counts.tsv")]

    hit = _glob1(os.path.join(out_dir, f"{name}.discovered_gene_grouped_*_counts.tsv"))
    if hit:
        base = os.path.basename(hit)
        return base[len(f"{name}.discovered_gene_grouped_"): -len("_counts.tsv")]

    return candidates[0] if candidates else "tag_SM"


_ISOQUANT_HINTS = (
    (),
    ("results", "isoquant"),
    ("BaseCode", "results", "isoquant"),
    ("isoquant",),
)


def _looks_like_isoquant(path: str) -> bool:
    if not os.path.isdir(path):
        return False
    if not os.path.isfile(os.path.join(path, ".params")):
        return False
    return any(os.path.isdir(os.path.join(path, e)) for e in os.listdir(path))


def resolve_isoquant_dir(path: str) -> str:
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        raise NotADirectoryError(path)
    tried = []
    for hint in _ISOQUANT_HINTS:
        cand = os.path.join(path, *hint)
        tried.append(cand)
        if _looks_like_isoquant(cand):
            return cand
    raise FileNotFoundError(
        "no IsoQuant output directory found. Looked for a directory with a "
        "`.params` file in:\n  " + "\n  ".join(tried))


def discover(root: str, name: str | None = None) -> RunPaths:
    root = resolve_isoquant_dir(root)
    if not os.path.isdir(root):
        raise NotADirectoryError(root)

    params = load_params(root)
    name = name or detect_run_name(root)
    out_dir = os.path.join(root, name)
    if not os.path.isdir(out_dir):
        raise FileNotFoundError(f"per-run output directory not found: {out_dir}")

    tok = detect_group_token(out_dir, name, params)
    rp = RunPaths(
        root=root,
        name=name,
        out_dir=out_dir,
        group_token=tok,
        params=params,
        manifest=load_manifest(root),
    )
    rp.versions_log = load_versions_log(root, name)

    def o(suffix: str) -> str:
        return os.path.join(out_dir, f"{name}.{suffix}")

    def r(suffix: str) -> str:
        return os.path.join(root, f"{name}.{suffix}")

    wanted = {
        "gene_counts": o("gene_counts.tsv"),
        "gene_tpm": o("gene_tpm.tsv"),
        "transcript_counts": o("transcript_counts.tsv"),
        "transcript_tpm": o("transcript_tpm.tsv"),
        "gene_grouped_counts": o(f"gene_grouped_{tok}_counts.tsv"),
        "gene_grouped_tpm": o(f"gene_grouped_{tok}_tpm.tsv"),
        "transcript_grouped_counts": o(f"transcript_grouped_{tok}_counts.tsv"),
        "transcript_grouped_tpm": o(f"transcript_grouped_{tok}_tpm.tsv"),
        "ref_support": o("reference_variant_support.per_variant.tsv"),
        "models_gtf": o("transcript_models.gtf"),
        "disc_gene_counts": o("discovered_gene_counts.tsv"),
        "disc_gene_tpm": o("discovered_gene_tpm.tsv"),
        "disc_transcript_counts": o("discovered_transcript_counts.tsv"),
        "disc_transcript_tpm": o("discovered_transcript_tpm.tsv"),
        "disc_gene_grouped_counts": o(f"discovered_gene_grouped_{tok}_counts.tsv"),
        "disc_gene_grouped_tpm": o(f"discovered_gene_grouped_{tok}_tpm.tsv"),
        "disc_transcript_grouped_counts": o(f"discovered_transcript_grouped_{tok}_counts.tsv"),
        "disc_transcript_grouped_tpm": o(f"discovered_transcript_grouped_{tok}_tpm.tsv"),
        "disc_support": o("discovered_variant_support.per_variant.tsv"),
        "sqanti": o("novel_vs_known.SQANTI-like.tsv"),
        "read_assignments": o("read_assignments.tsv.gz"),
        "model_reads": o("transcript_model_reads.tsv.gz"),
        "corrected_bed": o("corrected_reads.bed.gz"),
        "exon_counts": o("exon_counts.tsv"),
        "intron_counts": o("intron_counts.tsv"),
        "support_summary": o("variant_support.summary.txt"),
        "adapted_molecules": _first(r("adapted_molecules.tsv.gz"),
                                    r("adapted_molecules.tsv"))
                             or r("adapted_molecules.tsv"),
        "annotated_bam": r("annotated.sorted.bam"),
        "isoquant_log": _first(
            os.path.join(root, "isoquant.log"),
            os.path.join(root, "logs", f"{name}.run_isoquant.log"),
            _glob1(os.path.join(root, "logs", "*.run_isoquant.log")) or "",
        ) or os.path.join(root, "isoquant.log"),
    }
    for key, path in wanted.items():
        if os.path.isfile(path):
            rp.files[key] = path
        else:
            rp.missing.append(key)

    db = _glob1(os.path.join(root, "*.db"))
    if db:
        rp.files["genedb"] = db
    else:
        rp.missing.append("genedb")

    h5mu = _glob1(os.path.join(root, "mudata", "*.h5mu"))
    if h5mu:
        rp.files["h5mu"] = h5mu

    rp.upstream_root, rp.upstream = _discover_upstream(root, name)
    return rp


def _discover_upstream(root: str, name: str) -> tuple[str | None, dict[str, str]]:
    parent = os.path.dirname(root)
    found = [m for m in UPSTREAM_MARKERS if os.path.isdir(os.path.join(parent, m))]
    if len(found) < 2:
        return None, {}

    files: dict[str, str] = {}

    def put(key: str, path: str | None) -> None:
        if path:
            files[key] = path

    put("summary_stats", _first(
        os.path.join(parent, "QC_files", f"{name}_summary_stats.csv"),
        _glob1(os.path.join(parent, "QC_files", "*_summary_stats.csv")) or "",
    ))
    put("recon_stats", _first(
        os.path.join(parent, "QC_files", f"{name}_long_form_reconstruction_stats.csv.gz"),
        os.path.join(parent, "QC_files", f"{name}_long_form_reconstruction_stats.csv"),
        _glob1(os.path.join(parent, "QC_files", "*_long_form_reconstruction_stats.csv.gz")) or "",
        _glob1(os.path.join(parent, "QC_files", "*_long_form_reconstruction_stats.csv")) or "",
    ))
    put("recon_stats_full", _first(
        os.path.join(parent, "QC_files",
                     f"{name}_long_form_reconstruction_stats_comprehensive.csv.gz"),
        _glob1(os.path.join(parent, "QC_files",
                            "*_long_form_reconstruction_stats_comprehensive.csv.gz")) or "",
    ))
    put("conversion_summary", _first(
        os.path.join(parent, "QC_files", "conversion_rates", f"{name}_summary_conversion_rates.csv"),
        _glob1(os.path.join(parent, "QC_files", "conversion_rates", "*_summary_conversion_rates.csv")) or "",
    ))
    put("read_type_summary", _first(
        os.path.join(parent, "QC_files", "general_stats", f"{name}_summary_read_type.csv"),
        _glob1(os.path.join(parent, "QC_files", "general_stats", "*_summary_read_type.csv")) or "",
    ))
    put("mapping_categories", _first(
        os.path.join(parent, "QC_files", "general_stats", f"{name}_mapping_categories.csv"),
        _glob1(os.path.join(parent, "QC_files", "general_stats", "*_mapping_categories.csv")) or "",
    ))
    put("mapping_quality", _first(
        os.path.join(parent, "QC_files", "mapping_quality", f"{name}_summary_mapping_quality_read_type.csv"),
        _glob1(os.path.join(parent, "QC_files", "mapping_quality", "*_summary_mapping_quality_read_type.csv")) or "",
    ))
    put("recon_status_read_type", _first(
        os.path.join(parent, "QC_files", "gene_reconstruction_status",
                     f"{name}_summary_reconstruction_status_read_type.csv"),
        _glob1(os.path.join(parent, "QC_files", "gene_reconstruction_status",
                            "*_summary_reconstruction_status_read_type.csv")) or "",
    ))
    put("tso_capture", _first(
        os.path.join(parent, "QC_files", "insert_overlap_sizes", f"{name}_tso_capture.csv"),
        _glob1(os.path.join(parent, "QC_files", "insert_overlap_sizes", "*_tso_capture.csv")) or "",
    ))
    put("insert_size", _glob1(os.path.join(parent, "QC_files", "insert_overlap_sizes", "*_insert_size.csv.gz")))
    put("aligned_size", _glob1(os.path.join(parent, "QC_files", "insert_overlap_sizes", "*_aligned_size.csv.gz")))
    put("overlap_size", _glob1(os.path.join(parent, "QC_files", "insert_overlap_sizes", "*_overlap_size.csv.gz")))
    put("hisat2", _first(
        os.path.join(parent, "summaries", f"{name}_summary_hisat2.txt"),
        _glob1(os.path.join(parent, "summaries", "*_summary_hisat2.txt")) or "",
    ))
    put("samplesheet", _first(
        os.path.join(parent, "metadata", f"{name}_samplesheet.csv"),
        _glob1(os.path.join(parent, "metadata", "*_samplesheet.csv")) or "",
    ))
    return parent, files
