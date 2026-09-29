import fs from "node:fs";
import path from "node:path";
import { installDom } from "./dom-shim.mjs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: node tests/run-report.mjs <report.html>");
  process.exit(2);
}

const TOKENS = {
  "--surface": "#ffffff", "--surface-2": "#faf8fc", "--surface-sunk": "#f2eef7",
  "--page": "#f7f5fa", "--border": "#e4dced", "--border-strong": "#cdc2da",
  "--ink": "#1c1527", "--ink-2": "#4c445c", "--ink-muted": "#726a80",
  "--ink-faint": "#9a93a6", "--grid": "#ece7f2",
  "--brand": "#583092", "--brand-ink": "#401c70", "--brand-lift": "#724ab2",
  "--accent": "#ec008c", "--accent-ink": "#b8006e",
  "--cat-1": "#4a3aa7", "--cat-2": "#eb6834", "--cat-3": "#1baf7a",
  "--cat-4": "#eda100", "--cat-5": "#e87ba4", "--cat-6": "#008300",
  "--cat-7": "#2a78d6", "--cat-8": "#e34948",
  "--as-resolved": "#009262", "--as-resolved-2": "#5fc397",
  "--as-ambiguous": "#d25118", "--as-ambiguous-2": "#f7906b",
  "--as-inconsistent": "#5241ac", "--as-inconsistent-2": "#837bde",
  "--as-none": "#6b7280", "--as-none-2": "#9aa3b2",
  "--nov-known": "#2a78d6", "--nov-nic": "#eda100", "--nov-nnic": "#e87ba4",
  "--seq-100": "#efe9ff", "--seq-200": "#dacef8", "--seq-300": "#bfa9f2",
  "--seq-400": "#a588e1", "--seq-500": "#8c69cd", "--seq-600": "#724ab2",
  "--seq-700": "#583093", "--seq-800": "#401c70",
  "--div-neg": "#2a78d6", "--div-neg-2": "#8fb7e8", "--div-mid": "#f0efec",
  "--div-pos-2": "#f0a09f", "--div-pos": "#e34948",
  "--st-good": "#0ca30c", "--st-warning": "#fab219", "--st-serious": "#ec835a",
  "--st-critical": "#d03b3b",
};

const { document } = installDom(TOKENS);

const html = fs.readFileSync(reportPath, "utf8");

function mk(tag, id, cls) {
  const n = document.createElement(tag);
  if (id) n.setAttribute("id", id);
  if (cls) n.className = cls;
  return n;
}
const boot = mk("div", "boot");
boot.appendChild(mk("div", "boot-status"));
document.body.appendChild(boot);
const app = mk("div", "app");
const sidebar = mk("aside", "sidebar");
sidebar.appendChild(mk("nav", "nav"));
const foot = mk("div", null, "sidebar-foot");
foot.appendChild(mk("span", "run-name"));
foot.appendChild(mk("span", "foot-version"));
sidebar.appendChild(foot);
app.appendChild(sidebar);
const main = mk("main", "main");
const header = mk("header", "header");
header.appendChild(mk("h1", "page-title"));
header.appendChild(mk("div", "header-controls"));
main.appendChild(header);
main.appendChild(mk("div", "content"));
app.appendChild(main);
document.body.appendChild(app);

const blockRe = /<script type="application\/octet-stream" data-block="([^"]+)">([\s\S]*?)<\/script>/g;
let m, nBlocks = 0;
while ((m = blockRe.exec(html)) !== null) {
  const node = document.createElement("script");
  node.setAttribute("type", "application/octet-stream");
  node.setAttribute("data-block", m[1]);
  node.textContent = m[2];
  document.body.appendChild(node);
  nBlocks++;
}
console.log(`payload: ${nBlocks} blocks attached`);
if (!nBlocks) { console.error("no payload blocks found in the report"); process.exit(1); }

const jsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "web", "js");
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).sort();
let source = files.map((f) => fs.readFileSync(path.join(jsDir, f), "utf8")).join("\n;\n");
source = source.replace(
  /if \(document\.readyState === "loading"\)[\s\S]*?\n  \} else \{\n    boot\(\);\n  \}/,
  "/* auto-boot disabled by the test harness */");

