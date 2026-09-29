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
function deepText(node){const kids=node.childNodes||[];
 if(!kids.length){if(node._html)return String(node._html).replace(/<[^>]*>/g," ")+" ";
  if(node.textContent)return node.textContent+" ";return "";}
 let o="";for(const c of kids){if(c.tagName){if(c.tagName==="SCRIPT"||c.tagName==="STYLE")continue;o+=deepText(c)+" ";}else o+=(c.textContent||"")+" ";}return o;}
await IV.app.boot();
let bad=0;
for (const uni of ["all","fl"]) {
  for (const view of ["overview","qcBaseCode","assignment"]) {
    IV.state.universe=uni; IV.state.view=view;
    IV.app.buildHeader();
    await IV.app.renderView();
    const txt=deepText(document.getElementById("content"));
    const over=[...txt.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
      .map(x=>parseFloat(x[1])).filter(v=>v>100.5);
    const tag = view+" ["+uni+"]";
    if (over.length) { console.log("FAIL "+tag+" -> percentages >100: "+over.join(", ")); bad++; }
    else console.log("ok   "+tag+" -> no percentage exceeds 100");
  }
}
process.exit(bad?1:0);
if (!bad) console.log("SHARES SANE");
