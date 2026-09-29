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

const a = IV.state.core.assignment;
const uniAll = a.by_universe.all;
const FL = IV.flow;
const total = uniAll.total_molecules;
const withGene = FL.moleculesWithGene(a, uniAll);
const noGene = total - withGene;

let bad = 0;
for (const modeKey of ["ref","disc"]) {
  const univ = IV.state.core.universe[modeKey] || {};
  for (const level of ["gene","transcript"]) {
    const counted = univ["counted_molecules_" + level];
    const amb = FL.residual(univ, level, "__ambiguous");
    if (counted == null) { console.log(`skip ${modeKey}/${level}: no counted field`); continue; }
    const lost = FL.deriveLost(total, noGene, amb, counted);
    const sum = counted + (lost||0) + (amb||0) + noGene;
    const ok = Math.abs(sum - total) < 1;
    if (!ok) bad++;
    console.log(`${ok?"ok  ":"FAIL"} ${modeKey}/${level}: counted ${counted} + lost ${lost} + amb ${amb} + noGene ${noGene} = ${sum} vs total ${total}`);
  }
}
const fl = a.by_universe.fl.total_molecules;
const strict = a.n_full_length_strict;
console.log(`\nfull-length loose ${fl} (${(fl/total*100).toFixed(1)}%) <= total: ${fl<=total?"ok":"FAIL"}`);
if (strict!=null) console.log(`strict ${strict} <= loose: ${strict<=fl?"ok":"FAIL"}`);
IV.state.view="overview"; await IV.app.renderView();
function deep(n){const k=n.childNodes||[];if(!k.length){if(n._html)return String(n._html).replace(/<[^>]*>/g," ");if(n.textContent)return n.textContent;return "";}
 let o="";for(const c of k){if(c.tagName){if(c.tagName==="SCRIPT")continue;o+=deep(c)+" ";}else o+=(c.textContent||"")+" ";}return o;}
const txt=deep(document.getElementById("content"));
console.log("\nrendered flow shows an 'Unaccounted' band:", /Unaccounted/i.test(txt) ? "YES (a branch is missing)" : "no");
process.exit(bad?1:0);
if (!bad) console.log("FLOW CONSERVES");
