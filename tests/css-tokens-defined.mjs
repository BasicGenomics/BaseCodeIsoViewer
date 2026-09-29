import fs from "node:fs";
import path from "node:path";

const cssDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "web", "css");
const files = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css"));

let all = "";
for (const f of files) all += fs.readFileSync(path.join(cssDir, f), "utf8") + "\n";

const src = all.replace(/\/\*[\s\S]*?\*\//g, "");

const defined = new Set();
for (const m of src.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);

const used = new Map();
for (const m of src.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,|\))/g)) {
  if (m[2] === ",") continue;
  used.set(m[1], (used.get(m[1]) || 0) + 1);
}

const missing = [...used.keys()].filter((k) => !defined.has(k)).sort();

console.log(`\n  ${files.length} stylesheets, ${defined.size} tokens defined, `
  + `${used.size} referenced without a fallback`);

if (missing.length) {
  console.log("\nUNDEFINED TOKENS (each silently voids its declaration):");
  for (const k of missing) console.log(`  ${k}  (${used.get(k)} use(s))`);
  process.exit(1);
}
console.log("\nCSS TOKENS ALL DEFINED");
