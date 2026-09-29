import fs from "node:fs";
import path from "node:path";
import { installDom } from "./dom-shim.mjs";
const { document } = installDom({});

const html = fs.readFileSync(process.argv[2], "utf8");
function mk(t,i,c){const n=document.createElement(t);if(i)n.setAttribute("id",i);if(c)n.className=c;return n;}
const boot=mk("div","boot");boot.appendChild(mk("div","boot-status"));document.body.appendChild(boot);
const app=mk("div","app");const sb=mk("aside","sidebar");sb.appendChild(mk("nav","nav"));
const ft=mk("div",null,"sidebar-foot");ft.appendChild(mk("span","foot-version"));sb.appendChild(ft);
app.appendChild(sb);const main=mk("main","main");const hd=mk("header","header");
hd.appendChild(mk("h1","page-title"));hd.appendChild(mk("div","header-controls"));
main.appendChild(hd);main.appendChild(mk("div","content"));app.appendChild(main);document.body.appendChild(app);
const re=/<script type="application\/octet-stream" data-block="([^"]+)">([\s\S]*?)<\/script>/g;
let m;while((m=re.exec(html))!==null){const n=document.createElement("script");
n.setAttribute("type","application/octet-stream");n.setAttribute("data-block",m[1]);
n.textContent=m[2];document.body.appendChild(n);}
const jsDir=path.join(path.dirname(new URL(import.meta.url).pathname),"..","web","js");
let src=fs.readdirSync(jsDir).filter(f=>f.endsWith(".js")).sort()
  .map(f=>fs.readFileSync(path.join(jsDir,f),"utf8")).join("\n;\n");
src=src.replace(/if \(document\.readyState === "loading"\)[\s\S]*?\n  \} else \{\n    boot\(\);\n  \}/,"");
new Function(src)();
const IV=globalThis.IV;

await IV.app.boot();
const S = IV.stateApi;
let bad = 0;
function check(cond, name, detail) {
  if (cond) console.log("  ok   " + name + (detail ? "  -- " + detail : ""));
  else { console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); bad++; }
}

const nTot = IV.state.samples.length;
console.log(`\n  ${nTot} samples in this report\n`);

if (nTot < 2) {
  console.log("  (single-sample report: selection is a no-op, nothing to test)");
  console.log("\nSAMPLE SELECTION OK");
  process.exit(0);
}

check(S.allSamplesOn(), "every sample starts selected",
  `${S.nActive()} of ${nTot}`);

const u = await S.universe();
const before = S.derive(u);
const valBefore = Array.from(before.value.slice(0, 4000));
const cvBefore = Array.from(before.cv.slice(0, 4000));

S.setSampleOn(nTot - 1, false);
check(S.nActive() === nTot - 1, "deselecting one sample reduces the active count",
  `${S.nActive()} of ${nTot}`);

const after = S.derive(u);
check(after !== before, "derive() returned a fresh result, not the cache",
  "selection is part of the cache key");

let changedVal = 0, changedCv = 0;
for (let i = 0; i < valBefore.length; i++) {
  if (Math.abs(valBefore[i] - after.value[i]) > 1e-9) changedVal++;
  if (Math.abs(cvBefore[i] - after.cv[i]) > 1e-9) changedCv++;
}
check(changedVal > 0, "gene means changed when a sample was excluded",
  `${changedVal} of ${valBefore.length} sampled genes moved`);
check(changedCv > 0, "CV changed when a sample was excluded",
  `${changedCv} of ${cvBefore.length} sampled genes moved`);

{
  const g = u.genes;
  check(S.hasPerSampleEvidence(g),
    "the payload carries per-sample evidence matrices",
    g.has("mol_s") ? "mol_s present" : "mol_s ABSENT - evidence cannot narrow");
  if (S.hasPerSampleEvidence(g)) {
    S.setAllSamples(true);
    const molAll = S.evidenceColumn(g, "mol");
    const readAll = S.evidenceColumn(g, "read");
    let sumAll = 0, sumReadAll = 0;
    for (let i = 0; i < Math.min(g.n, 3000); i++) { sumAll += molAll(i); sumReadAll += readAll(i); }

    S.setSampleSet([0]);
    const molOne = S.evidenceColumn(g, "mol");
    const readOne = S.evidenceColumn(g, "read");
    let sumOne = 0, sumReadOne = 0;
    for (let i = 0; i < Math.min(g.n, 3000); i++) { sumOne += molOne(i); sumReadOne += readOne(i); }

    check(sumOne < sumAll && sumOne > 0,
      "detected-molecule totals shrink with one sample selected",
      `${sumOne.toLocaleString()} of ${sumAll.toLocaleString()}`);
    check(sumReadOne < sumReadAll && sumReadOne > 0,
      "sequencing-read totals shrink with one sample selected",
      `${sumReadOne.toLocaleString()} of ${sumReadAll.toLocaleString()}`);

    S.setAllSamples(true);
    const plain = g.col("mol");
    let drift = 0, worst = 0;
    const colAll = S.evidenceColumn(g, "mol");
    for (let i = 0; i < Math.min(g.n, 3000); i++) {
      const d = Math.abs(colAll(i) - plain[i]);
      if (d) { drift++; if (d > worst) worst = d; }
    }
    check(drift === 0,
      "per-sample evidence sums back to the run-wide column",
      drift ? `${drift} rows differ, worst by ${worst}` : "exact on 3000 rows");
  }
  S.setAllSamples(true);
}

