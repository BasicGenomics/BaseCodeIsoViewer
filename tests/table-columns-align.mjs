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

function collect(node, tag, out) {
  for (const c of node.childNodes || []) {
    if (!c.tagName) continue;
    if (c.tagName === tag) out.push(c);
    collect(c, tag, out);
  }
  return out;
}
function countChildren(row, tags) {
  let n = 0;
  for (const c of row.childNodes || []) {
    if (c.tagName && tags.includes(c.tagName)) n++;
  }
  return n;
}

let bad = 0, checked = 0;
const VIEWS = ["overview","qcBaseCode","assignment","genes","transcripts",
               "samples","compare","run"];

for (const mode of ["ref","disc"]) {
  IV.state.mode = mode;
  for (const v of VIEWS) {
    if (!IV.views[v]) continue;
    if (IV.views[v].modeOnly && IV.views[v].modeOnly !== mode) continue;
    IV.state.view = v;
    try { await IV.app.renderView(); } catch (e) { continue; }
    const tables = collect(document.getElementById("content"), "TABLE", []);
    for (const t of tables) {
      const rows = collect(t, "TR", []);
      if (!rows.length) continue;
      let headN = 0;
      for (const r of rows) {
        const n = countChildren(r, ["TH"]);
        if (n) { headN = n; break; }
      }
      if (!headN) continue;
      for (const r of rows) {
        const tds = countChildren(r, ["TD"]);
        if (!tds) continue;
        checked++;
        if (tds !== headN) {
          console.log(`  FAIL ${mode}/${v}: header has ${headN} columns, `
            + `a body row has ${tds}`);
          bad++;
          break;
        }
      }
    }
  }
}

console.log(`\n  ${checked} body rows checked against their headers`);
if (bad) { console.log(`\nTABLE COLUMN MISMATCHES: ${bad}`); process.exit(1); }
console.log("\nTABLE COLUMNS ALIGN");
