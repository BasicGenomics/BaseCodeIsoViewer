(function (IV) {
  "use strict";

  const SUFFIXES = [
    "no_rrna", "norrna", "rrna_filtered", "filtered",
    "isoquant", "collapsed", "primary", "toplevel", "masked",
  ];

  function rawReference() {
    const core = IV.state && IV.state.core;
    const ann = (core && core.run && core.run.annotation) || {};
    return String(ann.reference_name || ann.reference || "").trim();
  }

  function latin() {
    const raw = rawReference();
    if (!raw) return "";
    let parts = raw.replace(/\.(fa|fasta|fna)(\.gz)?$/i, "")
      .split(/[_\-\s]+/).filter(Boolean);
    let changed = true;
    while (changed && parts.length > 2) {
      changed = false;
      const tail = parts[parts.length - 1].toLowerCase();
      if (SUFFIXES.indexOf(tail) >= 0 || /^(v|r)?\d+$/.test(tail)) {
        parts.pop(); changed = true;
      }
    }
    if (!parts.length) return "";
    const genus = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    if (parts.length === 1) return genus;
    return genus + " " + parts[1].toLowerCase();
  }

  function ensemblSpecies() {
    const l = latin();
    return l ? l.replace(/\s+/g, "_") : "";
  }

  function isHuman() {
    const l = latin().toLowerCase();
    return l === "homo sapiens";
  }

  const UCSC_DB = {
    "homo sapiens": "hg38",
    "mus musculus": "mm39",
    "danio rerio": "danRer11",
    "rattus norvegicus": "rn7",
    "drosophila melanogaster": "dm6",
    "caenorhabditis elegans": "ce11",
    "gallus gallus": "galGal6",
    "sus scrofa": "susScr11",
    "bos taurus": "bosTau9",
    "macaca mulatta": "rheMac10",
  };

  function ucscDb() { return UCSC_DB[latin().toLowerCase()] || null; }

  const HUMAN_ONLY = { gnomad: 1, clinvar: 1, genecards: 1, uniprot: 1 };

  function speciesHas(key) {
    if (key === "ucsc") return !!ucscDb();
    if (HUMAN_ONLY[key]) return isHuman();
    return !!latin();
  }

  const idCache = new WeakMap();
  function usesEnsemblIds(frame) {
    if (!frame || !frame.has("id")) return false;
    const hit = idCache.get(frame);
    if (hit !== undefined) return hit;
    const col = frame.col("id");
    const n = Math.min(frame.n, 400);
    let ens = 0, seen = 0;
    for (let i = 0; i < n; i++) {
      const v = String(IV.blocks.cell(col, i) || "");
      if (!v) continue;
      seen++;
      if (/^ENS[A-Z]*[GTP]\d/.test(v)) ens++;
    }
    const out = seen > 0 && ens / seen >= 0.5;
    idCache.set(frame, out);
    return out;
  }

  function canUse(key, frame) {
    if (!speciesHas(key)) return false;
    if (key === "domains" || key === "ensembl") return usesEnsemblIds(frame);
    return true;
  }

  function unavailableReason(key, frame) {
    if (!speciesHas(key)) {
      const l = latin();
      if (HUMAN_ONLY[key]) {
        return (l ? l : "This organism") + " is not covered by this resource; "
          + "it is human-only.";
      }
      if (key === "ucsc") {
        return "No UCSC assembly is mapped for " + (l || "this organism") + ".";
      }
      return "The organism could not be determined from the run's reference.";
    }
    if (!usesEnsemblIds(frame)) {
      return "This annotation does not use Ensembl gene ids, so Ensembl cannot be "
        + "queried for it.";
    }
    return "";
  }

  IV.species = {
    latin, ensemblSpecies, isHuman, ucscDb,
    speciesHas, usesEnsemblIds, canUse, unavailableReason,
    UCSC_DB,
  };
})(window.IV);
