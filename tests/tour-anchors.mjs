import fs from "node:fs";
import path from "node:path";
import { installDom } from "./dom-shim.mjs";
const { document } = installDom({});

globalThis.Plotly = {
  newPlot(node) { node.on = function () {}; return Promise.resolve(node); },
  react() { return Promise.resolve(); },
  purge() {},
  Plots: { resize() {} },
};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

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

let bad = 0;
function check(cond, name, detail) {
  if (cond) console.log("  ok   " + name + (detail ? "  -- " + detail : ""));
  else { console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); bad++; }
}

const STEPS = IV.tour && IV.tour.STEPS;
if (!STEPS) { console.log("  FAIL IV.tour is not defined"); process.exit(1); }
console.log(`\n  ${STEPS.length} tour steps\n`);

for (const s of STEPS) {
  if (!s.title || !s.body) {
    check(false, "step has a title and a body", s.title || "(untitled)");
  }
  if (/[—]/.test((s.title || "") + s.body)) {
    check(false, "no em dash in step text", s.title);
  }
}
check(bad === 0, "every step has a title and a body, with no em dashes");

const anchors = STEPS.map((s) => s.anchor).filter(Boolean);
check(new Set(anchors).size === anchors.length, "no two steps share an anchor",
  anchors.length + " anchored steps");

async function openFirstGene() {
  const row = document.querySelector('[data-tour="genes-table"] tbody tr');
  if (!row) return false;
  row.click();
  for (let i = 0; i < 400 && !document.querySelector("[data-tour=\"gene-model\"]"); i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  return IV.state.view === "gene";
}

const resolved = Object.create(null);
for (const mode of ["ref", "disc"]) {
  IV.stateApi.setMode(mode);
  let geneOpen = false;
  for (const s of STEPS) {
    if (!s.anchor) continue;
    if (s.view === "gene") {
      if (!geneOpen) {
        await IV.app.go("genes");
        geneOpen = await openFirstGene();
      }
      if (!geneOpen) continue;
    } else if (s.view) {
      await IV.app.go(s.view);
    }
    if (document.querySelector(s.anchor)) resolved[s.anchor] = true;
  }
  console.log(`  (${mode}: gene view ${geneOpen ? "opened" : "not reachable"})`);
}
for (const a of anchors) {
  check(resolved[a], "anchor resolves: " + a);
}

const jsSrc = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(jsDir, f), "utf8")).join("\n");
const declared = new Set();
for (const m of jsSrc.matchAll(/\btour:\s*"([^"]+)"/g)) declared.add(m[1]);
const tourSrc = fs.readFileSync(path.join(jsDir, "95-tour.js"), "utf8");
const orphans = [...declared].filter((d) => !tourSrc.includes(d));
check(orphans.length === 0, "every declared data-tour anchor is used by a step",
  orphans.length ? "orphans: " + orphans.join(", ") : declared.size + " declared");

await IV.app.go("overview");
IV.tour.start();
await new Promise((r) => setTimeout(r, 60));
let sawMark = false;
for (let k = 0; k < STEPS.length; k++) {
  const nx = Array.from(document.querySelectorAll(".tour-card button"))
    .find((b) => b.textContent === "Next" || b.textContent === "Done");
  if (!nx) break;
  nx.click();
  await new Promise((r) => setTimeout(r, 120));
  const mk = document.querySelector(".tour-mark");
  if (mk && mk.style && mk.style.display !== "none") sawMark = true;
}
check(sawMark, "a page-changing step marks its sidebar entry",
  ".tour-mark is positioned rather than hidden");

check(!document.querySelector(".tour-card"), "walking off the last step ends the tour");
check(IV.state.view === "overview", "the tour ends on the Overview",
  "landed on " + IV.state.view);

await IV.app.go("genes");
IV.tour.start();
await new Promise((r) => setTimeout(r, 50));
check(!!document.querySelector(".tour-card"), "start() builds the step card");
check(!!document.querySelector(".tour-spot"), "start() builds the spotlight");
const nextBtn = Array.from(document.querySelectorAll(".tour-card button"))
  .find((b) => b.textContent === "Next");