{
  S.setAllSamples(true);
  const d2 = S.derive(u);
  check(d2.geneRowsAll && d2.geneRowsAll.length >= d2.geneRows.length,
    "the wider row list exists and includes the quantified set",
    `${(d2.geneRowsAll || []).length} vs ${d2.geneRows.length}`);

  const fOff = S.newFilter();
  fOff.quantifiedOnly = false;
  const fOn = S.newFilter();
  fOn.quantifiedOnly = true;
  const nOff = S.filterGenes(u, fOff).length;
  const nOn = S.filterGenes(u, fOn).length;
  let evOnly = 0;
  if (d2.evidenceOnly) {
    for (let i = 0; i < d2.evidenceOnly.length; i++) if (d2.evidenceOnly[i]) evOnly++;
  }
  if (evOnly > 0) {
    check(nOn < nOff, "\"Quantified only\" actually removes genes",
      `${nOff.toLocaleString()} -> ${nOn.toLocaleString()} `
      + `(${(nOff - nOn).toLocaleString()} evidence-only)`);
    check(nOff - nOn === evOnly,
      "it removes exactly the evidence-only genes",
      `removed ${nOff - nOn}, evidence-only ${evOnly}`);
  } else {
    console.log("  --   no evidence-only genes in this run; nothing to filter");
  }

  const ex = S.searchExamples(u.genes, 3);
  check(ex.length > 0, "search examples are drawn from the annotation",
    ex.join(", ") || "none");
  const namesCol = u.genes.has("name") ? u.genes.col("name") : null;
  const idsCol = u.genes.has("id") ? u.genes.col("id") : null;
  let allReal = ex.length > 0;
  for (const e of ex) {
    let found = false;
    for (let i = 0; i < u.genes.n && !found; i++) {
      if ((namesCol && IV.blocks.cell(namesCol, i) === e)
          || (idsCol && IV.blocks.cell(idsCol, i) === e)) found = true;
    }
    if (!found) allReal = false;
  }
  check(allReal, "every search example exists in this annotation",
    allReal ? "all present" : "at least one example names nothing in the data");
}

S.setAllSamples(false);
check(S.nActive() === 1, "switching all off leaves exactly one selected",
  `${S.nActive()} active`);
const only = S.activeIdx()[0];
S.setSampleOn(only, false);
check(S.nActive() === 1, "the last selected sample refuses to be deselected",
  `still ${S.nActive()} active`);

const VIEWS = ["overview","qcBaseCode","assignment","genes","transcripts",
               "samples","compare","run"];
for (const nSel of [1, Math.max(2, nTot - 1)]) {
  const pick = [];
  for (let i = 0; i < nSel; i++) pick.push(i);
  S.setSampleSet(pick);
  for (const v of VIEWS) {
    if (!IV.views[v]) continue;
    if (IV.views[v].modeOnly && IV.views[v].modeOnly !== IV.state.mode) continue;
    IV.state.view = v;
    const errs = [];
    const orig = console.error;
    console.error = function (...a) { errs.push(a.join(" ")); };
    try {
      await IV.app.renderView();
    } catch (e) {
      errs.push(String(e && e.stack || e));
    } finally {
      console.error = orig;
    }
    check(errs.length === 0, `${v} renders with ${nSel} of ${nTot} selected`,
      errs.length ? errs[0].split("\n")[0] : "");
  }
}

S.setSampleSet([0]);
check(S.nActive() === 1, "narrowed to a single sample", "");
IV.state.view = "genes";
await IV.app.renderView();
function deepText(node){const kids=node.childNodes||[];
 if(!kids.length){if(node._html)return String(node._html).replace(/<[^>]*>/g," ")+" ";
  if(node.textContent)return node.textContent+" ";return "";}
 let o="";for(const c of kids){if(c.tagName){if(c.tagName==="SCRIPT"||c.tagName==="STYLE")continue;o+=deepText(c)+" ";}else o+=(c.textContent||"")+" ";}return o;}
const txt = deepText(document.getElementById("content"));
check(!/Mean JSD/.test(txt),
  "no divergence column offered for a single selected sample",
  /Mean JSD/.test(txt) ? "'Mean JSD' still rendered" : "withheld");

S.setAllSamples(true);
console.log(bad ? "\nSAMPLE SELECTION FAILURES: " + bad : "\nSAMPLE SELECTION OK");
process.exit(bad ? 1 : 0);
