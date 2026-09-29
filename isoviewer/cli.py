from __future__ import annotations

import argparse
import json
import os
import sys
import time

from . import assemble
from .build import VERSION
from .discovery import discover
from .orchestrate import run_build


def cmd_build(args) -> int:
    t0 = time.time()
    res = run_build(
        args.isoquant_dir,
        name=args.name,
        max_unexpressed_per_gene=args.max_unexpressed_per_gene,
        skip_upstream=args.no_upstream,
        annotation_cache=not args.no_annotation_cache,
        verbose=not args.quiet,
    )

    out = args.output or os.path.join(
        os.getcwd(), f"{res.core['run']['name']}_isoviewer_v{VERSION}.html")
    size = assemble.write_report(
        out, res.blocks, title="IsoViewer · " + res.core["run"]["name"])

    failed = [c for c in res.core["checks"] if not c["ok"]]
    print()
    print(f"  payload  {res.total_bytes / 1e6:8.2f} MB in {len(res.blocks)} blocks")
    print(f"  report   {size / 1e6:8.2f} MB  -> {out}")
    print(f"  checks   {len(res.core['checks']) - len(failed)}/"
          f"{len(res.core['checks'])} reconciliation checks passed")
    for c in failed:
        print(f"    MISMATCH {c['label']}: expected {c['expected']}, got {c['actual']}")
    print(f"  built in {time.time() - t0:.1f}s")

    if args.dump_core:
        with open(args.dump_core, "w") as fh:
            json.dump(res.core, fh, indent=1)
        print(f"  core JSON written to {args.dump_core}")

    return 1 if (failed and args.strict) else 0


def cmd_inspect(args) -> int:
    rp = discover(args.isoquant_dir, args.name)
    print(f"run           {rp.name}")
    print(f"root          {rp.root}")
    print(f"output dir    {rp.out_dir}")
    print(f"group token   {rp.group_token}")
    print(f"IsoQuant      {rp.params.get('_version', 'unknown')}")
    print(f"pipeline      {rp.manifest.get('version', 'unknown')}")
    print(f"upstream QC   {rp.upstream_root or 'not detected'}")
    print()
    print(f"inputs found  ({len(rp.files)}):")
    for k in sorted(rp.files):
        try:
            sz = os.path.getsize(rp.files[k])
        except OSError:
            sz = 0
        print(f"  {k:32s} {sz / 1e6:10.2f} MB  {os.path.basename(rp.files[k])}")
    if rp.missing:
        print()
        print(f"absent ({len(rp.missing)}): {', '.join(rp.missing)}")
    if rp.upstream:
        print()
        print(f"upstream artefacts ({len(rp.upstream)}):")
        for k in sorted(rp.upstream):
            print(f"  {k:26s} {os.path.basename(rp.upstream[k])}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="isoviewer",
        description="Build an interactive IsoViewer report from an IsoQuant run.")
    p.add_argument("--version", action="version", version="IsoViewer " + VERSION)
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="build a self-contained HTML report")
    b.add_argument("isoquant_dir",
                   help="the results/isoquant directory of a pipeline run")
    b.add_argument("-o", "--output", default=None, help="output .html path")
    b.add_argument("-n", "--name", default=None,
                   help="run prefix; inferred from .params or the layout by default")
    b.add_argument("--max-unexpressed-per-gene", type=int, default=0,
                   help="keep up to N annotated variants per gene that were never "
                        "observed - no count, no molecule, no support row - purely "
                        "to outline them in the gene model (default 0, i.e. drop "
                        "them). Variants below the stringency floor were observed "
                        "and are always kept.")
    b.add_argument("--no-annotation-cache", action="store_true",
                   help="re-read the gene DB instead of using the cached parse "
                        "under ~/.cache/isoviewer/annotation")
    b.add_argument("--no-upstream", action="store_true",
                   help="ignore the upstream BaseCode QC directory")
    b.add_argument("--dump-core", default=None,
                   help="also write the core payload as readable JSON")
    b.add_argument("--strict", action="store_true",
                   help="exit non-zero if any reconciliation check fails")
    b.add_argument("-q", "--quiet", action="store_true")
    b.set_defaults(func=cmd_build)

    i = sub.add_parser("inspect", help="report what would be read, and what is missing")
    i.add_argument("isoquant_dir")
    i.add_argument("-n", "--name", default=None)
    i.set_defaults(func=cmd_inspect)

    args = p.parse_args(argv)
    try:
        return args.func(args)
    except FileNotFoundError as exc:
        print(f"isoviewer: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