check(!!nextBtn, "the card offers Next");
if (nextBtn) {
  nextBtn.click();
  await new Promise((r) => setTimeout(r, 80));
  const backBtn = Array.from(document.querySelectorAll(".tour-card button"))
    .find((b) => b.textContent === "Back");
  check(!!backBtn, "Next advances past the first step", "Back appeared");
}
IV.tour.stop();
check(!document.querySelector(".tour-card") && !document.querySelector(".tour-spot")
  && !document.querySelector(".tour-mark"),
  "stop() removes the overlay");

let navGen = 0;
const proto = Object.getPrototypeOf(document.createElement("div"));
const origRect = proto.getBoundingClientRect;
proto.getBoundingClientRect = function () {
  if (String(this.className || "").indexOf("nav-item") >= 0) {
    let n = this, live = false;
    for (let i = 0; i < 40 && n; i++) { if (n === document.body) { live = true; break; } n = n.parentNode; }
    if (!live) return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
    return { top: 100 + navGen * 60, left: 10, width: 200, height: 30,
             bottom: 130 + navGen * 60, right: 210 };
  }
  return origRect.call(this);
};

await IV.app.go("overview");
IV.tour.start();
await new Promise((r) => setTimeout(r, 60));
{
  let guard = 0, railStep = false;
  while (guard < STEPS.length) {
    if (/^\.nav-item/.test(STEPS[guard].anchor || "")) { railStep = true; break; }
    const card = document.querySelector(".tour-card");
    const nx = card && Array.from(card.querySelectorAll("button"))
      .find((b) => b.textContent === "Next" || b.textContent === "Done");
    if (!nx) break;
    nx.click();
    guard++;
    await new Promise((r) => setTimeout(r, 40));
  }
  check(railStep, "reached a rail-anchored step", "step " + (guard + 1));
  const spot = document.querySelector(".tour-spot");
  check(spot && spot.style.top === (100 - 8) + "px",
    "rail step positions the spotlight on the rail entry",
    "top=" + (spot && spot.style.top));

  navGen = 1;
  IV.app.buildNav();
  await new Promise((r) => setTimeout(r, 400));
  const after = document.querySelector(".tour-spot");
  check(after && after.style.top === (160 - 8) + "px",
    "spotlight re-resolves its anchor after the rail is rebuilt",
    "top=" + (after && after.style.top) + " (expected 152px)");
}
proto.getBoundingClientRect = origRect;
IV.tour.stop();
await new Promise((r) => setTimeout(r, 40));

const tabKeys = () => (IV.state.geneTabs || []).map((t) => t.mode + ":" + t.index);

async function walkWholeTour() {
  await IV.app.go("overview");
  IV.tour.start();
  await new Promise((r) => setTimeout(r, 60));
  for (let k = 0; k < STEPS.length + 3; k++) {
    const card = document.querySelector(".tour-card");
    if (!card) break;
    const nx = Array.from(card.querySelectorAll("button"))
      .find((b) => b.textContent === "Next" || b.textContent === "Done");
    if (!nx) break;
    nx.click();
    await new Promise((r) => setTimeout(r, 110));
  }
}

IV.state.geneTabs = [];
await walkWholeTour();
check(tabKeys().length === 0, "the tour closes the gene it opened",
  "tabs left: " + (tabKeys().join(",") || "none"));
check(IV.state.openGene == null, "and clears the open-gene pointer");
check(IV.state.view === "overview", "and ends on the Overview");

await IV.app.openGene(5);
await new Promise((r) => setTimeout(r, 80));
const mine = tabKeys();
check(mine.length > 0, "a gene opened by hand records a tab", mine.join(","));
await walkWholeTour();
check(mine.every((k) => tabKeys().indexOf(k) >= 0),
  "the tour leaves tabs the reader opened alone",
  "before: " + mine.join(",") + "  after: " + (tabKeys().join(",") || "none"));
IV.state.geneTabs = [];

const store = Object.create(null);
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
IV.tour.maybeStart();
await new Promise((r) => setTimeout(r, 600));
check(!!document.querySelector(".tour-card"),
  "maybeStart() opens the tour on a first visit");
IV.tour.stop();
await new Promise((r) => setTimeout(r, 60));
IV.tour.maybeStart();
await new Promise((r) => setTimeout(r, 600));
check(!!document.querySelector(".tour-card"),
  "maybeStart() opens it again on a later visit", "seen flag no longer suppresses");
IV.tour.stop();

console.log(bad ? "\nTOUR ANCHORS FAIL" : "\nTOUR ANCHORS OK");
process.exit(bad ? 1 : 0);