const problems = [];
const origError = console.error;
console.error = function (...a) { problems.push(a.map(String).join(" ")); origError(...a); };

new Function(source)();
if (!globalThis.IV || !globalThis.IV.app) {
  console.error("IV.app was not created — the bundle did not evaluate");
  process.exit(1);
}
const IV = globalThis.IV;

function contentText() { return document.getElementById("content").textContent; }

const emDashHits = new Set();
function checkNoEmDash(label) {
  const txt = contentText();
  let i = txt.indexOf("\u2014");
  while (i >= 0) {
    emDashHits.add(label + ": …" + txt.slice(Math.max(0, i - 45), i + 45)
      .replace(/\s+/g, " ") + "…");
    i = txt.indexOf("\u2014", i + 1);
  }
}
function nodeCount(root) {
  let n = 1;
  for (const c of root.childNodes || []) n += nodeCount(c);
  return n;
}

const failures = [];

async function renderAndCheck(label) {
  const before = problems.length;
  await IV.app.renderView();
  const host = document.getElementById("content");
  const nodes = nodeCount(host);
  const txt = contentText();
  const errored = txt.indexOf("could not be rendered") >= 0;
  const newProblems = problems.slice(before);
  checkNoEmDash(label);
  const ok = !errored && nodes > 25 && !newProblems.length;
  if (!ok) {
    failures.push({ label, nodes, errored,
      detail: newProblems.slice(0, 3).join(" | ") || txt.slice(0, 400) });
  }
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} ${String(nodes).padStart(6)} nodes`);
  return ok;
}

const VIEWS = ["overview", "run", "qcBaseCode", "assignment", 
               "genes", "transcripts", "samples", "compare"];

(async function () {
  await IV.app.boot();
  console.log(`run: ${IV.state.core.run.name}   samples: ${IV.state.core.samples.join(", ")}`);
  console.log(`checks: ${IV.state.core.checks.filter((c) => c.ok).length}/${IV.state.core.checks.length} passed at build time`);

  for (const mode of ["ref", "disc"]) {
    IV.state.mode = mode;
    IV.app.buildHeader();
    IV.app.buildNav();
    console.log(`\n--- mode: ${mode} ---`);
    for (const v of VIEWS) {
      const def = IV.views[v];
      if (!def) { failures.push({ label: v, detail: "view not registered" }); continue; }
      if (def.modeOnly && def.modeOnly !== mode) continue;
      IV.state.view = v;
      IV.state.viewArg = null;
      await renderAndCheck(`${mode}/${v}`);
    }

    const u = await IV.stateApi.universe(mode);
    const mol = u.genes.col("mol");
    let best = 0;
    for (let i = 1; i < u.genes.n; i++) if (mol[i] > mol[best]) best = i;
    IV.state.view = "gene";
    IV.state.openGene = { mode, index: best };
    IV.state.viewArg = { index: best };
    await renderAndCheck(`${mode}/gene (${IV.blocks.cell(u.genes.col("name"), best)})`);
  }

  console.log("\n--- weight x universe ---");
  IV.state.mode = "ref";
  for (const w of ["mol", "read"]) {
    for (const uni of ["all", "fl"]) {
      if (!IV.state.core.assignment.by_universe[uni]) continue;
      IV.state.weight = w;
      IV.state.universe = uni;
      for (const v of ["overview", "qcBaseCode", "assignment"]) {
        IV.state.view = v;
        IV.state.viewArg = null;
        await renderAndCheck(`${v} [${w}/${uni}]`);
      }
    }
  }
  IV.state.weight = "mol";
  IV.state.universe = "all";

  console.log("\n--- interactions ---");
  IV.state.view = "compare";
  IV.state.group = IV.state.core.samples.map((_, i) => (i === 0 ? 1 : 2));
  await IV.app.renderView();
  const cmpBtn = document.getElementById("content")
    .querySelectorAll("button").filter((b) => b.textContent.indexOf("Compare A vs B") >= 0)[0];
  if (cmpBtn) {
    cmpBtn.dispatch("click");
    await new Promise((r) => setTimeout(r, 60));
    const txt = contentText();
    const ran = txt.indexOf("log₂ FC") >= 0 || txt.indexOf("Group means") >= 0;
    console.log(`  ${ran ? "ok  " : "FAIL"} group comparison computed`);
    if (!ran) failures.push({ label: "compare/run", detail: txt.slice(0, 300) });
  } else {
    failures.push({ label: "compare/button", detail: "Compare button not found" });
  }

  IV.state.view = "genes";
  await IV.app.renderView();
  const numBoxes = document.getElementById("content").querySelectorAll("input")
    .filter((i) => /minimum value|maximum value/.test(
      i.getAttribute("aria-label") || ""));
  if (numBoxes.length >= 2) {
    numBoxes[0].value = "5";
    numBoxes[0].dispatch("change");
    await new Promise((r) => setTimeout(r, 240));
    const kept = contentText().indexOf("shown") >= 0;
    console.log(`  ${kept ? "ok  " : "FAIL"} gene range filter applied`);
    if (!kept) failures.push({ label: "genes/filter", detail: contentText().slice(0, 300) });
  } else {
    failures.push({ label: "genes/filter", detail: "no range inputs rendered" });
  }

  console.log("\n--- value type x stringency ---");
  for (const vm of ["counts", "tpm"]) {
    for (const st of ["exploratory", "standard", "strict"]) {
      IV.state.valueMode = vm;
      IV.state.stringency = st;
      for (const v of ["overview", "genes", "transcripts", "samples"]) {
        IV.state.view = v;
        IV.state.viewArg = null;
        await renderAndCheck(`${v} [${vm}/${st}]`);
      }
    }
  }
  IV.state.valueMode = "counts";
  IV.state.stringency = "exploratory";

  console.log("\n--- gene tabs ---");
  {
    const u = await IV.stateApi.universe("ref");
    const mol = u.genes.col("mol");
    const order = Array.from({ length: u.genes.n }, (_, i) => i)
      .sort((a, b) => mol[b] - mol[a]).slice(0, 3);
    for (const i of order) await IV.app.openGene(i);
    const nTabs = IV.state.geneTabs.length;
    console.log(`  ${nTabs === 3 ? "ok  " : "FAIL"} ${nTabs} gene tabs open`);
    if (nTabs !== 3) failures.push({ label: "gene/tabs", detail: `${nTabs} tabs` });
    IV.stateApi.closeGeneTab("ref", order[0]);
    await renderAndCheck("gene after closing a tab");
  }

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.value = "GAPDH";
    searchInput.dispatch("input");
    await new Promise((r) => setTimeout(r, 260));
    const hits = document.getElementById("search-results").childNodes.length;
    console.log(`  ${hits > 0 ? "ok  " : "warn"} search returned ${hits} result(s) for GAPDH`);
  }

  IV.state.theme = "dark";
  IV.state.view = "overview";
  await renderAndCheck("overview [dark theme]");

  console.log("");
  if (emDashHits.size) {
    console.log(`EM DASHES IN RENDERED TEXT (${emDashHits.size}):`);
    for (const h of Array.from(emDashHits).slice(0, 12)) console.log("  " + h);
    if (emDashHits.size > 12) console.log(`  … and ${emDashHits.size - 12} more`);
  } else {
    console.log("no em dashes in rendered text");
  }
  if (failures.length || emDashHits.size) {
    if (failures.length) {
      console.log(`FAILURES (${failures.length}):`);
      for (const f of failures) {
        console.log(`  ${f.label}: ${f.detail ? f.detail.slice(0, 500) : "(no detail)"}`);
      }
    }
    process.exit(1);
  }
  console.log("ALL VIEWS RENDER");
  process.exit(0);
})().catch((e) => {
  console.log("\nHARNESS ERROR");
  console.log(e && e.stack || String(e));
  process.exit(1);
});
