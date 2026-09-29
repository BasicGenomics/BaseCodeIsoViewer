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

function deepText(node){const kids=node.childNodes||[];
 if(!kids.length){if(node._html)return String(node._html).replace(/<[^>]*>/g," ")+" ";
  if(node.textContent)return node.textContent+" ";return "";}
 let o="";for(const c of kids){if(c.tagName){if(c.tagName==="SCRIPT"||c.tagName==="STYLE")continue;o+=deepText(c)+" ";}else o+=(c.textContent||"")+" ";}return o;}

const S = IV.stateApi;
let bad = 0;
function check(cond, name, detail) {
  if (cond) console.log("  ok   " + name + (detail ? "  -- " + detail : ""));
  else { console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); bad++; }
}

const u = await S.universe();
const informative = S.hasBiotypes(u.genes) || S.hasBiotypes(u.tx);
const info = S.biotypeInfo(u.genes);
console.log(`\n  gene biotypes: ${info.n} distinct meaningful value(s) `
  + `-> ${informative ? "INFORMATIVE" : "not informative"}\n`);

const VIEWS = ["overview", "genes", "transcripts"];
const seen = {};
for (const v of VIEWS) {
  IV.state.view = v;
  await IV.app.renderView();
  seen[v] = deepText(document.getElementById("content"));
}
IV.state.view = "gene";
IV.state.viewArg = { index: u.genes.n > 0 ? 0 : null };
IV.state.openGene = { mode: IV.state.mode, index: 0 };
try { await IV.app.renderView(); seen.gene = deepText(document.getElementById("content")); }
catch (e) { seen.gene = ""; }

const anyBiotypeWord = Object.entries(seen)
  .filter(([, t]) => /\bBiotype\b|\bGene type\b/.test(t))
  .map(([v]) => v);
const anyUnknown = Object.entries(seen)
  .filter(([, t]) => /\bUnknown\b/.test(t))
  .map(([v]) => v);

if (informative) {
  check(anyBiotypeWord.length > 0,
    "biotype UI IS shown when the annotation has biotypes",
    anyBiotypeWord.length ? "present in: " + anyBiotypeWord.join(", ")
                          : "absent everywhere - the gate is too aggressive");
} else {
  check(anyBiotypeWord.length === 0,
    "no biotype heading, column or filter anywhere",
    anyBiotypeWord.length ? "still present in: " + anyBiotypeWord.join(", ")
                          : "clean across " + Object.keys(seen).join(", "));
  check(anyUnknown.length === 0,
    "no \"Unknown\" placeholder rendered as a category",
    anyUnknown.length ? "still present in: " + anyUnknown.join(", ") : "clean");
}

console.log(bad ? "\nBIOTYPE GATING FAILURES: " + bad : "\nBIOTYPE GATING OK");
process.exit(bad ? 1 : 0);
