(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;
  const P = IV.plots;

  function plotValue(key) {
    if (pv.value_[key] == null) pv.value_[key] = IV.state.valueMode;
    return pv.value_[key];
  }
  function withValue(vm, fn) {
    const prev = IV.state.valueMode;
    if (vm && vm !== prev) IV.state.valueMode = vm;
    try { return fn(); } finally { IV.state.valueMode = prev; }
  }

  function deriveUnfloored(u) {
    const prev = IV.state.stringency;
    if (prev === "exploratory") return IV.stateApi.derive(u);
    IV.state.stringency = "exploratory";
    try { return IV.stateApi.derive(u); } finally { IV.state.stringency = prev; }
  }

  function cvFloor() {
    if (pv.cv.minCounted != null) return pv.cv.minCounted;
    const min = (IV.stateApi.stringencyInfo() || {}).min || 0;
    return Math.max(10, min);
  }

  const pv = {
    value_: {},
    support: { view: "dot", level: "gene" },
    variants: { view: "dot" },
    value: { view: "bar", level: "gene" },
    cv: { view: "dot", level: "gene", minCounted: null },
    biotype: { level: "gene" },
    entropy: { minVar: 2, search: "" },
    jsd: { minVar: 2, search: "" },
  };

  async function render(host) {
    clear(host);
    const core = IV.state.core;
    const mode = IV.stateApi.modeInfo();
    const u = await IV.stateApi.universe();
    const d = IV.stateApi.derive(u);

    host.appendChild(runBand(core, mode));
    if (mode.key === "disc") {
      host.appendChild(U.callout(
        "<strong>Discovery mode shows reconstructed models, not curated " +
        "annotation entries.</strong> A model is a hypothesis supported by molecules. " +
        "Where a reference entry exists, prefer Reference mode for interpretation " +
        "and use this mode to find what the annotation is missing.", "warn"));
    }
    host.appendChild(flowCard(core, mode, u, d));
    host.appendChild(kpiTiles(core, mode, u, d));
    IV.ui.termsPanel(host, {});
    host.appendChild(plotsSection(core, mode, u, d));
    if (IV.stateApi.hasBiotypes(u.genes) || IV.stateApi.hasBiotypes(u.tx)) {
      host.appendChild(biotypeCard(core, mode, u, d));
    }
    host.appendChild(tablesSection(core, mode, u, d));
  }

  function runBand(core, mode) {
    const r = core.run;
    const c = U.card(null);
    const grid = el("div", { style: { display: "flex", gap: "var(--sp-5)",
      flexWrap: "wrap", alignItems: "baseline" } });

    grid.appendChild(el("div", {}, [
      el("div", { class: "tile-label", text: "Run" }),
      el("div", { style: { fontSize: "var(--fs-xl)", fontWeight: "650",
        letterSpacing: "-0.015em" }, text: r.name }),
    ]));

    const vpre = function (x) {
      return x ? "v" + String(x).replace(/^v/, "") : null;
    };
    const facts = [
      ["Annotation", (function () {
        const a = r.annotation || {};
        return a.label ? a.label + (a.assembly ? " · " + a.assembly : "") : null;
      })()],
      ["IsoQuant", vpre(r.isoquant_version)],
      ["Pipeline", vpre(r.pipeline_version)],
      ["Samples", F.int(core.samples.length)],
      ["Report built", (core.isoviewer.built || "").replace("T", " ").slice(0, 16)],
    ];
    for (const [k, v] of facts) {
      if (!v) continue;
      grid.appendChild(el("div", {}, [
        el("div", { class: "tile-label", text: k }),
        el("div", { class: "small", style: { fontWeight: "560" }, text: v }),
      ]));
    }
    grid.appendChild(el("div", { style: { flex: "1" } }));
    grid.appendChild(el("button", { class: "btn", text: "Versions & run settings →",
      title: "Every parameter and the pipeline's own versions log",
      onclick: function () { IV.app.go("run"); } }));
    c.appendChild(grid);

    const paras = mode.detail.split(/\n{2,}/);
    c.appendChild(el("p", { class: "note small", style: { margin: "10px 0 0" },
      html: "<strong>" + F.escapeHtml(mode.long) + "</strong> · "
        + F.escapeHtml(paras[0]) }));
    for (const para of paras.slice(1)) {
      c.appendChild(el("p", { class: "note small", style: { margin: "4px 0 0" },
        text: para }));
    }
    return c;
  }

  function flowCard(core, mode, u, d) {
    const FL = IV.flow;
    const a = core.assignment;
    const uniAll = a.by_universe.all;
    const univ = (core.universe || {})[mode.key] || {};
    const c = U.card("Data flow", {
      tour: "overview-flow",
      note: "Every read and molecule the run produced, from sequencing through to "
        + "what quantification counted.",
    });

    if (IV.px && IV.px.sankey && IV.px.available()) {
      const recon = (core.library && core.library.reconstruction) || null;
      const reconN = recon && recon.n_molecules != null ? recon.n_molecules : null;
      const S2 = IV.stateApi;
      const totAll2 = S2.assignTotals("all");
      const observed = totAll2.total_molecules;
      const gCounted2 = countedScoped(univ);
      const tCounted2 = countedTxScoped(univ);
      const gAmbRaw = FL.residual(univ, "gene", "__ambiguous");
      const runMol = (a.by_universe.all || {}).total_molecules || 0;
      const gAmb2 = gAmbRaw == null ? null
        : (S2.allSamplesOn() || !runMol
            ? gAmbRaw
            : Math.round(gAmbRaw * (observed / runMol)));
      let onGene2 = 0;
      a.assign_values.forEach(function (tp, i) {
        if ((a.outcome_of[tp] || "no_gene") !== "no_gene") {
          onGene2 += totAll2.assign[i];
        }
      });
      const noGene2 = observed - onGene2;
      const gLost2 = FL.deriveLost(observed, noGene2, gAmb2, gCounted2);

      const ss2 = core.library && core.library.summary_stats;
      let pairs2 = 0;
      if (ss2 && ss2.per_sample) {
        for (const si of S2.activeIdx()) {
          const r = ss2.per_sample[core.samples[si]] || {};
          pairs2 += r.reads_total || 0;
        }
      }
      const seqReads2 = pairs2 > 0 ? 2 * pairs2 : totAll2.total_reads;
      const usedReads2 = totAll2.total_reads || null;

      const daFlow = core.discovery_assignment;
      if (mode.key === "disc" && daFlow && daFlow.outcome
          && daFlow.outcome.molecules) {
        const PINK = "rgba(236,0,140,.30)";
        const GREY = "rgba(140,133,152,.22)";
        const nodes = [], links = [];
        const nd = function (label, color, text, note, short) {
          nodes.push({ label: label, color: color || IV.dom.token("--brand"),
                       text: text || null, note: note || null,
                       short: short || null });
          return nodes.length - 1;
        };
        const NODE_PINK = IV.dom.token("--brand");
        const NODE_GREY = IV.dom.token("--gm-400") || IV.dom.token("--gm-300");
        const om = daFlow.outcome.molecules;
        const ov = daFlow.outcome.values || [];
        const olab = daFlow.outcome.labels || [];
        const sumOut = om.reduce(function (x, y) { return x + y; }, 0);
        const nSeq = nd("Sequencing reads · " + F.compact(seqReads2, 2), NODE_GREY,
          F.compact(seqReads2, 2) + " sequencing reads", null, "Sequencing reads");
        const nRec = nd("Molecules reconstructed", NODE_PINK,
          F.mols(sumOut, 2), null, "Molecules reconstructed");
        const lostR = usedReads2 && seqReads2 > usedReads2
          ? seqReads2 - usedReads2 : 0;
        links.push({ source: nSeq, target: nRec, value: sumOut, color: GREY,
          text: (usedReads2 && seqReads2 > usedReads2
                  ? F.compact(usedReads2, 2) + " of " + F.compact(seqReads2, 2)
                    + " reads"
                  : F.compact(usedReads2 || seqReads2, 2) + " reads")
            + " → " + F.mols(sumOut, 2),
          note: usedReads2
            ? F.pctOf(usedReads2, seqReads2, 1)
              + " of sequenced reads ended up in a molecule"
            : null });
        if (lostR > 0) {
          const nL = nd("Not in any molecule · " + F.compact(lostR, 2), NODE_GREY,
            F.compact(lostR, 2) + " sequencing reads",
            "drawn to scale against the molecules, so its width is proportional "
              + "rather than a molecule count", "Not in any molecule");
          links.push({ source: nSeq, target: nL,
            value: sumOut * (lostR / usedReads2), color: GREY,
            text: F.compact(lostR, 2) + " reads",
            note: F.pctOf(lostR, seqReads2, 1) + " of sequenced reads never ended "
              + "up in a reconstructed molecule" });
        }
        ov.forEach(function (v, i) {
          if (!(om[i] > 0)) return;
          const onRoute = v === "unique";
          const nOut = nd(olab[i] || F.pretty(v),
                          onRoute ? NODE_PINK : NODE_GREY);
          links.push({ source: nRec, target: nOut, value: om[i],
            color: onRoute ? PINK : GREY,
            text: F.mols(om[i], 2),
            note: F.pctOf(om[i], sumOut, 1) + " of reconstructed molecules"
              + (onRoute ? " · the population quantification counts" : "") });
        });
        const badD = IV.px.checkConserves(nodes, links);
        if (!badD.length) {
          const skD = el("div");
          c.appendChild(skD);
          IV.px.sankey(skD, { nodes: nodes, links: links },
            { height: 320, valuesuffix: "molecules", exportName: "data-flow" });
        }
      }

      if (mode.key === "ref" && gCounted2 != null && gLost2 != null
          && gAmb2 != null) {
        const PINK = "rgba(236,0,140,.30)";
        const GREY = "rgba(140,133,152,.22)";
        const nodes = [], links = [];
        function nd(label, color, text, note, short) {
          nodes.push({ label: label, color: color || IV.dom.token("--brand"),
                       text: text || null, note: note || null,
                       short: short || null });
          return nodes.length - 1;
        }
        const NODE_PINK = IV.dom.token("--brand");
        const NODE_GREY = IV.dom.token("--gm-400");
        const nSeq = nd("Sequenced reads · " + F.compact(seqReads2, 2), NODE_GREY,
          F.compact(seqReads2, 2) + " sequencing reads", null, "Sequenced reads");
        const nRec = nd("Reconstructed molecules · " + F.compact(reconN || observed, 2),
                        NODE_PINK, F.mols(reconN || observed, 2),
                        null, "Reconstructed molecules");
        const lostReads2 = usedReads2 && seqReads2 > usedReads2
          ? seqReads2 - usedReads2 : 0;
        links.push({ source: nSeq, target: nRec, value: observed, color: GREY,
          text: (usedReads2 && seqReads2 > usedReads2
                  ? F.compact(usedReads2, 2) + " of " + F.compact(seqReads2, 2)
                    + " reads"
                  : F.compact(usedReads2 || seqReads2, 2) + " reads")
            + " → " + F.mols(observed, 2),
          note: usedReads2
            ? F.pctOf(usedReads2, seqReads2, 1)
              + " of sequenced reads ended up in a molecule"
            : null });
        if (lostReads2 > 0) {
          const nLost = nd("Not in any molecule · " + F.compact(lostReads2, 2),
                           NODE_GREY,
            F.compact(lostReads2, 2) + " sequencing reads",
            "drawn to scale against the molecules, so its width is proportional "
              + "rather than a molecule count", "Not in any molecule");
          links.push({ source: nSeq, target: nLost,
            value: observed * (lostReads2 / usedReads2), color: GREY,
            text: F.compact(lostReads2, 2) + " reads",
            note: F.pctOf(lostReads2, seqReads2, 1) + " of sequenced reads never "
              + "ended up in a reconstructed molecule" });
        }

        const nDet = nd("Detected molecules", NODE_PINK);
        links.push({ source: nRec, target: nDet, value: onGene2, color: PINK });
        if (noGene2 > 0) {
          const nNo = nd("No gene", NODE_GREY);
          links.push({ source: nRec, target: nNo, value: noGene2, color: GREY });
        }

        const gOnRoute = gCounted2;
        const tOnRoute = tCounted2;

        const nGC = nd("Counted molecules, gene", NODE_PINK);
        links.push({ source: nDet, target: nGC, value: gOnRoute, color: PINK });
        if (gAmb2 > 0) {
          const nA = nd("Ambiguous between genes", NODE_GREY);
          links.push({ source: nDet, target: nA, value: gAmb2, color: GREY });
        }
        if (gLost2 > 0) {
          const nL = nd("Contradicts the annotation", NODE_GREY);
          links.push({ source: nDet, target: nL, value: gLost2, color: GREY });
        }

        if (tOnRoute != null && tOnRoute <= gOnRoute) {
          const nTC = nd("Counted molecules, transcript", NODE_PINK);
          links.push({ source: nGC, target: nTC, value: tOnRoute, color: PINK });
          const geneOnlyCounted = gOnRoute - tOnRoute;
          if (geneOnlyCounted > 0) {
            const nGO = nd("Counted for the " + mode.geneWord + " only",
                           NODE_GREY, null,
                           "counted for the " + mode.geneWord + ", but for no "
                             + "single " + mode.featureWord);
            links.push({ source: nGC, target: nGO, value: geneOnlyCounted,
                         color: GREY });
          }
        }

        const bad2 = IV.px.checkConserves(nodes, links);
        if (!bad2.length) {
          const sk2 = el("div");
          c.appendChild(sk2);
          IV.px.sankey(sk2, { nodes: nodes, links: links },
            { height: 360, valuesuffix: "molecules",
              exportName: "data-flow" });
        }
      }
    }

    return c;
  }

  function countedTxScoped(univ) {
    if (!univ) return null;
    const S = IV.stateApi;
    const runWide = univ.counted_molecules_transcript;
    if (S.allSamplesOn()) return runWide;
    const vec = univ.counted_molecules_transcript_s;
    if (!vec) return runWide;
    const names = univ.counted_samples;
    const act = S.activeIdx();
    let sum = 0;
    for (let k = 0; k < act.length; k++) {
      const nm = IV.state.samples[act[k]];
      const ci = names ? names.indexOf(nm) : act[k];
      sum += vec[ci < 0 ? act[k] : ci] || 0;
    }
    return sum;
  }

  function countedScoped(univ) {
    if (!univ) return null;
    const S = IV.stateApi;
    const runWide = univ.counted_molecules_gene;
    if (S.allSamplesOn()) return runWide;
    const vec = univ.counted_molecules_gene_s;
    if (!vec) return runWide;
    const names = univ.counted_samples;
    const act = S.activeIdx();
    let sum = 0;
    for (let k = 0; k < act.length; k++) {
      const nm = IV.state.samples[act[k]];
      const ci = names ? names.indexOf(nm) : act[k];
      sum += vec[ci < 0 ? act[k] : ci] || 0;
    }
    return sum;
  }

  function kpiTiles(core, mode, u, d) {
    const box = el("div", { "data-tour": "overview-headline" });
    const uRow = el("div", { class: "control-row", style: { marginBottom: "var(--sp-2)" } });
    uRow.appendChild(IV.ui.universeSeg());
    box.appendChild(uRow);
    const a = core.assignment;
    const S = IV.stateApi;
    const uni = a.by_universe[IV.state.universe] || a.by_universe.all;
    const allUni = a.by_universe.all;
    const tot = S.assignTotals(IV.state.universe);
    const totAll = S.assignTotals("all");
    const totFl = S.assignTotals("fl");
    const scoped = tot && tot.scoped;

    const famTotals = { resolved: 0, ambiguous: 0, inconsistent: 0, none: 0 };
    a.assign_values.forEach(function (t, i) {
      famTotals[IV.pal.assignFamily(t)] += tot.assign[i];
    });
    const famSum = IV.pal.FAMILY_ORDER.reduce(function (s, k) { return s + famTotals[k]; }, 0);

    const g = u.genes, t = u.tx;
    const nS = IV.stateApi.nActive();
    const genesKept = d.geneRows.length;
    let genesQuant = 0, multiDet = 0, txDet = 0;
    let txGenes = null;
    for (let r = 0; r < d.geneRows.length; r++) {
      const i = d.geneRows[r];
      if (d.nDetected[i] > 0) genesQuant++;
      if (d.nVarDet[i] > 1) multiDet++;
    }
    const vm = t.col(S.valueColumn());
    const act = S.activeIdx();
    const txGi = t.has("gene_idx") ? t.col("gene_idx") : null;
    const seenGene = txGi ? new Set() : null;
    for (let r = 0; r < d.txRows.length; r++) {
      const i = d.txRows[r];
      for (let s = 0; s < nS; s++) {
        if (vm.get(i, act[s]) > 0) {
          txDet++;
          if (seenGene) seenGene.add(txGi[i]);
          break;
        }
      }
    }
    txGenes = seenGene ? seenGene.size : null;

    let onGene = 0;
    a.assign_values.forEach(function (tp, i) {
      if ((a.outcome_of[tp] || "no_gene") !== "no_gene") onGene += tot.assign[i];
    });
    let onGeneAll = 0, allSum = 0;
    a.assign_values.forEach(function (tp, i) {
      const v = totAll.assign[i];
      allSum += v;
      if ((a.outcome_of[tp] || "no_gene") !== "no_gene") onGeneAll += v;
    });
    const fullLengthView = IV.state.universe !== "all";
    const counted = mode.key === "ref"
      ? countedScoped(core.universe.ref)
      : countedScoped(core.universe.disc);
    const countedComparable = IV.state.weight === "mol"
      && IV.state.universe === "all";

    const items = [
      { label: "Molecules reconstructed", value: F.compact(tot.total_molecules, 2),
        sub: IV.state.universe === "all"
          ? (scoped ? "across " + F.int(S.nActive()) + " selected samples" : null)
          : F.pctOf(tot.total_molecules, totAll.total_molecules) + " of all molecules",
        help: "Distinct molecules the BaseCode Processing Pipeline built from "
          + "the reads." },
      { label: "Full-length", value: F.pctOf(totFl.total_molecules,
          totAll.total_molecules),
        sub: F.compact(totFl.total_molecules) + " molecules · "
          + F.pctOf(totFl.total_reads, totAll.total_reads) + " of reads",
        help: a.fl_definitions.fl },
      { label: "Assigned to a " + mode.geneWord, value: F.pctOf(onGene, famSum),
        sub: F.compact(onGene, 2) + " " + S.weightLabel(),
        help: F.pretty(S.weightLabel()) + " overlapping a "
          + mode.geneWord + "." },
      (counted != null && countedComparable)
        ? { label: "Counted toward a " + mode.geneWord,
        value: F.pctOf(counted, allSum),
        sub: F.mols(counted)
          + (fullLengthView ? " · of all molecules" : ""),
        meter: fullLengthView ? null : [
          { label: "Counted", value: counted,
            color: IV.dom.token("--brand") },
          { label: "Assigned but not counted",
            value: Math.max(0, onGeneAll - counted),
            color: IV.dom.token("--gm-300") },
          { label: "No gene at all", value: Math.max(0, allSum - onGeneAll),
            color: IV.dom.token("--as-none") },
        ],
        help: "Molecules IsoQuant counted toward a " + mode.geneWord
          + "." } : null,
      (function () {
        const da = core.discovery_assignment;
        if (mode.key === "disc") {
          if (!da || !da.outcome || !da.outcome.molecules) return null;
          const base = IV.state.weight === "read" ? "reads" : "molecules";
          const key = base + (IV.state.universe === "fl" ? "_fl" : "");
          const vals = da.outcome[key] || da.outcome[base] || da.outcome.molecules;
          const uniqIdx = (da.outcome.values || []).indexOf("unique");
          if (uniqIdx < 0) return null;
          const sum = vals.reduce(function (x, y) { return x + y; }, 0);
          const cols = [IV.pal.familyColor("resolved"),
                        IV.pal.familyColor("ambiguous"),
                        IV.pal.familyColor("none")];
          return {
            label: "Matched to one " + mode.featureWord,
            value: F.pctOf(vals[uniqIdx], sum),
            sub: F.compact(vals[uniqIdx]) + " " + S.weightLabel(),
            help: F.pretty(S.weightLabel()) + " compatible with exactly one "
              + mode.featureWord + ", and therefore the population discovery "
              + "quantification counts - at gene-model level too, which counts "
              + "the same molecules.",
            meter: (da.outcome.values || []).map(function (v, i) {
              const lab = ((da.outcome.labels || [])[i] || F.pretty(v))
                .replace("Attached to", "Matched to")
                .replace("Not attached to any", "Matched to no")
                .replace("Compatible with several", "Matched to several");
              return { label: lab,
                       value: vals[i], color: cols[i] || IV.dom.token("--gm-400") };
            }),
          };
        }
        return {
          label: "Resolved to one transcript variant",
          value: F.pctOf(famTotals.resolved, famSum),
          sub: F.compact(famTotals.resolved) + " " + S.weightLabel(),
          help: F.pretty(S.weightLabel()) + " matching a single transcript "
            + "variant.",
          meter: IV.pal.FAMILY_ORDER.map(function (k) {
            return { label: IV.pal.FAMILY_LABEL[k], value: famTotals[k],
                     color: IV.pal.familyColor(k) };
          }),
        };
      })(),
    ].filter(Boolean);

    const feat = [];

    const strung = d.floor > 0;
    if (mode.key === "ref") {
      const ref = core.universe.ref;
      feat.push({
        mark: strung,
        label: "Genes quantified", value: F.int(genesQuant),
        sub: "of " + F.compact(ref.annotated_genes) + " genes in the reference",
        help: "Genes with a non-zero value in at least one selected sample.",
      });
      feat.push({
        mark: strung,
        label: F.pretty(mode.featureWordPlural) + " quantified",
        value: F.int(txDet),
        sub: "of " + F.compact(ref.annotated_transcripts)
          + " " + mode.featureWordPlural + " in the reference"
          + (txGenes != null
            ? " · across " + F.int(txGenes) + " genes"
            : " · " + F.pctOf(txDet, ref.annotated_transcripts, 1)),
        help: "Transcript variants with a non-zero value in at least one "
          + "selected sample.",
      });
      feat.push({
        mark: strung,
        label: F.pretty(mode.geneWordPlural) + " with several "
          + mode.variantWordPlural, value: F.int(multiDet),
        sub: "of " + F.compact(ref.multi_transcript_genes)
          + " genes with several " + mode.featureWordPlural
          + " in the reference",
        help: F.pretty(mode.geneWordPlural) + " carrying more than one "
          + "detected " + mode.variantWord + ".",
      });
    } else {
      const disc = core.universe.disc;
      const cls = disc.classes || {};
      feat.push({
        mark: strung,
        label: "Gene models quantified", value: F.int(genesQuant),
        sub: "of " + F.compact(disc.model_genes) + " gene models built",
        help: "Gene models with a non-zero value in at least one selected sample.",
      });
      (function () {
         const gn = u.genes.has("novel") ? u.genes.col("novel") : null;
         if (!gn) return;
         let n = 0;
         for (let r = 0; r < d.geneRows.length; r++) if (gn[d.geneRows[r]]) n++;
         feat.push({
           mark: strung,
           label: "Novel gene models", value: F.int(n),
           sub: F.pctOf(n, d.geneRows.length, 0) + " of the "
             + F.compact(d.geneRows.length, 2) + " in scope",
           help: "Gene models with no counterpart in the annotation, among those "
             + "the stringency floor keeps. The rest correspond to an annotated "
             + "gene.",
         });
      })();
      feat.push({
        mark: strung,
        label: "Transcript models quantified", value: F.int(txDet),
        sub: "of " + F.compact(disc.models) + " transcript models built",
        help: "Transcript models with a non-zero value in at least one selected "
          + "sample. A model can be built and still count nothing, when every "
          + "molecule supporting it is also compatible with another model.",
      });
      const txCls = t.has("class") ? t.col("class") : null;
      const nicN = { nic: 0, nnic: 0 };
      if (txCls) {
        for (let r = 0; r < d.txRows.length; r++) {
          const v = IV.blocks.cell(txCls, d.txRows[r]);
          if (v === "nic" || v === "nnic") nicN[v]++;
        }
      }
      const nicCount = txCls ? nicN.nic : (cls.nic || 0);
      const nnicCount = txCls ? nicN.nnic : (cls.nnic || 0);
      feat.push({
        mark: strung,
        label: "Novel transcript models",
        value: F.int(nicCount + nnicCount),
        sub: F.pctOf(nicCount + nnicCount, d.txRows.length, 0) + " of the "
          + F.compact(d.txRows.length, 2) + " in scope · "
          + F.int(nicCount) + " NIC · " + F.int(nnicCount) + " NNIC",
        help: "Transcript models IsoQuant did not match to the annotation. The "
          + "rest of the models built are annotation matches.",
        meter: [
          { label: "Known", value: cls.known || 0, color: IV.pal.novelColor("known") },
          { label: "NIC", value: cls.nic || 0, color: IV.pal.novelColor("nic") },
          { label: "NNIC", value: cls.nnic || 0, color: IV.pal.novelColor("nnic") },
        ],
      });
      feat.push({
        mark: strung,
        label: F.pretty(mode.geneWordPlural) + " with several "
          + mode.variantWordPlural, value: F.int(multiDet),
        sub: F.pctOf(multiDet, disc.model_genes || genesQuant, 0) + " of "
          + F.compact(disc.model_genes || genesQuant, 2) + " gene models built",
        help: "Gene models carrying more than one transcript model, counted over "
          + "the models the stringency floor keeps and shown against every gene "
          + "model the run built.",
      });
    }

    if (d.floor > 0) {
      let below = 0;
      for (let i = 0; i < g.n; i++) if (d.total[i] > 0 && !d.keep[i]) below++;
      feat.push({
        mark: true,
        label: "Below stringency", value: F.int(below),
        sub: "of " + F.compact(below + genesQuant) + " quantified "
          + mode.geneWordPlural + " · " + F.pctOf(below, below + genesQuant, 0)
          + " excluded",
        help: "Quantified " + mode.geneWordPlural
          + " the stringency floor excludes.",
      });
    }
    U.tileGroups(box, [
      { label: "Overall", items: items },
      { label: F.pretty(mode.geneWordPlural) + " and "
          + mode.featureWordPlural + " quantified", items: feat },
    ]);
    return box;
  }

  function cMean(frame, i) { return IV.stateApi.meanCounts(frame, i); }
  function tMean(frame, i) { return IV.stateApi.meanTpm(frame, i); }

  function biotypeCard(core, mode, u, d) {
    const S = IV.stateApi;
    const isRef = mode.key === "ref";
    const c = U.card("Biotype composition", {
      note: isRef
        ? "Biotypes of what this library detected, at gene or transcript level. " +
          "Hover a bar for its detection rate against the annotation."
        : "Biotypes carried on the gene models. Novel loci have no annotated " +
          "biotype, so they group under <em>novel</em>.",
    });

    const holder = el("div");
    const tableHost = el("div");

    function draw() {
      clear(holder);
      clear(tableHost);
      const level = pv.biotype.level;
      let counts = {}, totalLabel, denom = null;

      if (level === "gene") {
        const bio = u.genes.col("biotype");
        for (let r = 0; r < d.geneRows.length; r++) {
          const i = d.geneRows[r];
          if (!d.nDetected[i]) continue;
          const b = IV.blocks.cell(bio, i);
          counts[b] = (counts[b] || 0) + 1;
        }
        totalLabel = "Detected " + mode.geneWordPlural;
        denom = isRef ? core.universe.ref.biotypes_gene : null;
      } else {
        const t = u.tx;
        const bio = t.has("biotype") ? t.col("biotype")
          : (t.has("class") ? t.col("class") : null);
        if (!bio) {
          holder.appendChild(el("div", { class: "empty",
            text: "No biotype column at transcript level in this mode." }));
          return;
        }
        for (let r = 0; r < d.txRows.length; r++) {
          const i = d.txRows[r];
          const b = IV.blocks.cell(bio, i);
          counts[b] = (counts[b] || 0) + 1;
        }
        totalLabel = "Detected " + mode.featureWordPlural;
        denom = isRef ? core.universe.ref.biotypes_transcript : null;
      }

      const keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      const total = keys.reduce(function (s, k) { return s + counts[k]; }, 0);
      const top = keys.slice(0, 12);

      IV.chart.stackBar(holder, top.map(function (b, i) {
        return {
          label: F.prettyBiotype(b), value: counts[b],
          color: IV.pal.rampSeries(i, top.length),
          help: denom && denom[b]
            ? F.int(denom[b]) + " in the annotation · "
              + F.pctOf(counts[b], denom[b], 1) + " detected"
            : null,
        };
      }), { height: 34, valueLabel: totalLabel });

      const hdr = ["Biotype", totalLabel, "Share"];
      if (denom) hdr.push("In annotation", "Detection rate");
      tableHost.appendChild(U.tableBehind(hdr, keys.map(function (b) {
        const row = [F.prettyBiotype(b), F.int(counts[b]), F.pctOf(counts[b], total, 1)];
        if (denom) {
          row.push(denom[b] != null ? F.int(denom[b]) : "–",
                   denom[b] ? F.pctOf(counts[b], denom[b], 1) : "–");
        }
        return row;
      })));
    }

    const groups = [{
      label: "Level", value: pv.biotype.level,
      options: [{ label: "Gene", value: "gene" },
                { label: F.pretty(mode.featureWord), value: "tx" }],
      onChange: function (v) { pv.biotype.level = v; draw(); },
    }];
    P.controls(c, { groups: groups });
    c.appendChild(holder);
    c.appendChild(tableHost);
    draw();
    return c;
  }

  function plotsSection(core, mode, u, d) {
    const wrap = el("div", { class: "plots-2col" });
    const left = el("div", { class: "op-col" });
    left.appendChild(supportCard(core, mode, u, d));
    left.appendChild(variantsCard(core, mode, u, d));
    if (IV.stateApi.nActive() >= 2) left.appendChild(cvCard(core, mode, u, d));
    const right = el("div", { class: "op-col" });
    right.appendChild(entropyCard(core, mode, u, d));
    if (IV.stateApi.nActive() >= 2) right.appendChild(jsdCard(core, mode, u, d));
    right.appendChild(completenessCard(core, mode, u, d));
    wrap.appendChild(left);
    wrap.appendChild(right);
    return wrap;
  }

  function viewHint(view, barText, word) {
    return "<em>" + (view === "dot"
      ? "Each point is one " + word + ", ranked high to low - hover for its "
        + "numbers, click to open it."
      : barText) + "</em>";
  }

  function molSub(n) {
    return F.int(n) + (n === 1 ? " molecule" : " molecules");
  }

  const DIST_H = 300;
  const SCATTER_H = 372;
  const COMPLETE_H = 240;

  function supportCard(core, mode, u, d) {
    const NOTE = "How many molecules quantification counted for each feature.";
    const c = U.card("Support per feature", { class: "dist-card", note: NOTE });
    const holder = el("div", { class: "chart" });

    function draw() {
      clear(holder);
      drawInner();
    }
    function drawInner() {
      const level = pv.support.level;
      writeFoot(level);
      const frame = level === "gene" ? u.genes : u.tx;
      const rows = level === "gene" ? d.geneRows : d.txRows;
      const mol = frame.col("mol"), molFl = frame.col("mol_fl");
      const names = frame.col("name"), ids = frame.col("id");
      const gi = level === "gene" ? null : u.tx.col("gene_idx");
      const gNames = u.genes.col("name");
      const nAnn = u.genes.has("n_annotated") ? u.genes.col("n_annotated") : null;
      const nS = IV.stateApi.nActive();
      const items = [];
      for (let r = 0; r < rows.length; r++) {
        const i = rows[r];
        if (!mol[i]) continue;
        const basisVal = Math.round(
          level === "gene" ? d.total[i] : (frame.col("count")[i] || 0));
        if (!(basisVal > 0)) continue;
        items.push({
          v: basisVal, label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
          sub: molSub(basisVal),
          gene: level === "gene" ? i : gi[i],
          molCounted: basisVal,
          molFl: molFl[i], molTotal: mol[i],
          meanMol: nS ? cMean(frame, i) : null,
          meanTpm: nS ? tMean(frame, i) : null,
          nVarDet: level === "gene" ? d.nVarDet[i] : null,
          nAnnotated: (level === "gene" && nAnn) ? nAnn[i] : null,
          gene_: level === "gene" ? null : IV.blocks.cell(gNames, gi[i]),
        });
      }
      const word = level === "gene" ? mode.geneWordPlural : mode.featureWordPlural;
      const one = level === "gene" ? mode.geneWord : mode.featureWord;
      U.setNote(c, NOTE + " " + viewHint(pv.support.view,
        "Hover a bar for the best-supported " + word + " inside it.", one));
      if (pv.support.view === "dot") {
        P.rankedDots(holder, items, {
          height: DIST_H,
          logY: true, eps: 1,
          yTitle: "Counted molecules", valueLabel: "Counted molecules",
          valueInRows: true,
          fmtV: function (v) { return F.int(v); },
          color: IV.dom.token("--brand"),
          onPick: function (it) { IV.app.openGene(it.gene); },
        });
      } else {
        P.binnedBar(holder, items, {
          height: DIST_H,
          binning: { kind: "log10", step: 0.15, eps: 1 },
          xTitle: "Counted molecules per " + one,
          yTitle: F.pretty(word), color: IV.dom.token("--brand"),
          binLabel: "Counted molecules", topLabel: "Best supported here",
          topUnit: "total counted molecules",
          onPickBin: function (tops) { if (tops.length) IV.app.openGene(tops[0].gene); },
        });
      }
    }

    function writeFoot(level) {
      const frame = level === "gene" ? u.genes : u.tx;
      const rows = level === "gene" ? d.geneRows : d.txRows;
      const mol = frame.col("mol"), molFl = frame.col("mol_fl");
      const cnt = level === "gene" ? null
        : (frame.has("count") ? frame.col("count") : null);
      let sMol = 0, sFl = 0, sCnt = 0, nFeat = 0;
      for (let r = 0; r < rows.length; r++) {
        const i = rows[r];
        if (!mol[i]) continue;
        nFeat++; sMol += mol[i]; sFl += molFl[i];
        sCnt += level === "gene" ? (d.total[i] || 0) : (cnt ? (cnt[i] || 0) : 0);
      }
      const word = level === "gene" ? mode.geneWordPlural : mode.featureWordPlural;
      foot.innerHTML = "Across the <strong>" + F.int(nFeat) + "</strong> "
        + F.escapeHtml(word) + " plotted, <strong>" + F.compact(sMol, 2)
        + "</strong> molecules were detected - of which <strong>"
        + F.compact(sFl, 2) + "</strong> are full-length ("
        + F.pctOf(sFl, sMol, 1) + ") and <strong>"
        + F.compact(Math.round(sCnt), 2) + "</strong> were counted toward a "
        + F.escapeHtml(level === "gene" ? mode.geneWord : mode.featureWord)
        + " (" + F.pctOf(sCnt, sMol, 1) + ").";
    }

    P.controls(c, {
      groups: [{
        label: "Level", value: pv.support.level,
        options: [{ label: F.pretty(mode.geneWord), value: "gene" },
                  { label: F.pretty(mode.featureWord), value: "tx" }],
        onChange: function (v) { pv.support.level = v; draw(); },
      }],
      view: { value: pv.support.view,
        onChange: function (v) { pv.support.view = v; draw(); } },
    });
    c.appendChild(holder);
    const foot = el("p", { class: "note small" });
    c.appendChild(foot);
    draw();
    return c;
  }

  function variantsCard(core, mode, u, d) {
    const NOTE = "How many " + mode.variantWordPlural + " each "
      + mode.geneWord + " contributes.";
    const c = U.card(F.pretty(mode.variantWordPlural) + " per " + mode.geneWord,
      { class: "dist-card", note: NOTE });
    const holder = el("div", { class: "chart" });
    const info = el("p", { class: "note small" });

    function draw() {
      clear(holder);
      const names = u.genes.col("name"), ids = u.genes.col("id");
      const nAnn = u.genes.has("n_annotated") ? u.genes.col("n_annotated") : null;
      const gMol = u.genes.col("mol"), gMolFl = u.genes.col("mol_fl");
      const nS = IV.stateApi.nActive();

      const items = [];
      let sum = 0, nMulti = 0;
      for (let r = 0; r < d.geneRows.length; r++) {
        const i = d.geneRows[r];
        const n = d.nVarDet[i];
        sum += n;
        if (n > 1) nMulti++;
        const counted = Math.round(d.total[i]);
        items.push({
          v: n, rank: counted,
          label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
          gene: i,
          sub: molSub(counted),
          molTotal: gMol ? gMol[i] : null,
          molFl: gMolFl ? gMolFl[i] : null, molCounted: counted,
          meanMol: nS ? cMean(u.genes, i) : null,
          meanTpm: nS ? tMean(u.genes, i) : null,
          nAnnotated: nAnn ? nAnn[i] : null,
          nVarDet: n,
        });
      }
      U.setNote(c, NOTE + " " + viewHint(pv.variants.view,
        "Hover a bar for the most-expressed " + mode.geneWordPlural
          + " with that many " + mode.variantWordPlural + ".", mode.geneWord));
      if (pv.variants.view === "dot") {
        P.rankedDots(holder, items, {
          height: DIST_H,
          yTitle: "Detected " + mode.variantWordPlural,
        valueLabel: "Detected " + mode.variantWordPlural,
          valueInRows: true,
          fmtV: function (v) { return F.int(v); },
          color: IV.dom.token("--brand"),
          onPick: function (it) { IV.app.openGene(it.gene); },
        });
      } else {
        P.binnedBar(holder, items, {
          height: DIST_H,
          binning: { kind: "int", min: 0 },
          xTitle: "Detected transcript variants per " + mode.geneWord,
          yTitle: F.pretty(mode.geneWordPlural), color: IV.dom.token("--brand"),
          topLabel: "Most expressed here",
          topUnit: "total counted molecules",
          onPickBin: function (tops) { if (tops.length) IV.app.openGene(tops[0].gene); },
        });
      }
      info.innerHTML = "Mean <strong>" + F.dec(items.length ? sum / items.length : 0, 2)
        + "</strong> detected " + F.escapeHtml(mode.variantWordPlural)
        + " per " + F.escapeHtml(mode.geneWord)
        + " · <strong>" + F.int(nMulti) + "</strong> with more than one";
    }

    P.controls(c, {
      view: { value: pv.variants.view,
              onChange: function (v) { pv.variants.view = v; draw(); } },
    });
    c.appendChild(holder);
    c.appendChild(info);
    draw();
    return c;
  }

  function valueCard(core, mode, u, d) {
    const S = IV.stateApi;
    const NOTE = "Mean " + S.valueLabel() + " across samples, log scale. " +
      (IV.state.valueMode === "counts"
        ? "Counts are molecules and are not depth-normalised, so read them " +
          "within a run."
        : "TPM is normalised within each sample, so samples are comparable.");
    const c = U.card(S.meanValuePhrase(true), { note: NOTE });
    const holder = el("div", { class: "chart" });

    function draw() {
      clear(holder);
      const isGene = pv.value.level === "gene";
      const frame = isGene ? u.genes : u.tx;
      const rows = isGene ? d.geneRows : d.txRows;
      const names = frame.col("name"), ids = frame.col("id");
      const gi = isGene ? null : u.tx.col("gene_idx");
      const gNames = u.genes.col("name");
      const items = [];
      for (let r = 0; r < rows.length; r++) {
        const i = rows[r];
        const v = isGene ? d.value[i] : S.txValue(u.tx, i);
        if (!(v > 0)) continue;
        items.push({
          v: v, label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
          sub: S.fmtValue(v),
          gene: isGene ? i : gi[i],
          gene_: isGene ? null : IV.blocks.cell(gNames, gi[i]),
        });
      }
      const word = isGene ? mode.geneWordPlural : mode.featureWordPlural;
      const one = isGene ? mode.geneWord : mode.featureWord;
      U.setNote(c, NOTE + " " + viewHint(pv.value.view,
        "Hover a bar for the most-expressed " + word + " inside it.", one));
      const color = IV.dom.token("--brand");
      if (pv.value.view === "dot") {
        P.rankedDots(holder, items, {
          logY: true, eps: 0.01, yTitle: S.meanValueShort(),
          valueLabel: S.meanValueShort(), color: color,
          onPick: function (it) { IV.app.openGene(it.gene); },
        });
      } else {
        P.binnedBar(holder, items, {
          binning: { kind: "log10", step: 0.1, eps: 0.01 },
          xTitle: S.meanValuePhrase(true), yTitle: F.pretty(word), color: color,
          binLabel: S.valueLabelCap(), topLabel: "Most expressed here",
          onPickBin: function (tops) { if (tops.length) IV.app.openGene(tops[0].gene); },
        });
      }
    }

    P.controls(c, {
      groups: [{
        label: "Level", value: pv.value.level, accent: pv.value.level === "tx",
        options: [{ label: F.pretty(mode.geneWord), value: "gene" },
                  { label: F.pretty(mode.featureWord), value: "tx" }],
        onChange: function (v) { pv.value.level = v; draw(); },
      }],
      view: { value: pv.value.view,
        onChange: function (v) { pv.value.view = v; draw(); } },
    });
    c.appendChild(holder);
    draw();
    return c;
  }

  function cvCard(core, mode, u, d) {
    const S = IV.stateApi;
    const nS = IV.stateApi.nActive();
    const NOTE = "Coefficient of variation of TPM across samples.";
    const c = U.card("Expression variability across samples", { class: "dist-card",
      note: nS < 2 ? "Needs at least two samples." : NOTE });
    if (nS < 2) return c;
    if (!u.genes.has("tpm") && !u.tx.has("tpm")) {
      c.appendChild(el("div", { class: "empty", text: "No TPM values in this mode." }));
      return c;
    }
    const holder = el("div", { class: "chart" });
    const info = el("div", { class: "control-hint" });

    function draw() {
      clear(holder);
      const isGene = pv.cv.level === "gene";
      const items = [];
      if (isGene && !u.genes.has("tpm")) {
        holder.appendChild(el("div", { class: "empty", text: "No gene-level TPM in this mode." }));
        return;
      }
      if (!isGene && !u.tx.has("tpm")) {
        holder.appendChild(el("div", { class: "empty",
          text: "No " + mode.featureWord + "-level TPM in this mode." }));
        return;
      }
      if (isGene) {
        const g = u.genes;
        const names = g.col("name"), ids = g.col("id");
        const gm = g.col("tpm"), mol = g.col("mol"), molFl = g.col("mol_fl");
        const nAnn = g.has("n_annotated") ? g.col("n_annotated") : null;
        const actC = IV.stateApi.activeIdx();
        for (let r = 0; r < d.geneRows.length; r++) {
          const i = d.geneRows[r];
          let sum = 0;
          for (let s = 0; s < nS; s++) sum += gm.get(i, actC[s]);
          const mu = sum / nS;
          if (!(mu > 0)) continue;
          let acc = 0;
          for (let s = 0; s < nS; s++) {
            const dd = gm.get(i, actC[s]) - mu;
            acc += dd * dd;
          }
          const cv = Math.sqrt(acc / nS) / mu;
          if (!isFinite(cv)) continue;
          items.push({ v: cv, rank: mu,
            dim: (d.total[i] || 0) < cvFloor(),
            label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
            sub: F.dec(mu, 2) + " TPM", gene: i,
            molTotal: mol ? mol[i] : null, molFl: molFl ? molFl[i] : null,
            molCounted: Math.round(d.total[i] || 0),
            meanMol: nS ? cMean(g, i) : null, meanTpm: mu,
            nAnnotated: nAnn ? nAnn[i] : null, nVarDet: d.nVarDet[i] });
        }
      } else {
        const t = u.tx;
        const names = t.col("name"), ids = t.col("id"), gi = t.col("gene_idx");
        const gNames = u.genes.col("name");
        const vm = t.col("tpm");
        const mol = t.has("mol") ? t.col("mol") : null;
        const molFl = t.has("mol_fl") ? t.col("mol_fl") : null;
        const actC = IV.stateApi.activeIdx();
        for (let r = 0; r < d.txRows.length; r++) {
          const i = d.txRows[r];
          let sum = 0;
          for (let s = 0; s < nS; s++) sum += vm.get(i, actC[s]);
          const mu = sum / nS;
          if (!(mu > 0)) continue;
          let acc = 0;
          for (let s = 0; s < nS; s++) {
            const dd = vm.get(i, actC[s]) - mu;
            acc += dd * dd;
          }
          const tCounted = t.has("count") ? (t.col("count")[i] || 0) : 0;
          items.push({ v: Math.sqrt(acc / nS) / mu, rank: mu,
            dim: tCounted < cvFloor(),
            label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
            sub: F.dec(mu, 2) + " TPM", gene: gi[i],
            molTotal: mol ? mol[i] : null, molFl: molFl ? molFl[i] : null,
            molCounted: Math.round(tCounted),
            meanMol: nS ? cMean(t, i) : null, meanTpm: mu,
            gene_: IV.blocks.cell(gNames, gi[i]) });
        }
      }
      const word = isGene ? mode.geneWordPlural : mode.featureWordPlural;
      const color = IV.dom.token("--brand");
      const nDim = items.filter(function (x) { return x.dim; }).length;
      const ceil = "With <strong>" + F.int(nS) + "</strong> samples the largest "
        + "possible CV is <strong>" + Math.sqrt(nS - 1).toFixed(2) + "</strong>, "
        + "reached by a feature seen in one sample only.";
      info.innerHTML = (nDim
        ? "<strong>" + F.int(nDim) + "</strong> of " + F.int(items.length)
          + " have fewer than " + F.int(cvFloor()) + " molecules, "
          + "shown faint: below that the CV is mostly whether the feature was seen "
          + "at all in each sample, which is what produces the plateau."
        : "All " + F.int(items.length) + " features are above the floor.")
        + " " + ceil;
      U.setNote(c, NOTE + " " + viewHint(pv.cv.view,
        "Hover a bar for the most-expressed " + word + " inside it.",
        isGene ? mode.geneWord : mode.featureWord));
      if (pv.cv.view === "dot") {
        P.rankedDots(holder, items, {
          height: DIST_H,
          yTitle: "Coefficient of variation", valueLabel: "CV", color: color,
          metricLast: true,
          colorOf: function (it) {
            return it.dim ? IV.dom.token("--gm-300") : color;
          },
          dimOf: function (it) { return !!it.dim; },
          onPick: function (it) { IV.app.openGene(it.gene); },
        });
      } else {
        P.binnedBar(holder, items.filter(function (x) { return !x.dim; }), {
          height: DIST_H,
          binning: { kind: "linear", step: 0.03, lo: 0, hi: 3 },
          xTitle: "Coefficient of variation", yTitle: F.pretty(word), color: color,
          binLabel: "CV", topLabel: "Most expressed here",
          topUnit: "mean TPM per sample",
          onPickBin: function (tops) { if (tops.length) IV.app.openGene(tops[0].gene); },
        });
      }
    }

    const ctrlHost = el("div");
    c.appendChild(ctrlHost);
    P.controls(ctrlHost, {
      groups: [{
        label: "Level", value: pv.cv.level, accent: pv.cv.level === "tx",
        options: [{ label: F.pretty(mode.geneWord), value: "gene" },
                  { label: F.pretty(mode.featureWord), value: "tx" }],
        onChange: function (v) { pv.cv.level = v; draw(); },
      }],
      view: { value: pv.cv.view,
        onChange: function (v) { pv.cv.view = v; draw(); } },
    });

    const slider = el("input", { type: "range", min: 0, max: 100, step: 1,
      value: Math.min(cvFloor(), 100), style: { width: "150px" } });
    const num = el("input", { type: "number", min: 0, max: 100000, step: 1,
      value: cvFloor(), style: { width: "80px" } });
    function setFloor(v) {
      const nv = Math.max(0, isFinite(v) ? v : 0);
      pv.cv.minCounted = nv;
      slider.value = Math.min(nv, 100);
      num.value = nv;
      draw();
    }
    slider.addEventListener("input", function () { setFloor(+slider.value); });
    num.addEventListener("change", function () { setFloor(+num.value); });
    const row = el("div", { class: "control-row" });
    row.appendChild(U.control("Ignore below (molecules)",
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        [slider, num])));
    row.appendChild(info);
    c.appendChild(row);

    c.appendChild(holder);
    draw();
    return c;
  }

  function completenessCard(core, mode, u, d) {
    const c = U.card("Full-length molecules against " + mode.variantWord
      + " count", {
      class: "dist-card",
      note: "For each " + mode.geneWord + ", the share of its molecules that "
        + "are <strong>full-length</strong> against the number of "
        + "<strong>detected " + F.escapeHtml(mode.variantWordPlural)
        + "</strong> it carries.",
    });
    const g = u.genes;
    if (!g.has("mol") || !g.has("mol_fl")) {
      c.appendChild(el("div", { class: "empty", text: "No molecule columns in this mode." }));
      return c;
    }
    const mol = g.col("mol"), molFl = g.col("mol_fl");
    const names = g.col("name"), ids = g.col("id");
    const nAnn = g.has("n_annotated") ? g.col("n_annotated") : null;
    const nS = IV.stateApi.nActive();
    const holder = el("div", { class: "chart" });
    const legendHost = el("div");

    function hoverRows(i, share) {
      const rows = P.featureRows({
        molTotal: mol[i], molFl: molFl[i],
        molCounted: Math.round(d.total[i]),
        meanMol: nS ? cMean(g, i) : null,
        meanTpm: nS ? tMean(g, i) : null,
        nAnnotated: nAnn ? nAnn[i] : null,
        nVarDet: d.nVarDet[i],
      });
      rows.push(["Full-length share", F.pct(share, 1)]);
      return rows;
    }

    const pick = [];
    let maxMol = 1;
    for (let r = 0; r < d.geneRows.length; r++) {
      const i = d.geneRows[r];
      if (!(d.nVarDet[i] > 0)) continue;
      pick.push(i);
      if (mol[i] > maxMol) maxMol = mol[i];
    }
    pick.sort(function (a, b) { return mol[a] - mol[b]; });
    const lg = Math.log(Math.max(2, maxMol));
    const xs = [], ys = [], cols = [], hov = [], rows = [];
    for (const i of pick) {
      const share = mol[i] ? molFl[i] / mol[i] : 0;
      xs.push(d.nVarDet[i]);
      ys.push(share);
      rows.push(i);
      cols.push(IV.pal.sequential(lg > 0 ? Math.log(Math.max(1, mol[i])) / lg : 0));
      hov.push(IV.px && IV.px.available()
        ? IV.px.rowsToHover(IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
            hoverRows(i, share))
        : "");
    }
    if (!xs.length) {
      c.appendChild(el("div", { class: "empty",
        text: "No " + mode.geneWordPlural + " with a detected "
          + mode.variantWord + "." }));
      return c;
    }
    let drew = false;
    if (IV.px && IV.px.available()) {
      drew = IV.px.points(holder, { x: xs, y: ys, hover: hov, color: cols }, {
        height: COMPLETE_H,
        xTitle: "Detected " + mode.variantWordPlural,
        yTitle: "Full-length share",
        exportName: "full-length-vs-variants",
        xaxis: { rangemode: "tozero" },
        yaxis: { range: [-0.02, 1.02], tickformat: ".0%" },
        onPick: function (k) { IV.app.openGene(rows[k]); },
      });
    }
    if (!drew) {
      IV.chart.scatter(holder, {
        n: xs.length,
        x: function (k) { return xs[k]; },
        y: function (k) { return ys[k]; },
        color: function (k) { return cols[k]; },
        tip: function (k) {
          const i = rows[k];
          return IV.chart.tipHTML(
            IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
            hoverRows(i, ys[k]), cols[k]);
        },
      }, { height: COMPLETE_H, xTitle: "Detected " + mode.variantWordPlural,
           yTitle: "Full-length share", yDomain: [0, 1.02],
           onPick: function (k) { IV.app.openGene(rows[k]); } });
    }
    c.appendChild(holder);
    const midMol = Math.max(2, Math.round(Math.exp(lg / 2)));
    IV.chart.colorBar(legendHost, {
      title: "Detected molecules",
      colorAt: function (t) { return IV.pal.sequential(t); },
      ticks: [{ at: 0, label: "1" },
              { at: lg > 0 ? Math.log(midMol) / lg : 0.5, label: F.compact(midMol, 0) },
              { at: 1, label: F.compact(maxMol, 0) }],
    });
    c.appendChild(legendHost);
    return c;
  }

  function scatterItems(mode, u, d, metricArr) {
    const g = u.genes;
    const names = g.col("name"), ids = g.col("id");
    const mol = g.col("mol"), molFl = g.col("mol_fl");
    const nAnn = g.has("n_annotated") ? g.col("n_annotated") : null;
    const nS = IV.stateApi.nActive();
    const hasTpm = g.has("tpm");
    const items = [];
    for (let r = 0; r < d.geneRows.length; r++) {
      const i = d.geneRows[r];
      if (d.nVarDet[i] < 2) continue;
      const meanTpm = hasTpm ? tMean(g, i) : null;
      const meanMol = nS ? cMean(g, i) : null;
      const xValue = hasTpm ? meanTpm : meanMol;
      if (!(xValue > 0)) continue;
      items.push({
        row: i,
        label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
        id: IV.blocks.cell(ids, i),
        value: xValue,
        valueText: (hasTpm ? F.dec(xValue, 2) + " TPM" : F.mols(xValue, 0)),
        metric: metricArr[i],
        nVar: d.nVarDet[i],
        nAnnotated: nAnn ? nAnn[i] : null,
        mol: mol[i], molFl: molFl[i], molCounted: Math.round(d.total[i]),
        meanMol: meanMol, meanTpm: meanTpm,
      });
    }
    return items;
  }

  function entropyCard(core, mode, u, d) {
    const c = U.card(F.pretty(mode.variantWord) + " entropy", {
      note: "Normalised <strong>Shannon entropy</strong> of "
        + mode.variantWord + " usage. "
        + "<strong>0</strong> = one dominant " + mode.variantWord
        + ", <strong>1</strong> = all "
        + "used evenly.",
    });
    const items = scatterItems(mode, u, d, d.entropy);
    if (!items.length) {
      c.appendChild(el("div", { class: "empty",
        text: "No " + mode.geneWordPlural + " with several "
          + mode.variantWordPlural + " in the current selection" }));
      return c;
    }
    const host = el("div");
    c.appendChild(host);
    P.metricScatter(host, {
      items: items, state: pv.entropy, height: SCATTER_H,
      valueLabel: "Mean TPM per sample",
      xTitle: "Mean TPM per sample",
      metricLabel: "Normalised Shannon entropy",
      geneWord: mode.geneWord,
      geneWordPlural: mode.geneWordPlural,
      onPick: function (it) { IV.app.openGene(it.row); },
    });
    return c;
  }

  function jsdCard(core, mode, u, d) {
    if (IV.stateApi.nActive() < 2) return el("div");
    const c = U.card(F.pretty(mode.variantWord)
        + " usage divergence across samples", {
      note: "<strong>Generalised Jensen-Shannon divergence</strong> of "
        + mode.variantWord + " "
        + "usage across all samples at once. <strong>0</strong> means every "
        + "sample uses this " + mode.geneWord + "'s "
        + mode.variantWordPlural + " in the same "
        + "proportions; <strong>1</strong> means they use different ones "
        + "entirely.",
    });
    const items = scatterItems(mode, u, d, d.jsdMulti || d.jsdMean);
    if (!items.length) {
      c.appendChild(el("div", { class: "empty",
        text: "No " + mode.geneWordPlural + " with several "
          + mode.variantWordPlural + " in the current selection" }));
      return c;
    }
    const host = el("div");
    c.appendChild(host);
    P.metricScatter(host, {
      items: items, state: pv.jsd, height: SCATTER_H,
      valueLabel: "Mean TPM per sample",
      xTitle: "Mean TPM per sample",
      metricLabel: "Divergence across samples (generalised JSD)",
      geneWord: mode.geneWord,
      geneWordPlural: mode.geneWordPlural,
      onPick: function (it) { IV.app.openGene(it.row); },
    });
    return c;
  }

  function tablesSection(core, mode, u, d) {
    const S = IV.stateApi;
    const wrap = el("div");
    const nS = IV.stateApi.nActive();
    const mol = u.genes.col("mol");

    wrap.appendChild(topTable(core, mode, u, d, {
      title: "Most expressed " + mode.geneWordPlural,
      note: "Ranked by " + S.meanValuePhrase() + ".",
      rank: function (i) { return d.value[i]; },
      emphasis: "value",
    }));

    wrap.appendChild(topVariantsTable(core, mode, u, d));

    wrap.appendChild(topTable(core, mode, u, d, {
      title: F.pretty(mode.geneWordPlural) + " with the most even "
        + mode.variantWord + " usage",
      note: "Ranked by normalised <strong>Shannon entropy</strong>. Limited to "
        + mode.geneWordPlural + " averaging at least " + SHORTLIST_MIN_COUNTED
        + " counted molecules per sample, below which the score saturates on too "
        + "little data.",
      filter: function (i) {
        return d.nVarDet[i] > 1
          && cMean(u.genes, i) >= SHORTLIST_MIN_COUNTED;
      },
      rank: function (i) { return d.entropy[i]; },
      emphasis: "entropy",
    }));

    if (nS >= 2) {
      wrap.appendChild(topTable(core, mode, u, d, {
        title: "Strongest " + mode.variantWord + " switching",
        note: "Ranked by mean pairwise <strong>JSD</strong> of "
          + mode.variantWord + " usage "
          + "between samples. Limited to " + mode.geneWordPlural + " averaging at "
          + "least " + SHORTLIST_MIN_COUNTED + " molecules per sample.",
        filter: function (i) {
          if (!(d.nVarDet[i] > 1)) return false;
          if (!(cMean(u.genes, i) >= SHORTLIST_MIN_COUNTED)) return false;
          const need = Math.max(1, Math.ceil((d.nPairs || 1) / 2));
          return (d.jsdPairs ? d.jsdPairs[i] : 1) >= need;
        },
        rank: function (i) { return d.jsdMean[i]; },
        emphasis: "jsd",
        extraCols: [{ label: "Pairs", align: "right",
          render: function (i) {
            return (d.jsdPairs ? d.jsdPairs[i] : "–") + "/" + (d.nPairs || 1);
          } }],
      }));
    }
    return wrap;
  }

  const SHORTLIST_MIN_COUNTED = 50;

  function topTable(core, mode, u, d, spec) {
    const S = IV.stateApi;
    const N = 20;
    const g = u.genes;
    const nS = IV.stateApi.nActive();
    const mol = g.col("mol"), molFl = g.col("mol_fl");
    const rows = [];
    for (let r = 0; r < d.geneRows.length; r++) {
      const i = d.geneRows[r];
      if (spec.filter && !spec.filter(i)) continue;
      if (!(spec.rank(i) > 0)) continue;
      rows.push(i);
    }
    rows.sort(function (a, b) {
      return (spec.rank(b) - spec.rank(a))
        || (cMean(g, b) - cMean(g, a))
        || (d.nVarDet[b] - d.nVarDet[a]);
    });
    const top = rows.slice(0, N);

    const activeIsTpm = S.valueInfo().key === "tpm";

    const c = U.card(spec.title, {
      note: spec.note + " <em>Click a row to open the " + F.escapeHtml(mode.geneWord)
        + ".</em>",
      tools: [el("span", { class: "xsmall faint",
        text: "Top " + Math.min(N, top.length) + " of " + F.int(rows.length) })],
    });
    if (!top.length) {
      c.appendChild(el("div", { class: "empty", text: "Nothing qualifies" }));
      return c;
    }

    const names = g.col("name"), ids = g.col("id"), chr = g.col("chr");
    const bio = g.col("biotype");
    const nAnn = g.has("n_annotated") ? g.col("n_annotated") : null;
    const nNic = g.has("n_nic") ? g.col("n_nic") : null;
    const nNnic = g.has("n_nnic") ? g.col("n_nnic") : null;
    const cross = (core.cross_mode
      || {})[mode.key === "ref" ? "ref_to_disc" : "disc_to_ref"] || {};

    const VAR_COL = "Detected " + mode.variantWordPlural;
    const head = ["#", F.pretty(mode.geneWord), F.pretty(mode.geneWord) + " ID", "Chr",
                  "Mean counted molecules per sample", "Mean TPM per sample",
                  "CV", "Detected in samples", VAR_COL];
    const varSlash = !!(mode.key === "ref" && nAnn);
    if (nNnic) head.push("Novel var.");
    head.push("Entropy");
    if (nS > 1) head.push("Mean JSD");
    for (const xc of spec.extraCols || []) head.push(xc.label);
    const showBio = S.hasBiotypes(u.genes);
    if (showBio) head.push("Biotype");
    head.push("Also in");

    const wrap = el("div", { class: "tbl-wrap" });
    const tbl = el("table", { class: "dt compact" });
    const hr = el("tr");
    const rightAligned = {
      "Mean counted molecules per sample": 1, "Mean TPM per sample": 1, "CV": 1,
      "Detected in samples": 1,
      "Novel var.": 1, "Samples": 1, "Entropy": 1,
      "Mean JSD": 1,
    };
    rightAligned[VAR_COL] = 1;
    for (const xc of spec.extraCols || []) {
      if (xc.align === "right") rightAligned[xc.label] = 1;
    }
    head.forEach(function (h) {
      hr.appendChild(el("th", { class: "no-sort", text: h,
        title: (h === VAR_COL && varSlash)
          ? "Detected / annotated " + mode.variantWordPlural : null,
        style: rightAligned[h] ? { textAlign: "right" } : null }));
    });
    tbl.appendChild(el("thead", {}, hr));

    const tb = el("tbody");
    top.forEach(function (i, rank) {
      const tr = el("tr", { style: { cursor: "pointer" } });
      tr.appendChild(el("td", { class: "faint", text: String(rank + 1) }));
      tr.appendChild(el("td", {}, el("span", { class: "link",
        text: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i) })));
      tr.appendChild(el("td", { class: "id",
        text: F.stripVersion(IV.blocks.cell(ids, i)) }));
      tr.appendChild(el("td", { class: "small muted", text: IV.blocks.cell(chr, i) }));
      tr.appendChild(el("td", { class: "n" + (spec.emphasis === "value" && !activeIsTpm ? " strong" : ""),
        text: F.dec(cMean(g, i), 1) }));
      tr.appendChild(el("td", { class: "n" + (spec.emphasis === "value" && activeIsTpm ? " strong" : ""),
        text: g.has("tpm") ? F.dec(tMean(g, i), 2) : "–" }));
      tr.appendChild(el("td", { class: "n", text: F.dec(d.cv[i], 2) }));
      tr.appendChild(el("td", { class: "n", text: d.nDetected[i] + "/" + nS }));
      tr.appendChild(el("td", { class: "n",
        title: varSlash
          ? "Detected / annotated " + mode.variantWordPlural : null,
        html: varSlash
          ? F.int(d.nVarDet[i]) + '<span class="faint">/' + F.int(nAnn[i]) + "</span>"
          : F.int(d.nVarDet[i]) }));
      if (nNnic) {
        const nic = nNic ? nNic[i] : 0, nnic = nNnic[i];
        tr.appendChild(el("td", { class: "n" }, !nic && !nnic
          ? el("span", { class: "faint", text: "–" })
          : el("span", { class: "small", html:
              (nic ? '<span class="pill pill-nic">' + nic + " NIC</span> " : "")
              + (nnic ? '<span class="pill pill-nnic">' + nnic + " NNIC</span>" : "") })));
      }
      tr.appendChild(el("td", { class: "n" + (spec.emphasis === "entropy" ? " strong" : ""),
        text: d.nVarDet[i] > 1 ? F.dec(d.entropy[i], 3) : "–" }));
      if (nS > 1) {
        tr.appendChild(el("td", { class: "n" + (spec.emphasis === "jsd" ? " strong" : ""),
          text: d.nVarDet[i] > 1 ? F.dec(d.jsdMean[i], 3) : "–" }));
      }
      for (const xc of spec.extraCols || []) {
        tr.appendChild(el("td", { class: xc.align === "right" ? "n" : "small muted",
          text: String(xc.render(i)) }));
      }
      if (showBio) {
        tr.appendChild(el("td", { class: "small muted",
          text: F.prettyBiotype(IV.blocks.cell(bio, i)) }));
      }
      tr.appendChild(el("td", {}, crossCell(cross, i, mode)));
      tr.addEventListener("click", function (ev) {
        if (ev.target.closest && ev.target.closest(".no-row-click")) return;
        IV.app.openGene(i);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    c.appendChild(wrap);
    if (nNnic) {
      c.appendChild(IV.chart.legend([
        { label: "NIC · known splice sites, new combination",
          color: IV.pal.novelColor("nic") },
        { label: "NNIC · at least one new splice site",
          color: IV.pal.novelColor("nnic") },
      ]));
    }
    return c;
  }

  function topVariantsTable(core, mode, u, d) {
    const S = IV.stateApi;
    const N = 20;
    const t = u.tx, g = u.genes;
    const nS = IV.stateApi.nActive();
    const share = t.has("share") ? t.col("share") : null;
    const nDet = t.has("n_detected") ? t.col("n_detected") : null;
    const names = t.col("name"), ids = t.col("id"), gi = t.col("gene_idx");
    const gNames = g.col("name"), gIds = g.col("id");
    const bio = t.has("biotype") ? t.col("biotype") : (t.has("class") ? t.col("class") : null);
    const txShowBio = bio && (t.has("class") || S.hasBiotypes(t));
    const activeIsTpm = S.valueInfo().key === "tpm";

    const rows = [];
    for (let r = 0; r < d.txRows.length; r++) {
      const i = d.txRows[r];
      if (!(S.txValue(t, i) > 0)) continue;
      rows.push(i);
    }
    rows.sort(function (a, b) { return S.txValue(t, b) - S.txValue(t, a); });
    const top = rows.slice(0, N);

    const c = U.card("Most expressed " + mode.featureWordPlural, {
      note: "Ranked by " + S.meanValuePhrase()
        + ". <em>Click a row to open its " + mode.geneWord + ".</em>",
      tools: [el("span", { class: "xsmall faint",
        text: "Top " + Math.min(N, top.length) + " of " + F.int(rows.length) })],
    });
    if (!top.length) {
      c.appendChild(el("div", { class: "empty", text: "Nothing qualifies" }));
      return c;
    }

    const gChr = g.has("chr") ? g.col("chr") : null;
    const head = ["#", F.pretty(mode.featureWord),
                  F.pretty(mode.featureWord) + " ID", F.pretty(mode.geneWord)]
      .concat(gChr ? ["Chr"] : [])
      .concat(["Mean counted molecules per sample", "Mean TPM per sample",
               "CV", "Detected in samples", "Share of gene"])
      .concat(txShowBio ? ["Biotype"] : []);
    const rightAligned = {
      "Mean counted molecules per sample": 1, "Mean TPM per sample": 1,
      "CV": 1, "Detected in samples": 1, "Share of gene": 1 };

    const wrap = el("div", { class: "tbl-wrap" });
    const tbl = el("table", { class: "dt compact" });
    const hr = el("tr");
    head.forEach(function (h) {
      hr.appendChild(el("th", { class: "no-sort", text: h,
        style: rightAligned[h] ? { textAlign: "right" } : null }));
    });
    tbl.appendChild(el("thead", {}, hr));

    const tb = el("tbody");
    top.forEach(function (i, rank) {
      const tr = el("tr", { style: { cursor: "pointer" } });
      const gRow = gi[i];
      tr.appendChild(el("td", { class: "faint", text: String(rank + 1) }));
      tr.appendChild(el("td", {}, el("span", { class: "link",
        text: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i) })));
      tr.appendChild(el("td", { class: "id",
        text: F.stripVersion(IV.blocks.cell(ids, i)) }));
      tr.appendChild(el("td", { class: "small muted",
        text: IV.blocks.cell(gNames, gRow) || IV.blocks.cell(gIds, gRow) }));
      if (gChr) {
        tr.appendChild(el("td", { class: "small muted",
          text: IV.blocks.cell(gChr, gRow) }));
      }
      tr.appendChild(el("td", { class: "n" + (!activeIsTpm ? " strong" : ""),
        text: F.dec(cMean(t, i), 1) }));
      tr.appendChild(el("td", { class: "n" + (activeIsTpm ? " strong" : ""),
        text: t.has("tpm") ? F.dec(tMean(t, i), 2) : "–" }));
      tr.appendChild(el("td", { class: "n",
        text: t.has("tpm") ? F.dec(txCvTpm(t, i, nS), 2) : "–" }));
      tr.appendChild(el("td", { class: "n",
        text: nDet ? (nDet[i] + " / " + nS) : "–" }));
      tr.appendChild(el("td", { class: "n",
        text: share && share[i] > 0 ? F.pct(share[i], 0) : "–" }));
      if (txShowBio) {
        tr.appendChild(el("td", { class: "small muted",
          text: F.prettyBiotype(IV.blocks.cell(bio, i)) }));
      }
      tr.addEventListener("click", function () { IV.app.openGene(gRow); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    c.appendChild(wrap);
    return c;
  }

  function txCvTpm(t, i, nS) {
    const vm = t.col("tpm");
    const act = IV.stateApi.activeIdx();
    let sum = 0;
    for (let s = 0; s < nS; s++) sum += vm.get(i, act[s]);
    const mu = nS ? sum / nS : 0;
    if (!(mu > 0)) return NaN;
    let acc = 0;
    for (let s = 0; s < nS; s++) {
      const dd = vm.get(i, act[s]) - mu;
      acc += dd * dd;
    }
    return Math.sqrt(acc / nS) / mu;
  }

  function crossCell(cross, i, mode) {
    const j = cross[String(i)];
    const other = mode.key === "ref" ? "disc" : "ref";
    const info = IV.stateApi.MODES[other];
    if (j == null) {
      return el("span", { class: "faint xsmall", text: "–",
        title: "No matching locus in " + info.long });
    }
    const b = el("span", { class: "link xsmall no-row-click", text: info.label + " →",
      title: "Open this locus in " + info.long });
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      IV.app.openGene(j, { mode: other });
    });
    return b;
  }

  IV.views = IV.views || {};
  IV.views.overview = { render: render, title: "" };
})(window.IV);
