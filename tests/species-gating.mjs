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

let bad = 0;
function check(cond, name, detail) {
  if (cond) console.log("  ok   " + name + (detail ? "  -- " + detail : ""));
  else { console.log("  FAIL " + name + (detail ? "  -- " + detail : "")); bad++; }
}

const SP = IV.species;
const latin = SP.latin();
const human = SP.isHuman();
console.log(`\n  reference resolves to: ${JSON.stringify(latin)}  (human: ${human})\n`);
check(!!latin, "the organism was resolved from the reference", latin || "EMPTY");

const u = await IV.stateApi.universe();
IV.state.view = "gene";
IV.state.viewArg = { index: 0 };
IV.state.openGene = { mode: IV.state.mode, index: 0 };
await IV.app.renderView();

function collect(node, tag, out) {
  for (const c of node.childNodes || []) {
    if (!c.tagName) continue;
    if (c.tagName === tag) out.push(c);
    collect(c, tag, out);
  }
  return out;
}
function deepText(node){const kids=node.childNodes||[];
 if(!kids.length){if(node._html)return String(node._html).replace(/<[^>]*>/g," ")+" ";
  if(node.textContent)return node.textContent+" ";return "";}
 let o="";for(const c of kids){if(c.tagName){if(c.tagName==="SCRIPT"||c.tagName==="STYLE")continue;o+=deepText(c)+" ";}else o+=(c.textContent||"")+" ";}return o;}

const content = document.getElementById("content");
const hrefs = collect(content, "A", []).map((a) => a.getAttribute("href") || "");
const text = deepText(content);

if (human) {
  check(true, "human run: human-only resources are permitted", "no exclusions expected");
} else {
  const wrongSpecies = hrefs.filter((h) => /Homo_sapiens/.test(h));
  check(wrongSpecies.length === 0, "no link points at Homo sapiens",
    wrongSpecies.length ? wrongSpecies[0] : "clean");

  const wrongDb = hrefs.filter((h) => /genome\.ucsc\.edu/.test(h));
  const okDb = SP.ucscDb();
  check(okDb ? true : wrongDb.length === 0,
    "no UCSC link without a mapped assembly",
    okDb ? "assembly " + okDb + " is mapped" : (wrongDb.length ? wrongDb[0] : "clean"));

  const gc = hrefs.filter((h) => /genecards\.org/.test(h));
  check(gc.length === 0, "no GeneCards link on a non-human run",
    gc.length ? gc[0] : "clean");

  for (const nm of ["gnomAD variants", "ClinVar variants"]) {
    check(!new RegExp("(Load|Show|Hide) " + nm).test(text),
      `no "${nm}" button on a non-human run`,
      new RegExp("(Load|Show|Hide) " + nm).test(text) ? "still offered" : "withheld");
  }

  const ens = hrefs.filter((h) => /ensembl\.org\//.test(h));
  const key = SP.ensemblSpecies();
  const wrong = ens.filter((h) => key && h.indexOf("/" + key + "/") < 0);
  check(wrong.length === 0, "every Ensembl link names this organism",
    wrong.length ? wrong[0] : (ens.length ? "all " + ens.length + " correct"
                                          : "none offered"));
}

console.log(bad ? "\nSPECIES GATING FAILURES: " + bad : "\nSPECIES GATING OK");
process.exit(bad ? 1 : 0);
