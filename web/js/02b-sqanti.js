(function (IV) {
  "use strict";

  const CAT = {
    "FSM": "#6BAED6",
    "ISM": "#FC8D59",
    "NIC": "#78C679",
    "NNC": "#EE6A50",
    "Genic Genomic": "#969696",
    "Antisense": "#66C2A4",
    "Fusion": "#FFC125",
    "Intergenic": "#E9967A",
    "Genic Intron": "#41B6C4",
  };

  const SUBCAT = {
    "Alternative 3'end": "#02314d",
    "Alternative 3'5'end": "#0e5a87",
    "Alternative 5'end": "#7ccdfc",
    "Reference match": "#c4e1f2",
    "3' fragment": "#c4531d",
    "Internal fragment": "#e37744",
    "5' fragment": "#e0936e",
    "Comb. of annot. junctions": "#014d02",
    "Comb. of annot. splice sites": "#379637",
    "Intron retention": "#81eb82",
    "Not comb. of annot. junctions": "#6ec091",
    "Mono-exon by intron ret.": "#4aaa72",
    "At least 1 annot. don./accept.": "#32734d",
    "Mono-exon": "#cec2d2",
    "Multi-exon": "#876a91",
  };

  const CAT_LABEL = {
    "FSM": "Full splice match",
    "ISM": "Incomplete splice match",
    "NIC": "Novel in catalog",
    "NNC": "Novel not in catalog",
    "Genic Genomic": "Genic genomic",
    "Antisense": "Antisense",
    "Fusion": "Fusion",
    "Intergenic": "Intergenic",
    "Genic Intron": "Genic intron",
  };

  function catKey(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (CAT[s]) return s;
    const n = s.toLowerCase().replace(/[\s_\-\n]+/g, "");
    const MAP = {
      fullsplicematch: "FSM", fsm: "FSM",
      incompletesplicematch: "ISM", ism: "ISM",
      monoexonmatch: "ISM",
      novelincatalog: "NIC", nic: "NIC",
      novelnotincatalog: "NNC", nnc: "NNC", nnic: "NNC",
      genic: "Genic Genomic", genicgenomic: "Genic Genomic",
      antisense: "Antisense",
      fusion: "Fusion",
      intergenic: "Intergenic",
      genicintron: "Genic Intron",
    };
    return MAP[n] || null;
  }

  function subcatKey(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (SUBCAT[s]) return s;
    const n = s.toLowerCase().replace(/[\s_\-.\n']+/g, "");
    for (const k in SUBCAT) {
      if (k.toLowerCase().replace(/[\s_\-.\n']+/g, "") === n) return k;
    }
    return null;
  }

  function categoryColor(raw, fallback) {
    const k = catKey(raw);
    return k ? CAT[k] : (fallback || IV.dom.token("--as-none"));
  }

  function subcategoryColor(raw, fallback) {
    const k = subcatKey(raw);
    return k ? SUBCAT[k] : (fallback || IV.dom.token("--as-none"));
  }

  const CAT_DEF = {
    "FSM": "Same number of exons as the reference and every internal junction "
      + "agrees. The 5′ start and 3′ end may differ by any amount.",
    "ISM": "Fewer 5′ exons than the reference, but every internal junction it "
      + "does have agrees. The 5′ start and 3′ end may differ by any amount.",
    "NIC": "No FSM or ISM match, but built entirely from known donor and "
      + "acceptor sites.",
    "NNC": "No FSM or ISM match, and at least one donor or acceptor site is not "
      + "annotated.",
    "Antisense": "Does not overlap a same-strand reference gene, but runs "
      + "antisense to an annotated one.",
    "Genic Intron": "Falls entirely inside an annotated intron.",
    "Genic Genomic": "Overlaps both exons and introns of an annotated gene.",
    "Intergenic": "Lies in an intergenic region.",
    "Fusion": "Spans two different annotated genes.",
  };

  const NOVEL_SUBCATS = ["Comb. of annot. junctions", "Comb. of annot. splice sites",
                         "At least 1 annot. don./accept.", "Intron retention",
                         "Mono-exon by intron ret."];
  const CAT_SUBCATS = {
    "FSM": ["Reference match", "Alternative 3'end", "Alternative 5'end",
            "Alternative 3'5'end"],
    "ISM": ["3' fragment", "Internal fragment", "5' fragment", "Intron retention",
            "Mono-exon by intron ret."],
    "NIC": NOVEL_SUBCATS,
    "NNC": NOVEL_SUBCATS,
  };

  const SUBCAT_NOTE = "Every isoform is additionally recorded as Mono-exon or "
    + "Multi-exon in the same field.";

  function categoryDef(raw) {
    const k = catKey(raw);
    return k ? (CAT_DEF[k] || null) : null;
  }

  function categorySubcats(raw) {
    const k = catKey(raw);
    return (k && CAT_SUBCATS[k]) || [];
  }

  function categoryShort(raw) {
    return catKey(raw) || String(raw == null ? "" : raw);
  }

  function categoryLabel(raw) {
    const k = catKey(raw);
    return k ? (CAT_LABEL[k] || k) : String(raw == null ? "" : raw);
  }

  function looksLikeCategories(values) {
    if (!values || !values.length) return false;
    let hit = 0;
    for (const v of values) if (catKey(v)) hit++;
    return hit / values.length >= 0.5;
  }

  IV.sqanti = {
    CAT, SUBCAT, CAT_LABEL, CAT_DEF, CAT_SUBCATS, SUBCAT_NOTE,
    catKey, subcatKey,
    categoryColor, subcategoryColor, categoryShort, categoryLabel,
    categoryDef, categorySubcats,
    looksLikeCategories,
  };
})(window.IV);
