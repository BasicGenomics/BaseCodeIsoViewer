#!/usr/bin/env bash
set -uo pipefail

RUN="${1:?usage: tests/run.sh <isoquant-dir> [outdir]}"
OUT="${2:-$(mktemp -d)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
PY="${PYTHON:-python3}"
NODE="${NODE:-node}"

command -v "$NODE" >/dev/null || { echo "node not found; set NODE=/path/to/node"; exit 2; }
NODE_MAJOR=$("$NODE" -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "node $NODE_MAJOR is too old — DecompressionStream needs node 18+"; exit 2
fi

mkdir -p "$OUT"
REPORT="$OUT/report.html"
rc=0

echo "=== syntax ==="
for f in "$ROOT"/web/js/*.js; do
  "$NODE" --check "$f" || { echo "FAIL $f"; rc=1; }
done
echo "$(ls "$ROOT"/web/js/*.js | wc -l) files parse"

echo
echo "=== build ==="
( cd "$ROOT" && "$PY" -m isoviewer build "$RUN" -o "$REPORT" --strict ) || rc=1

echo
echo "=== render every view ==="
"$NODE" "$HERE/run-report.mjs" "$REPORT" || rc=1

echo
echo "=== targeted checks ==="
for t in shares-sane flow-conserves tokens-in-sync gene-track sample-select \
         plotly-path table-columns-align biotype-gating species-gating \
         compare-runs tour-anchors; do
  printf '  %-22s ' "$t"
  if "$NODE" --stack-size=4000 "$HERE/$t.mjs" "$REPORT" >/dev/null 2>&1; then
    echo ok
  else
    echo FAIL
    "$NODE" --stack-size=4000 "$HERE/$t.mjs" "$REPORT" 2>&1 | tail -12
    rc=1
  fi
done
printf '  %-22s ' "css-tokens-defined"
if "$NODE" "$HERE/css-tokens-defined.mjs" >/dev/null 2>&1; then echo ok; else echo FAIL; rc=1; fi

if [ -f "$OUT/expected.json" ]; then
  echo
  echo "=== numbers ==="
  "$NODE" "$HERE/verify-numbers.mjs" "$REPORT" "$OUT/expected.json" || rc=1
else
  echo
  echo "(no $OUT/expected.json — skipping the numeric cross-check)"
fi

echo
[ $rc -eq 0 ] && echo "PASS  report at $REPORT" || echo "FAIL"
exit $rc
