import fs from "node:fs";
import path from "node:path";
import { installDom } from "./dom-shim.mjs";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("usage: node tests/plotly-path.mjs <report.html>");
  process.exit(2);
}

const TOKENS = {
  "--surface": "#ffffff", "--surface-2": "#faf8fc", "--surface-sunk": "#f2eef7",
  "--page": "#f7f5fa", "--border": "#e4dced", "--border-strong": "#cdc2da",
  "--ink": "#1c1527", "--ink-2": "#4c445c", "--ink-muted": "#726a80",
  "--ink-faint": "#9a93a6", "--grid": "#ece7f2",
  "--brand": "#ec008c", "--brand-ink": "#c4006a", "--brand-lift": "#ff3ba3",
  "--accent": "#583092", "--accent-ink": "#401c70",
  "--seq-100": "#fe8ebc", "--seq-400": "#e0407f", "--seq-600": "#a8005a",
  "--seq-800": "#580031",
  "--as-resolved": "#009262", "--as-none": "#6b7280",
};
const { document } = installDom(TOKENS);

const calls = [];
globalThis.Plotly = {
  newPlot(node, traces, layout, config) {
    calls.push({ node, traces, layout, config });
    node.on = function (evt, fn) { (node._ev = node._ev || {})[evt] = fn; };
    return Promise.resolve(node);
  },
  react() { return Promise.resolve(); },
  purge() {},
  Plots: { resize() {} },
};
globalThis.ResizeObserver = class {
  observe() {} disconnect() {}
};

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
if (!nBlocks) { console.error("no payload blocks"); process.exit(1); }

const jsDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "web", "js");
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith(".js")).sort();
let source = files.map((f) => fs.readFileSync(path.join(jsDir, f), "utf8")).join("\n;\n");
source = source.replace(
  /if \(document\.readyState === "loading"\)[\s\S]*?\n  \} else \{\n    boot\(\);\n  \}/,
  "/* auto-boot disabled */");

const errors = [];
const origError = console.error;
console.error = function (...a) { errors.push(a.map(String).join(" ")); };

new Function(source)();
const IV = globalThis.IV;
console.error = origError;

const failures = [];
function check(cond, label, detail) {
  if (cond) { console.log("  ok   " + label); return true; }
  console.log("  FAIL " + label + (detail ? "  -- " + detail : ""));
  failures.push(label + (detail ? ": " + detail : ""));
  return false;
}

const FINITE_OK = (arr) => arr.every((v) => v == null || (typeof v === "number" ? Number.isFinite(v) : true));

