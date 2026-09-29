import fs from "node:fs";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const css = fs.readFileSync(path.join(HERE, "..", "web", "css", "tokens.css"), "utf8");

const KEYS = /--(brand|brand-ink|brand-lift|accent|accent-ink|cat-[1-8]|seq-[1-8]00|page|surface|sidebar|ink|ink-2|div-neg|div-pos|div-mid)\s*:\s*([^;]+);/g;
function grab(startIdx) {
  const seg = css.slice(startIdx, startIdx + 4000);
  const out = {};
  let m;
  const re = new RegExp(KEYS.source, "g");
  while ((m = re.exec(seg))) out[m[1]] = m[2].trim();
  return out;
}
const mediaAt = css.indexOf("@media (prefers-color-scheme: dark)");
const attrAt = css.indexOf(':root[data-theme="dark"]');
if (mediaAt < 0 || attrAt < 0) {
  console.error("could not find both dark blocks"); process.exit(1);
}
const a = grab(mediaAt), b = grab(attrAt);
const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
const diffs = keys.filter((k) => a[k] !== b[k]);
console.log(`compared ${keys.length} tokens across both dark blocks`);
if (diffs.length) {
  console.log(`OUT OF SYNC (${diffs.length}):`);
  for (const k of diffs) console.log(`  --${k}: media=${a[k]}  data-theme=${b[k]}`);
  process.exit(1);
}
console.log("dark blocks agree");
