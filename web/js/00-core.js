window.IV = window.IV || {};

(function (IV) {
  "use strict";

  const nf = new Intl.NumberFormat("en-US");

  function int(n) {
    if (n == null || !isFinite(n)) return "–";
    return nf.format(Math.round(n));
  }

  function compact(n, digits) {
    if (n == null || !isFinite(n)) return "–";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(digits == null ? 2 : digits) + " B";
    if (a >= 1e6) return (n / 1e6).toFixed(digits == null ? 2 : digits) + " M";
    if (a >= 1e5) return (n / 1e3).toFixed(digits == null ? 1 : digits) + " k";
    return int(n);
  }

  function dec(n, d) {
    if (n == null || !isFinite(n)) return "–";
    const digits = d == null ? 2 : d;
    return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits,
      maximumFractionDigits: digits }).format(n);
  }

  function mols(n, digits) {
    return compact(n, digits) + (n === 1 ? " molecule" : " molecules");
  }

  function tpm(n) {
    if (n == null || !isFinite(n)) return "–";
    if (n === 0) return "0";
    if (n < 0.01) return n.toExponential(1);
    if (n < 1) return dec(n, 3);
    if (n < 100) return dec(n, 2);
    if (n < 10000) return dec(n, 1);
    return int(n);
  }

  function pct(n, d) {
    if (n == null || !isFinite(n)) return "–";
    return (n * 100).toFixed(d == null ? 1 : d) + "%";
  }

  function pctOf(a, b, d) {
    if (!b) return "–";
    return pct(a / b, d);
  }

  function bp(n) {
    if (n == null || !isFinite(n)) return "–";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + " Mb";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + " kb";
    return int(n) + " bp";
  }

  function bytes(n) {
    if (n == null || !isFinite(n)) return "–";
    const u = ["B", "kB", "MB", "GB", "TB"];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(v < 10 ? 2 : 1)) + " " + u[i];
  }

  const STRAND = ["+", "-", "."];

  function pretty(s) {
    if (!s) return "";
    const t = String(s).replace(/_/g, " ").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  const TERMS = {
    snrna: "snRNA", snorna: "snoRNA", mirna: "miRNA", scarna: "scaRNA",
    lncrna: "lncRNA", rrna: "rRNA", trna: "tRNA", srna: "sRNA",
    sirna: "siRNA", pirna: "piRNA", scrna: "scRNA",
    "vault rna": "vault RNA", "misc rna": "misc RNA",
    "mt trna": "Mt tRNA", "mt rrna": "Mt rRNA",
    ribozyme: "Ribozyme", "protein coding": "Protein coding", tec: "TEC",
    nic: "NIC", nnic: "NNIC",
  };

  function isInitialism(w) { return /^[A-Z0-9]{2,5}$/.test(w); }

  function prettyBiotype(s) {
    if (!s) return "";
    const raw = String(s).trim();
    const flat = raw.toLowerCase().replace(/_/g, " ").trim();
    if (TERMS[flat]) return TERMS[flat];
    const m = /^(IG|TR)[_ ](.+)$/i.exec(raw);
    if (m) {
      const rest = m[2].split(/[_\s]+/).map(function (w) {
        return w.length === 1 ? w.toUpperCase() : w.toLowerCase();
      }).join(" ");
      return m[1].toUpperCase() + " " + rest;
    }
    return raw.split(/[_\s]+/).map(function (w, i) {
      const lw = w.toLowerCase();
      if (TERMS[lw]) return TERMS[lw];
      if (isInitialism(w)) return w;
      return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw;
    }).join(" ");
  }

  const TAGS = {
    mane_select: "MANE Select", mane_plus_clinical: "MANE Plus Clinical",
    ensembl_canonical: "Ensembl Canonical", gencode_primary: "GENCODE Primary",
    gencode_basic: "GENCODE Basic", basic: "Basic", ccds: "CCDS",
    seleno: "Selenoprotein", readthrough_transcript: "Readthrough transcript",
    retained_intron: "Retained intron",
  };
  function prettyTag(s) {
    if (!s) return "";
    const k = String(s).trim().toLowerCase();
    return TAGS[k] || prettyBiotype(s);
  }

  function stripVersion(id) {
    return id ? String(id).split(".")[0] : id;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "html") n.innerHTML = v;
        else if (k === "text") n.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
        else if (k.slice(0, 2) === "on" && typeof v === "function") {
          n.addEventListener(k.slice(2), v);
        } else n.setAttribute(k, v === true ? "" : v);
      }
    }
    if (children != null) append(n, children);
    return n;
  }

  function append(parent, children) {
    if (Array.isArray(children)) {
      for (const c of children) if (c != null) append(parent, c);
    } else if (typeof children === "string" || typeof children === "number") {
      parent.appendChild(document.createTextNode(String(children)));
    } else if (children instanceof Node) {
      parent.appendChild(children);
    }
    return parent;
  }

  function svgEl(tag, attrs) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        n.setAttribute(k, v === true ? "" : v);
      }
    }
    return n;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function byId(id) { return document.getElementById(id); }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function token(name) { return cssVar(name) || "#888"; }

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms == null ? 140 : ms);
    };
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function toCSV(header, rows, sep) {
    const s = sep || ",";
    const esc = function (v) {
      if (v == null) return "";
      const t = String(v);
      return (t.indexOf(s) >= 0 || t.indexOf('"') >= 0 || t.indexOf("\n") >= 0)
        ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const out = [header.map(esc).join(s)];
    for (const r of rows) out.push(r.map(esc).join(s));
    return out.join("\n") + "\n";
  }

  function quantileSorted(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function log2(x) { return Math.log(x) / Math.LN2; }

  const NAT = (function () {
    try {
      const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      return function (a, b) { return coll.compare(String(a), String(b)); };
    } catch (e) {
      return function (a, b) {
        const ax = String(a).match(/(\d+|\D+)/g) || [];
        const bx = String(b).match(/(\d+|\D+)/g) || [];
        for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
          const an = /^\d/.test(ax[i]), bn = /^\d/.test(bx[i]);
          if (an && bn) {
            const d = parseInt(ax[i], 10) - parseInt(bx[i], 10);
            if (d) return d;
          } else if (ax[i] !== bx[i]) {
            return ax[i] < bx[i] ? -1 : 1;
          }
        }
        return ax.length - bx.length;
      };
    }
  })();

  function cmpNatural(a, b) { return NAT(a, b); }

  IV.fmt = {
    prettyBiotype, prettyTag, int, compact, dec, tpm, mols, pct, pctOf, bp, bytes, pretty, stripVersion,
             escapeHtml, STRAND, cmpNatural };
  IV.dom = { el, svgEl, append, clear, byId, token, cssVar, debounce, download, toCSV };
  IV.stat = { quantileSorted, log2 };
})(window.IV);