(async function () {
  await IV.app.boot();

  check(IV.px && IV.px.available(), "adapter reports Plotly available",
    "IV.px.available() must be true or every plot silently falls back to SVG");

  const VIEWS = ["overview", "qcBaseCode", "assignment",  "genes", "transcripts",
                 "samples", "compare"];
  let drawnTotal = 0;

  for (const mode of ["ref", "disc"]) {
    IV.state.mode = mode;
    IV.app.buildHeader();
    IV.app.buildNav();
    for (const v of VIEWS) {
      if (!IV.views[v]) continue;
      const before = calls.length;
      const errBefore = errors.length;
      IV.state.view = v;
      IV.state.viewArg = null;
      await IV.app.renderView();
      const made = calls.length - before;
      drawnTotal += made;
      const newErrors = errors.slice(errBefore);
      check(newErrors.length === 0, `${mode}/${v} rendered without console errors`,
        newErrors.slice(0, 2).join(" | "));
    }
  }

  {
    IV.state.view = "overview";
    IV.state.viewArg = null;
    await IV.app.renderView();
    const segs = [...document.querySelectorAll("button")]
      .filter((b) => (b.textContent || "").trim() === "Distribution");
    for (const b of segs) { b.dispatch("click"); await new Promise((r) => setTimeout(r, 0)); }
    console.log(`  clicked ${segs.length} "Distribution" toggle(s) on the Overview`);
  }

  {
    let barTraces = 0, emptyHover = 0, withTop = 0;
    for (const c of calls) {
      for (const t of c.traces || []) {
        if (t.type !== "bar" || !Array.isArray(t.hovertext)) continue;
        barTraces++;
        const live = (t.hovertext || []).filter(function (h, i) {
          return t.y[i] != null && t.y[i] !== 0;
        });
        if (live.length && live.some(function (h) { return !h; })) emptyHover++;
        if (live.some(function (h) { return h && /<br><br><b>/.test(h); })) withTop++;
      }
    }
    check(barTraces > 0, "bar traces were drawn", `${barTraces} bar traces`);
    check(emptyHover === 0, "every drawn bar has hover text",
      emptyHover ? `${emptyHover} bar traces have blank hover on a drawn bar`
                 : `all ${barTraces} bar traces populated`);
    check(withTop > 0, "histogram hovers carry a top-N feature list",
      `${withTop} of ${barTraces} bar traces include a top-feature block`);
  }

  check(drawnTotal > 0, "the Plotly path was actually taken",
    `newPlot call count = ${drawnTotal}`);
  console.log(`\n  ${drawnTotal} Plotly plots drawn across all views\n`);

  let badTrace = 0, badLen = 0, badFinite = 0, noHeight = 0, notResponsive = 0;
  const types = {};
  for (const c of calls) {
    if (!Array.isArray(c.traces) || !c.traces.length) { badTrace++; continue; }
    for (const t of c.traces) {
      types[t.type] = (types[t.type] || 0) + 1;
      if (Array.isArray(t.x) && Array.isArray(t.y) && t.x.length !== t.y.length) badLen++;
      if (Array.isArray(t.y) && !FINITE_OK(t.y)) badFinite++;
      if (Array.isArray(t.hovertext) && Array.isArray(t.x)
          && t.hovertext.length !== t.x.length) badLen++;
    }
    if (!c.layout || !c.layout.height) noHeight++;
    if (!c.config || c.config.responsive !== true) notResponsive++;
  }

  check(badTrace === 0, "every call passed a non-empty trace array", `${badTrace} bad`);
  check(badLen === 0, "x / y / hovertext lengths agree in every trace", `${badLen} mismatched`);
  check(badFinite === 0, "no NaN or Infinity in any y array", `${badFinite} bad`);
  check(noHeight === 0, "every layout sets an explicit height", `${noHeight} missing`);
  check(notResponsive === 0, "every plot is configured responsive:true",
    `${notResponsive} not responsive`);

  console.log("  trace types drawn: "
    + Object.entries(types).map(([k, v]) => `${k}=${v}`).join(", "));

  let logAxisBad = 0;
  for (const c of calls) {
    for (const ax of ["xaxis", "yaxis"]) {
      const cfg = c.layout && c.layout[ax];
      if (!cfg || cfg.type !== "log") continue;
      const key = ax === "xaxis" ? "x" : "y";
      for (const t of c.traces) {
        if (!Array.isArray(t[key])) continue;
        if (t[key].some((v) => typeof v === "number" && v <= 0)) logAxisBad++;
      }
    }
  }
  check(logAxisBad === 0, "log axes receive raw positive values, not pre-logged",
    `${logAxisBad} traces with <=0 on a log axis`);

  let autoMargin = 0, rotated = 0;
  const marginKey = {}, heights = {};
  const cartesian = calls.filter(function (c) {
    return !(c.traces || []).some(function (t) { return t.type === "sankey"; });
  });
  const sankeys = calls.filter(function (c) {
    return (c.traces || []).some(function (t) { return t.type === "sankey"; });
  });
  for (const c of cartesian) {
    for (const ax of ["xaxis", "yaxis"]) {
      const cfg = c.layout && c.layout[ax];
      if (cfg && cfg.automargin) autoMargin++;
      if (cfg && cfg.tickangle) rotated++;
    }
    const m = c.layout && c.layout.margin;
    if (m) marginKey[[m.l, m.r, m.t, m.b].join(",")] = (marginKey[[m.l, m.r, m.t, m.b].join(",")] || 0) + 1;
    if (c.layout) heights[c.layout.height] = (heights[c.layout.height] || 0) + 1;
  }
  check(autoMargin === 0, "no plot uses automargin (it desynchronises plot areas)",
    `${autoMargin} axes with automargin`);
  check(rotated === 0, "no plot rotates tick labels (it changes the tick block height)",
    `${rotated} axes with a tickangle`);
  const marginVariants = Object.keys(marginKey);
  check(marginVariants.length === 1,
    "every cartesian plot shares one margin rectangle",
    `${marginVariants.length} distinct margins: ${marginVariants.join(" | ")}`);
  const heightVariants = Object.keys(heights);
  console.log("  plot heights in use: "
    + Object.entries(heights).map(([h, n]) => `${h}px x${n}`).join(", "));

  let sankeyBad = 0;
  for (const c of sankeys) {
    for (const t of c.traces) {
      if (t.type !== "sankey") continue;
      const n = t.node.label.length;
      const inn = new Array(n).fill(0), out = new Array(n).fill(0);
      for (let k = 0; k < t.link.value.length; k++) {
        out[t.link.source[k]] += t.link.value[k];
        inn[t.link.target[k]] += t.link.value[k];
      }
      for (let i = 0; i < n; i++) {
        if (inn[i] > 0 && out[i] > 0 && Math.abs(inn[i] - out[i]) > 0.5) sankeyBad++;
      }
    }
  }
  if (sankeys.length) {
    check(sankeyBad === 0, `every sankey interior node balances (${sankeys.length} diagram(s))`,
      `${sankeyBad} unbalanced node(s)`);
  }

  {
    let skWithPos = 0, skTotal = 0, notLayered = 0, snapped = 0;
    for (const c of calls) {
      for (const t of c.traces || []) {
        if (t.type !== "sankey") continue;
        skTotal++;
        const hasPos = Array.isArray(t.node && t.node.x)
          && Array.isArray(t.node && t.node.y);
        if (!hasPos) { notLayered++; continue; }
        skWithPos++;
        if (t.arrangement === "snap") snapped++;
        const xs = t.node.x;
        const maxX = Math.max.apply(null, xs);
        const short = xs.filter(function (v) { return v < maxX - 1e-9; }).length;
        if (!short) notLayered++;
      }
    }
    check(skTotal > 0, "sankey diagrams were drawn", `${skTotal} diagram(s)`);
    check(notLayered === 0, "every sankey is explicitly layered",
      notLayered ? `${notLayered} of ${skTotal} lack usable node x/y`
                 : `all ${skWithPos} positioned`);
    check(snapped === 0, "positioned sankeys do not use arrangement:snap",
      snapped ? `${snapped} would have their positions discarded by snap`
              : "arrangement is fixed where positions are given");
  }

  const wired = calls.filter((c) => c.node && c.node._ev && c.node._ev.plotly_click).length;
  check(wired > 0, "click handlers wired for drill-down", `${wired} of ${calls.length}`);

  console.log("");
  if (failures.length) {
    console.log("PLOTLY PATH FAILURES:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
  console.log("PLOTLY PATH OK");
})();
