import fs from "node:fs";
import path from "node:path";
import { installDom } from "./dom-shim.mjs";

const [reportPath, expectedPath] = process.argv.slice(2);
if (!reportPath || !expectedPath) {
  console.error("usage: node tests/verify-numbers.mjs <report.html> <expected.json>");
  process.exit(2);
}
const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));

installDom({});
const html = fs.readFileSync(reportPath, "utf8");
const blockRe = /<script type="application\/octet-stream" data-block="([^"]+)">([\s\S]*?)<\/script>/g;
let m;
while ((m = blockRe.exec(html)) !== null) {
  const node = document.createElement("script");
  node.setAttribute("data-block", m[1]);
  node.textContent = m[2];
  document.body.appendChild(node);
}

const jsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "web", "js");
const files = ["00-core.js", "01-blocks.js"];
let src = files.map((f) => fs.readFileSync(path.join(jsDir, f), "utf8")).join("\n;\n");
new Function(src)();
const IV = globalThis.IV;

const results = [];
function check(label, got, want, tol) {
  const ok = tol ? Math.abs(got - want) <= tol : got === want;
  results.push({ label, got, want, ok });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(54)} ${String(got).padStart(12)}`
    + (ok ? "" : `   expected ${want}`));
}

function sum(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; }

(async function () {
  const core = await IV.blocks.load("core");

  console.log("core payload");
  check("molecules", core.assignment.stats.n_molecules, expected.molecules);
  check("assignment rows", core.assignment.stats.n_rows, expected.assignment_rows);
  check("reads (sum of NR)", core.assignment.stats.n_reads, expected.reads);
  check("samples", core.samples.length, expected.samples.length);
  check("sample names", core.samples.join(","), expected.samples.join(","));
  check("annotated genes", core.universe.ref.annotated_genes, expected.annotated_genes);
  check("annotated transcripts", core.universe.ref.annotated_transcripts,
        expected.annotated_transcripts);
  check("detected genes", core.universe.ref.detected_genes, expected.detected_genes);
  check("detected transcripts", core.universe.ref.detected_transcripts,
        expected.detected_transcripts);
  check("models", core.universe.disc.models, expected.models);
  check("model loci", core.universe.disc.model_genes, expected.model_genes);
  check("novel models (SQANTI rows)", core.sqanti.n, expected.novel_models);
  check("reference isoforms with support", core.universe.ref.isoforms_with_support,
        expected.ref_support_rows);
  check("models with support", core.universe.disc.models_with_support,
        expected.disc_support_rows);
  check("gene __no_feature",
        core.universe.ref.gene_residual.__no_feature.count, expected.gene_no_feature);
  check("transcript __ambiguous",
        core.universe.ref.transcript_residual.__ambiguous.count,
        expected.transcript_ambiguous);
  check("model __no_feature",
        core.universe.disc.transcript_residual.__no_feature.count,
        expected.model_star_rows);
  check("model __ambiguous",
        core.universe.disc.transcript_residual.__ambiguous.count,
        expected.multi_model_molecules);

  const uni = core.assignment.by_universe.all;
  const types = core.assignment.assign_values;
  check("assignment types sum to molecules", sum(uni.assign_mol),
        expected.molecules);
  for (const t in expected.assignment_types) {
    const i = types.indexOf(t);
    check("molecules: " + t, i >= 0 ? uni.assign_mol[i] : -1,
          expected.assignment_types[t]);
  }
  check("full-length molecules (loose)",
        core.assignment.by_universe.fl.total_molecules, expected.fl_loose);
  if (expected.fl_strict != null) {
    check("full-length molecules (strict, statistic)",
          core.assignment.n_full_length_strict, expected.fl_strict);
  }
  check("per-sample molecules sum", core.samples.reduce(
    (s, x) => s + core.assignment.per_sample[x].molecules, 0), expected.molecules);

  console.log("\nref.genes / ref.tx frames");
  const refG = await IV.blocks.load("ref.genes");
  const refT = await IV.blocks.load("ref.tx");
  check("ref.genes rows", refG.n, expected.detected_genes + expected.genes_evidence_only);
  check("ref.genes quantified flag count",
        countWhere(refG.col("quantified"), (v) => v > 0), expected.detected_genes);
  check("ref gene TPM sums to 1e6 per sample (SAMPLE1)",
        Math.round(sum(colOf(refG.col("tpm"), 0))), 1000000, 2);
  check("ref gene count total", Math.round(sum(refG.col("count"))),
        expected.ref_gene_count_total, 2);
  const detTx = countWhere(refT.col("count"), (v) => v > 0);
  check("ref.tx with count > 0", detTx, expected.detected_transcripts);

  const gi = indexOfId(refG, expected.spot_gene.id);
  check("spot gene present", gi >= 0, true);
  if (gi >= 0) {
    check("spot gene name", IV.blocks.cell(refG.col("name"), gi), expected.spot_gene.name);
    check("spot gene count", Math.round(refG.col("count")[gi]),
          expected.spot_gene.count, 1);
    for (let j = 0; j < core.samples.length; j++) {
      check(`spot gene count [${core.samples[j]}]`,
            Math.round(refG.col("counts").get(gi, j)),
            expected.spot_gene.per_sample_counts[j], 1);
    }
    check("spot gene variants in scope", refG.col("n_var")[gi],
          expected.spot_gene.n_variants_in_scope);
  }

  console.log("\ndisc frames");
  const discG = await IV.blocks.load("disc.genes");
  const discT = await IV.blocks.load("disc.tx");
  check("disc.genes rows", discG.n, expected.model_genes);
  check("disc.tx rows", discT.n, expected.models);
  const novelCount = countWhere(discT.col("novel"), (v) => v > 0);
  check("disc.tx novel flag count", novelCount, expected.novel_models);
  const clsCol = discT.col("class");
  const clsCounts = {};
  for (let i = 0; i < discT.n; i++) {
    const k = IV.blocks.cell(clsCol, i);
    clsCounts[k] = (clsCounts[k] || 0) + 1;
  }
  for (const k in expected.model_classes) {
    check("disc.tx class " + k, clsCounts[k] || 0, expected.model_classes[k]);
  }

  console.log("\nsupport columns");
  check("disc sup_reads total", sum(discT.col("sup_reads")),
        expected.disc_support_reads_total);
  check("ref sup_reads total", sum(refT.col("sup_reads")),
        expected.ref_support_reads_total);
  check("ref support isoforms represented",
        core.universe.ref.support_isoforms_represented, expected.ref_support_rows);

  console.log("\nstruct frames");
  const refS = await IV.blocks.load("ref.struct");
  const discS = await IV.blocks.load("disc.struct");
  check("disc.struct rows = exons in models GTF", discS.n, expected.model_exons);
  check("ref.struct offsets tile", tileOk(refT, refS), true);
  check("disc.struct offsets tile", tileOk(discT, discS), true);
  check("ref.struct tx_idx consistent", backrefOk(refT, refS), true);
  check("disc.struct tx_idx consistent", backrefOk(discT, discS), true);

  console.log("\nadditional checks");
  const cube = core.assignment.end_cube;
  check("end cube molecules", cube.total_molecules, expected.molecules);
  check("end cube reads", cube.total_reads, expected.reads);
  check("end cube cells", cube.molecules.length, Math.pow(cube.size, 3));
  (function () {
    const S = cube.size;
    let m = 0;
    for (let tc = 1; tc < S; tc++) {
      for (let ic = 0; ic < S; ic++) {
        for (let fc = 1; fc < S; fc++) m += cube.molecules[tc * S * S + ic * S + fc];
      }
    }
    check("end cube full-length slice", m, expected.fl_loose);
  })();
  check("molecule universes", Object.keys(core.assignment.by_universe).sort().join(","),
        "all,fl");
  (function () {
    const h = core.universe.ref.variants_per_gene_hist || [];
    check("annotation histogram total", h.reduce((a, b) => a + b, 0),
          expected.annotated_genes);
    check("annotation histogram multi-tx tail",
          h.slice(1).reduce((a, b) => a + b, 0),
          core.universe.ref.multi_transcript_genes);
  })();
  if (expected.has_versions_log != null) {
    check("versions log present", (core.run.versions_log || "").length > 0,
          !!expected.has_versions_log);
  }
  check("cross-mode links present",
        Object.keys((core.cross_mode || {}).ref_to_disc || {}).length > 0, true);
  if (gi >= 0 && refG.has("n_annotated")) {
    check("spot gene annotated transcripts", refG.col("n_annotated")[gi],
          expected.spot_gene.n_annotated_total);
  }

  console.log("\nsqanti frame");
  const sq = await IV.blocks.load("disc.sqanti");
  check("disc.sqanti rows", sq.n, expected.novel_models);
  const cat = sq.col("structural_category");
  const catCounts = {};
  for (let i = 0; i < sq.n; i++) {
    const k = IV.blocks.cell(cat, i);
    catCounts[k] = (catCounts[k] || 0) + 1;
  }
  for (const k in expected.sqanti_categories) {
    check("sqanti " + k, catCounts[k] || 0, expected.sqanti_categories[k]);
  }

  const bad = results.filter((r) => !r.ok);
  console.log("");
  console.log(`${results.length - bad.length}/${results.length} numeric checks passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  console.log("HARNESS ERROR\n" + (e && e.stack || e));
  process.exit(1);
});

function colOf(mat, j) {
  const out = new Float64Array(mat.rows);
  for (let i = 0; i < mat.rows; i++) out[i] = mat.get(i, j);
  return out;
}
function countWhere(arr, fn) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (fn(arr[i])) n++;
  return n;
}
function indexOfId(frame, id) {
  const ids = frame.col("id");
  for (let i = 0; i < frame.n; i++) if (IV.blocks.cell(ids, i) === id) return i;
  return -1;
}
function tileOk(txFrame, structFrame) {
  const off = txFrame.col("ex_off"), n = txFrame.col("ex_n");
  let cursor = 0;
  for (let i = 0; i < txFrame.n; i++) {
    if (off[i] !== cursor) return false;
    cursor += n[i];
  }
  return cursor === structFrame.n;
}
function backrefOk(txFrame, structFrame) {
  const off = txFrame.col("ex_off"), n = txFrame.col("ex_n");
  const tix = structFrame.col("tx_idx");
  for (let i = 0; i < txFrame.n; i++) {
    for (let k = off[i]; k < off[i] + n[i]; k++) if (tix[k] !== i) return false;
  }
  return true;
}
