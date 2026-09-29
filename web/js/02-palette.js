(function (IV) {
  "use strict";

  const T = IV.dom.token;

  const CAT_SLOTS = 8;
  const RAMP_ANCHORS = ["#ec008c", "#97b3d6", "#583092"];

  function hexToRgb(h) {
    const x = String(h).replace("#", "");
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16),
            parseInt(x.slice(4, 6), 16)];
  }
  function srgbToLin(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function linToSrgb(v) {
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  }
  function hex2(n) { return n.toString(16).padStart(2, "0"); }

  function brandRamp(t) {
    let u = isFinite(t) ? t : 0;
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    const n = RAMP_ANCHORS.length - 1;
    const seg = Math.min(n - 1, Math.floor(u * n));
    const f = u * n - seg;
    const a = hexToRgb(RAMP_ANCHORS[seg]).map(srgbToLin);
    const b = hexToRgb(RAMP_ANCHORS[seg + 1]).map(srgbToLin);
    const out = [0, 1, 2].map(function (k) {
      return linToSrgb(a[k] + (b[k] - a[k]) * f);
    });
    return "#" + hex2(out[0]) + hex2(out[1]) + hex2(out[2]);
  }

  function rampSeries(i, n) {
    if (!(n > 1)) return brandRamp(0);
    return brandRamp(i / (n - 1));
  }

  function series(i) { return T("--cat-" + ((i % CAT_SLOTS) + 1)); }

  function sampleColor(i, n) { return rampSeries(i, n); }
  const SERIES_CAP_ALL_PAIRS = 3;

  const ASSIGN_FAMILY = {
    unique: "resolved",
    unique_minor_difference: "resolved",
    ambiguous: "ambiguous",
    inconsistent_ambiguous: "ambiguous",
    inconsistent: "inconsistent",
    inconsistent_non_intronic: "inconsistent",
    noninformative: "none",
    intergenic: "none",
  };

  const ASSIGN_STEP = {
    unique: 0, unique_minor_difference: 1,
    ambiguous: 0, inconsistent_ambiguous: 1,
    inconsistent: 0, inconsistent_non_intronic: 1,
    noninformative: 0, intergenic: 1,
  };

  const FAMILY_VAR = {
    resolved: "--as-resolved",
    ambiguous: "--as-ambiguous",
    inconsistent: "--as-inconsistent",
    none: "--as-none",
  };

  const FAMILY_LABEL = {
    resolved: "Resolved to one transcript variant",
    ambiguous: "Ambiguous between transcript variants",
    inconsistent: "Inconsistent with the annotation",
    none: "Not assigned to a gene",
  };

  const FAMILY_ORDER = ["resolved", "ambiguous", "inconsistent", "none"];

  const ASSIGN_LABEL = {
    unique: "Unique",
    unique_minor_difference: "Unique (minor difference)",
    ambiguous: "Ambiguous",
    inconsistent_ambiguous: "Inconsistent + ambiguous",
    inconsistent: "Inconsistent",
    inconsistent_non_intronic: "Inconsistent (non-intronic)",
    noninformative: "Noninformative",
    intergenic: "Intergenic",
  };

  const ASSIGN_HELP = {
    unique: "Compatible with exactly one annotated transcript variant.",
    unique_minor_difference:
      "Compatible with one transcript variant apart from minor alignment "
      + "differences.",
    ambiguous:
      "Equally compatible with several transcript variants of the gene.",
    inconsistent_ambiguous:
      "Contradicts the annotation and cannot be narrowed to one transcript "
      + "variant.",
    inconsistent: "Contradicts the annotated structure (novel junction, retained intron…).",
    inconsistent_non_intronic:
      "Contradicts the annotation only outside intron boundaries.",
    noninformative: "No informative overlap with any annotated gene.",
    intergenic: "Falls outside every annotated gene.",
  };

  function assignColor(type) {
    const fam = ASSIGN_FAMILY[type] || "none";
    const step = ASSIGN_STEP[type] || 0;
    return T(FAMILY_VAR[fam] + (step ? "-2" : ""));
  }
  function assignFamily(type) { return ASSIGN_FAMILY[type] || "none"; }
  function familyColor(fam) { return T(FAMILY_VAR[fam] || "--as-none"); }

  function orderAssign(values) {
    const rank = {};
    let k = 0;
    for (const fam of FAMILY_ORDER) {
      for (const t in ASSIGN_FAMILY) {
        if (ASSIGN_FAMILY[t] === fam) rank[t] = k + (ASSIGN_STEP[t] || 0) * 0.5;
      }
      k += 10;
    }
    return values.slice().sort(function (a, b) {
      return (rank[a] == null ? 99 : rank[a]) - (rank[b] == null ? 99 : rank[b]);
    });
  }

  const NOVEL_VAR = { known: "--nov-known", nic: "--nov-nic", nnic: "--nov-nnic",
                      novel: "--nov-nnic" };
  const NOVEL_LABEL = {
    known: "Known", nic: "NIC (novel in catalog)",
    nnic: "NNIC (novel not in catalog)", novel: "Novel",
  };
  const NOVEL_SHORT = { known: "Known", nic: "NIC", nnic: "NNIC", novel: "Novel" };
  function novelColor(k) { return T(NOVEL_VAR[k] || "--as-none"); }

  const END_ORDER = ["T_F_I", "T_F", "T_I", "F_I", "T", "F", "I", "none"];
  const END_LABEL = {
    T_F_I: "3′ + Internal + 5′", T_F: "3′ + 5′", T_I: "3′ + Internal",
    F_I: "5′ + Internal", T: "3′ only", F: "5′ only", I: "Internal only",
    none: "No end support",
  };
  const END_REAL = END_ORDER.filter(function (k) { return k !== "none"; });
  function endColor(k) {
    const i = END_REAL.indexOf(k);
    if (i < 0) return T("--as-none");
    return rampSeries(i, END_REAL.length);
  }

  const SEQ_STEPS = ["--seq-100", "--seq-200", "--seq-300", "--seq-400",
                     "--seq-500", "--seq-600", "--seq-700", "--seq-800"];

  function sequential(t) {
    if (!isFinite(t)) return T("--seq-100");
    const i = Math.max(0, Math.min(SEQ_STEPS.length - 1,
                                   Math.round(t * (SEQ_STEPS.length - 1))));
    return T(SEQ_STEPS[i]);
  }

  const GM_STEPS = ["--gm-100", "--gm-200", "--gm-300", "--gm-400",
                    "--gm-500", "--gm-600", "--gm-700", "--gm-800"];

  function geneModelShade(t) {
    if (!isFinite(t)) return T("--gm-300");
    const i = Math.max(0, Math.min(GM_STEPS.length - 1,
                                   Math.round(t * (GM_STEPS.length - 1))));
    return T(GM_STEPS[i]);
  }

  const DIV_STEPS = ["--div-neg", "--div-neg-2", "--div-mid", "--div-pos-2", "--div-pos"];

  function diverging(t) {
    if (!isFinite(t)) return T("--div-mid");
    const c = Math.max(-1, Math.min(1, t));
    const i = Math.round((c + 1) / 2 * (DIV_STEPS.length - 1));
    return T(DIV_STEPS[i]);
  }

  const DOMAIN_ORDER = ["Pfam", "SMART", "PROSITE_profiles", "PROSITE_patterns",
                        "Gene3D", "Superfamily", "PANTHER", "Other"];
  function domainColor(type) {
    const i = DOMAIN_ORDER.indexOf(type);
    return series(i < 0 ? DOMAIN_ORDER.length - 1 : i);
  }

  const CSQ_SEVERITY = {
    transcript_ablation: "critical", splice_acceptor_variant: "critical",
    splice_donor_variant: "critical", stop_gained: "critical",
    frameshift_variant: "critical", stop_lost: "critical",
    start_lost: "critical",
    inframe_insertion: "serious", inframe_deletion: "serious",
    missense_variant: "serious", protein_altering_variant: "serious",
    splice_region_variant: "warning", incomplete_terminal_codon_variant: "warning",
    start_retained_variant: "warning", stop_retained_variant: "warning",
    synonymous_variant: "good",
  };
  function csqColor(csq) {
    const k = CSQ_SEVERITY[csq];
    return k ? statusColor(k) : T("--ink-muted");
  }

  function clinsigColor(sig) {
    const t = String(sig || "").toLowerCase();
    if (t.indexOf("conflicting") >= 0 || t.indexOf("uncertain") >= 0) {
      return T("--ink-faint");
    }
    if (t.indexOf("likely pathogenic") >= 0) return statusColor("serious");
    if (t.indexOf("pathogenic") >= 0) return statusColor("critical");
    if (t.indexOf("likely benign") >= 0) return T("--cat-6");
    if (t.indexOf("benign") >= 0) return statusColor("good");
    return T("--ink-muted");
  }

  const REG_ORDER = ["promoter", "enhancer", "CTCF_binding_site",
                     "TF_binding_site", "open_chromatin_region",
                     "promoter_flanking_region"];
  function regColor(kind) {
    const i = REG_ORDER.indexOf(kind);
    return series(CAT_SLOTS - 1 - (i < 0 ? 0 : i % CAT_SLOTS));
  }

  const STATUS_VAR = { good: "--st-good", warning: "--st-warning",
                       serious: "--st-serious", critical: "--st-critical" };
  const STATUS_ICON = { good: "✓", warning: "!", serious: "!", critical: "✕" };
  function statusColor(k) { return T(STATUS_VAR[k] || "--ink-muted"); }

  IV.pal = {
    series, sampleColor, SERIES_CAP_ALL_PAIRS, CAT_SLOTS,
    brandRamp, rampSeries, RAMP_ANCHORS,
    assignColor, assignFamily, familyColor, orderAssign,
    ASSIGN_LABEL, ASSIGN_HELP, ASSIGN_FAMILY, FAMILY_LABEL, FAMILY_ORDER,
    novelColor, NOVEL_LABEL, NOVEL_SHORT,
    endColor, END_ORDER, END_LABEL,
    sequential, diverging, statusColor, STATUS_ICON,
    geneModelShade,
    domainColor, csqColor, clinsigColor, regColor,
    DOMAIN_ORDER, REG_ORDER, CSQ_SEVERITY,
  };
})(window.IV);
