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

await IV.app.boot();
const S = IV.stateApi;
await S.universe("ref");

const failures = [];
if (IV.state.samples.length < 2) {
  console.log("only one sample in this report - Compare needs two groups, skipping");
  process.exit(0);
}
const half = Math.ceil(IV.state.samples.length / 2);
IV.state.group = IV.state.samples.map((_, i) => (i < half ? 1 : 2));
IV.state.view = "compare";

const before = problems.length;
await IV.app.renderView();
const host = document.getElementById("content");

function findButton(node, text) {
  if (node.tagName === "BUTTON" && (node.textContent || "").indexOf(text) >= 0) return node;
  for (const c of node.childNodes || []) { const r = findButton(c, text); if (r) return r; }
  return null;
}
const btn = findButton(host, "Compare A vs B");
if (!btn) failures.push("no 'Compare A vs B' button rendered");
else if (btn.disabled) failures.push("Compare button disabled with both groups assigned");
else {
  btn.dispatch("click");
  for (let i = 0; i < 100 && !/Top differences per sample/.test(host.textContent); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

const txt = host.textContent;
const VW = IV.stateApi.modeInfo().variantWord;
const VWCap = VW.charAt(0).toUpperCase() + VW.slice(1);
for (const need of ["Group means", VWCap + " usage divergence between groups",
                    "Top differences per sample", "Rows shown", "Results"]) {
  if (txt.indexOf(need) < 0) failures.push("missing after Compare: " + need);
}
const bandRects = host.querySelectorAll
  ? host.querySelectorAll("rect[data-col-band]") : [];
if (!/Group A \(/.test(txt) || !/Group B \(/.test(txt)) {
  failures.push("heatmap has no group legend naming A and B");
} else if (!bandRects.length) {
  failures.push("heatmap has a group legend but no column band drawn");
}
const errs = problems.slice(before);
for (const p of errs) failures.push("console.error: " + p.slice(0, 200));

if (failures.length) {
  console.error("COMPARE FAILURES");
  for (const f of failures) console.error("  FAIL " + f);
  process.exit(1);
}
console.log("compare groups: rendered scatter, divergence, heatmap and table cleanly");
