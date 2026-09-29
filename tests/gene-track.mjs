import fs from "node:fs";
import path from "node:path";
import { installDom } from "./dom-shim.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
installDom({});

globalThis.IV = { dom: {}, fmt: {}, chart: {}, pal: {} };
const core = fs.readFileSync(path.join(HERE, "..", "web", "js", "00-core.js"), "utf8");
new Function("window", core)(globalThis);
for (const f of ["07-genetrack.js", "08-overlays.js"]) {
  new Function(fs.readFileSync(path.join(HERE, "..", "web", "js", f), "utf8"))();
}
const GT = globalThis.IV.geneTrack;
const OV = globalThis.IV.overlays;

const fails = [];
function check(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = w === undefined ? !!got : g === w;
  if (!ok) fails.push(`${label}\n      got      ${g}\n      expected ${w}`);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

console.log("--- exonSegments (UTR / CDS decomposition) ---");
const seg = GT.exonSegments;

check("exon wholly inside the CDS is one coding piece",
  seg([100, 200], [50, 300], true), [{ s: 100, e: 200, coding: true }]);

check("exon wholly before the CDS is one UTR piece",
  seg([100, 200], [300, 400], true), [{ s: 100, e: 200, coding: false }]);

check("exon wholly after the CDS is one UTR piece",
  seg([500, 600], [300, 400], true), [{ s: 500, e: 600, coding: false }]);

check("exon straddling the CDS start splits into UTR + CDS",
  seg([100, 200], [150, 400], true),
  [{ s: 100, e: 149, coding: false }, { s: 150, e: 200, coding: true }]);

check("exon straddling the CDS end splits into CDS + UTR",
  seg([100, 200], [50, 150], true),
  [{ s: 100, e: 150, coding: true }, { s: 151, e: 200, coding: false }]);

check("exon containing the whole CDS splits into three",
  seg([100, 300], [150, 200], true),
  [{ s: 100, e: 149, coding: false }, { s: 150, e: 200, coding: true },
   { s: 201, e: 300, coding: false }]);

check("no CDS in a mode that has CDS => non-coding, thin",
  seg([100, 200], null, true), [{ s: 100, e: 200, coding: false }]);
check("no CDS in a mode that never has CDS => keep full height",
  seg([100, 200], null, false), [{ s: 100, e: 200, coding: true }]);

for (const [ex, cds] of [[[100, 300], [150, 200]], [[100, 200], [150, 400]],
                         [[10, 90], [1, 1000]], [[10, 90], [95, 99]]]) {
  const segs = seg(ex, cds, true);
  const covered = segs.reduce((a, s) => a + (s.e - s.s + 1), 0);
  const contiguous = segs.every((s, i) => i === 0 || s.s === segs[i - 1].e + 1);
  check(`tiles ${JSON.stringify(ex)} against CDS ${JSON.stringify(cds)} exactly`,
    covered === ex[1] - ex[0] + 1 && contiguous
      && segs[0].s === ex[0] && segs[segs.length - 1].e === ex[1], true);
}

console.log("--- packLanes (domain lanes) ---");
const pk = GT.packLanes;

check("disjoint features share one lane",
  pk([{ segs: [[10, 20]] }, { segs: [[30, 40]] }]).lanes, 1);
check("overlapping features take two lanes",
  pk([{ segs: [[10, 30]] }, { segs: [[20, 40]] }]).lanes, 2);
check("three mutually overlapping features take three lanes",
  pk([{ segs: [[10, 40]] }, { segs: [[20, 50]] }, { segs: [[30, 60]] }]).lanes, 3);
const reuse = pk([{ segs: [[10, 20]] }, { segs: [[15, 25]] }, { segs: [[30, 40]] }]);
check("a later disjoint feature reuses lane 0", reuse.lanes, 2);
check("  and is placed there",
  reuse.items.find((i) => i.gs === 30).lane, 0);
check("multi-segment features contribute every segment",
  pk([{ segs: [[10, 20], [30, 40]] }]).items.length, 2);
const many = pk(Array.from({ length: 12 }, (_, i) =>
  ({ segs: [[i * 5, i * 5 + 12]] })));
let clash = false;
for (const a of many.items) {
  for (const b of many.items) {
    if (a === b || a.lane !== b.lane) continue;
    if (a.gs <= b.ge && b.gs <= a.ge) clash = true;
  }
}
check("no two items overlap within a lane", clash, false);

console.log("--- parsePosition ---");
const pp = GT.parsePosition;
check("chr:pos", pp("chr17:7,668,500", "chr17").pos, 7668500);
check("bare chromosome name", pp("17:7668500", "chr17").pos, 7668500);
check("plain coordinate", pp("7668500", "chr17").pos, 7668500);
check("wrong chromosome is an error, not a silent jump",
  !!pp("chr7:100", "chr17").error, true);
check("nonsense is an error", !!pp("hello", "chr17").error, true);
check("empty is ignored", pp("", "chr17"), null);

console.log("--- projectProtein (protein -> genomic) ---");
const proj = OV.projectProtein;
const buildPy = fs.readFileSync(path.join(HERE, "..", "isoviewer", "build.py"), "utf8");
check("build.py still encodes minus strand as 1",
  /STRAND_CODE\s*=\s*\{"\+":\s*0,\s*"-":\s*1,\s*"\.":\s*2\}/.test(buildPy), true);
const total = (segs) => segs.reduce((a, s) => a + (s[1] - s[0] + 1), 0);

check("plus strand, one exon, first two residues",
  proj([[1000, 1100]], [1000, 1100], 0, 1, 2), [[1000, 1005]]);
check("minus strand, one exon, first two residues",
  proj([[1000, 1100]], [1000, 1100], 1, 1, 2), [[1095, 1100]]);

check("plus strand spanning an exon junction",
  proj([[1000, 1008], [2000, 2008]], [1000, 2008], 0, 3, 4),
  [[1006, 1008], [2000, 2002]]);
check("residue 1, plus strand, is at the start of the low exon",
  proj([[1000, 1008], [2000, 2008]], [1000, 2008], 0, 1, 1), [[1000, 1002]]);
check("residue 1, minus strand, is at the end of the high exon",
  proj([[1000, 1008], [2000, 2008]], [1000, 2008], 1, 1, 1), [[2006, 2008]]);
check("the two strands genuinely disagree",
  JSON.stringify(proj([[1000, 1008], [2000, 2008]], [1000, 2008], 0, 1, 1))
    !== JSON.stringify(proj([[1000, 1008], [2000, 2008]], [1000, 2008], 1, 1, 1)),
  true);
check("minus strand spanning an exon junction",
  proj([[1000, 1008], [2000, 2008]], [1000, 2008], 1, 3, 4),
  [[1006, 1008], [2000, 2002]]);

check("5' UTR is not consumed by residue 1",
  proj([[1000, 1100]], [1050, 1100], 0, 1, 1), [[1050, 1052]]);

let lenOk = true;
for (const strand of [0, 1]) {
  for (const [p1, p2] of [[1, 1], [1, 10], [5, 25], [30, 33]]) {
    const segs = proj([[1000, 1059], [2000, 2059]], [1000, 2059], strand, p1, p2);
    if (total(segs) !== 3 * (p2 - p1 + 1)) lenOk = false;
  }
}
check("a residue range always maps to 3n nucleotides", lenOk, true);

check("no CDS yields nothing", proj([[1, 100]], null, 0, 1, 5), []);
check("no exons yields nothing", proj([], [1, 100], 0, 1, 5), []);

if (process.argv.includes("--live")) {
  console.log("--- projectProtein against Ensembl (TP53, minus strand) ---");
  const E = "https://rest.ensembl.org";
  const TX = "ENST00000269305";
  const tx = await fetch(`${E}/lookup/id/${TX}?expand=1;content-type=application/json`)
    .then((r) => r.json());
  const exons = tx.Exon.map((e) => [e.start, e.end]).sort((a, b) => a[0] - b[0]);
  const strand = tx.strand === -1 ? 1 : 0;
  const tr = tx.Translation;
  const cds = [Math.min(tr.start, tr.end), Math.max(tr.start, tr.end)];
  check("TP53 is on the minus strand", strand, 1);

  const feats = await fetch(`${E}/overlap/translation/${tr.id}`
    + "?feature=protein_feature;content-type=application/json").then((r) => r.json());
  const pfam = feats.filter((f) => f.type === "Pfam");
  check("Ensembl returns Pfam features for TP53", pfam.length > 0, true);

  let allInsideCds = true, allRightLength = true, allInsideExons = true;
  for (const f of pfam) {
    const segs = proj(exons, cds, strand, f.start, f.end);
    if (!segs.length) continue;
    if (total(segs) !== 3 * (f.end - f.start + 1)) allRightLength = false;
    for (const s of segs) {
      if (s[0] < cds[0] || s[1] > cds[1]) allInsideCds = false;
      let covered = 0;
      for (const ex of exons) {
        const a = Math.max(s[0], ex[0]), b = Math.min(s[1], ex[1]);
        if (b >= a) covered += b - a + 1;
      }
      if (covered !== s[1] - s[0] + 1) allInsideExons = false;
    }
  }
  check("every Pfam projection lands inside the CDS", allInsideCds, true);
  check("every Pfam projection lands inside exons, never an intron",
    allInsideExons, true);
  check("every Pfam projection is 3n nucleotides long", allRightLength, true);

  const tet = pfam.find((f) => /tetramer/i.test(f.description || ""));
  const dbd = pfam.find((f) => /P53|DNA-binding/i.test(f.description || "")
    && !/tetramer/i.test(f.description || ""));
  if (tet && dbd) {
    const st = proj(exons, cds, strand, tet.start, tet.end);
    const sd = proj(exons, cds, strand, dbd.start, dbd.end);
    check("C-terminal domain sits at lower coordinates on a minus-strand gene",
      st[0][0] < sd[0][0], true);
  } else {
    console.log("  --   (skipped strand-orientation check: domains not both found)");
  }
} else {
  console.log("  --   (run with --live to also check against Ensembl)");
}

console.log();
if (fails.length) {
  console.log(`FAILURES (${fails.length}):`);
  for (const f of fails) console.log("  " + f);
  process.exit(1);
}
console.log("GENE TRACK GEOMETRY OK");
