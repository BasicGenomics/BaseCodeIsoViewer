(function (IV) {
  "use strict";

  const { el, clear, svgEl } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;

  const TRACK_W = 620;

  const gv = {};

  function stateFor(key) {
    if (!gv[key]) {
      gv[key] = { showUndetected: false, colorBy: "usage", sortBy: "support",
                  vmGene: "tpm", vmUsage: "tpm", vmHeat: "tpm",
                  usageScale: "norm",
                  heatScale: "row",
                  track: {}, ov: {} };
    }
    return gv[key];
  }

  async function render(host, arg) {
    clear(host);
    const idx = arg && arg.index != null ? arg.index : (IV.state.openGene || {}).index;
    if (idx == null) {
      host.appendChild(el("div", { class: "empty",
        text: "Pick a gene from the Genes table or the search box." }));
      return;
    }
    const core = IV.state.core;
    const mode = IV.stateApi.modeInfo();
    const u = await IV.stateApi.universe();
    const struct = await IV.stateApi.structOf();
    const g = u.genes, t = u.tx;
    if (idx >= g.n) {
      host.appendChild(el("div", { class: "empty", text: "Gene not in this mode." }));
      return;
    }
    const d = IV.stateApi.derive(u);
    const geneKey = mode.key + ":" + idx;
    const vs = stateFor(geneKey);
    const ctx = { core, mode, u, struct, g, t, d, idx, vs, geneKey,
                  geneId: IV.blocks.cell(g.col("id"), idx),
                  geneName: IV.blocks.cell(g.col("name"), idx),
                  nS: IV.stateApi.nActive() };

    host.appendChild(tabBar());
    host.appendChild(identityCard(ctx));
    host.appendChild(tiles(ctx));
    host.appendChild(geneFlowCard(ctx));
    host.appendChild(modelCard(ctx));
    host.appendChild(exonUsageCard(ctx));
    if (ctx.nS > 1) {
      host.appendChild(el("div", { class: "grid grid-2" }, [
        geneAcrossSamplesCard(ctx), usageAcrossSamplesCard(ctx),
      ]));
      host.appendChild(variantHeatmapCard(ctx));
    } else {
      host.appendChild(usageAcrossSamplesCard(ctx));
    }
    host.appendChild(variantTableCard(ctx));
    host.appendChild(crossModeCard(ctx));
  }

  function tabBar() {
    const wrap = el("div", { style: { display: "flex", gap: "var(--sp-2)",
      alignItems: "center", flexWrap: "wrap", marginBottom: "var(--sp-3)" } });
    wrap.appendChild(el("button", { class: "btn btn-sm", text: "← Back",
      title: "Return to where you came from, with your filters intact",
      onclick: function () { IV.app.back(); } }));
    tabList(wrap);
    return wrap;
  }

  function tabList(wrap) {
    const tabs = IV.state.geneTabs;
    if (!tabs.length) return wrap;
    const bar = el("div", { class: "gene-tabs" });
    const cur = IV.state.openGene || {};
    for (const tab of tabs) {
      const active = tab.mode === cur.mode && tab.index === cur.index;
      const node = el("span", { class: "gene-tab",
        "aria-current": active ? "page" : null, title: tab.id });
      node.appendChild(el("span", { class: "gt-name", text: tab.name || tab.id }));
      if (tab.mode !== IV.state.mode) {
        node.appendChild(el("span", { class: "gt-mode",
          text: IV.stateApi.MODES[tab.mode].label }));
      }
      const x = el("span", { class: "gt-close", text: "×", title: "Close" });
      x.addEventListener("click", function (ev) {
        ev.stopPropagation();
        IV.stateApi.closeGeneTab(tab.mode, tab.index);
        const remaining = IV.state.geneTabs;
        if (active) {
          if (remaining.length) {
            const n = remaining[remaining.length - 1];
            IV.app.openGene(n.index, { mode: n.mode, noPush: true });
          } else IV.app.back();
        } else IV.app.rerender();
      });
      node.appendChild(x);
      node.addEventListener("click", function () {
        IV.app.openGene(tab.index, { mode: tab.mode, noPush: true });
      });
      bar.appendChild(node);
    }
    wrap.appendChild(bar);
    if (tabs.length > 1) {
      wrap.appendChild(el("button", { class: "btn btn-sm", text: "Close all",
        onclick: function () {
          const onGene = IV.state.view === "gene";
          IV.state.geneTabs = [];
          if (onGene) IV.app.back(); else IV.app.rerender();
        } }));
    }
    return wrap;
  }

  function openStrip() {
    if (!IV.state.geneTabs.length) return null;
    const wrap = el("div", { style: { display: "flex", gap: "var(--sp-2)",
      alignItems: "center", flexWrap: "wrap", marginBottom: "var(--sp-3)" } });
    wrap.appendChild(el("span", { class: "control-label", text: "Open" }));
    tabList(wrap);
    return wrap;
  }

  function identityCard(ctx) {
    const { g, idx, mode, d } = ctx;
    const c = U.card(null);
    const row = el("div", { style: { display: "flex", gap: "var(--sp-4)",
      alignItems: "baseline", flexWrap: "wrap" } });
    const id = IV.blocks.cell(g.col("id"), idx);
    const name = IV.blocks.cell(g.col("name"), idx) || id;

    row.appendChild(el("div", { style: { fontSize: "22px", fontWeight: "680",
      letterSpacing: "-0.02em", color: "var(--brand)" }, text: name }));
    row.appendChild(el("span", { class: "mono small faint", text: id }));
    if (IV.stateApi.hasBiotypes(g)) {
      row.appendChild(el("span", { class: "pill pill-off",
        text: F.prettyBiotype(IV.blocks.cell(g.col("biotype"), idx)) }));
    }
    if (g.has("novel") && g.col("novel")[idx]) {
      row.appendChild(el("span", { class: "pill pill-nnic", text: "Novel locus" }));
    }
    if (!(d.total[idx] > 0)) {
      row.appendChild(el("span", { class: "pill pill-off", text: "Evidence only",
        title: "Molecules were assigned here but none uniquely, so the quantified "
          + "count is zero." }));
    }
    const chr = IV.blocks.cell(g.col("chr"), idx);
    const s = g.col("start")[idx], e = g.col("end")[idx];
    row.appendChild(el("span", { class: "small muted mono",
      text: chr + ":" + F.int(s) + "–" + F.int(e)
        + " (" + F.STRAND[g.col("strand")[idx]] + ") · " + F.bp(e - s + 1) }));
    row.appendChild(el("span", { style: { flex: "1" } }));

    const bare = F.stripVersion(id);
    const SP = IV.species;
    const spKey = SP ? SP.ensemblSpecies() : "";

    if (/^ENS/.test(bare) && spKey) {
      row.appendChild(el("a", { class: "btn btn-sm", target: "_blank", rel: "noopener",
        href: "https://www.ensembl.org/" + encodeURIComponent(spKey)
          + "/Gene/Summary?g=" + bare,
        text: "Ensembl ↗" }));
    }
    if (bare) {
      const term = SP && SP.latin() ? bare + " " + SP.latin() : bare;
      row.appendChild(el("a", { class: "btn btn-sm", target: "_blank", rel: "noopener",
        href: "https://www.ncbi.nlm.nih.gov/gene/?term=" + encodeURIComponent(term),
        text: "NCBI ↗" }));
    }
    if (name && !/^(ENSG|novel|transcript|LOC)/.test(name)
        && SP && SP.speciesHas("genecards")) {
      row.appendChild(el("a", { class: "btn btn-sm", target: "_blank", rel: "noopener",
        href: "https://www.genecards.org/cgi-bin/carddisp.pl?gene="
          + encodeURIComponent(name), text: "GeneCards ↗" }));
    }
    if (name && !/^(ENSG|novel|transcript|LOC)/.test(name)
        && SP && SP.speciesHas("uniprot")) {
      row.appendChild(el("a", { class: "btn btn-sm", target: "_blank", rel: "noopener",
        href: "https://www.uniprot.org/uniprotkb?query="
          + encodeURIComponent("gene_exact:" + name
              + " AND organism_id:9606 AND reviewed:true"),
        text: "UniProt ↗" }));
    }
    const ucsc = SP ? SP.ucscDb() : null;
    if (ucsc) {
      row.appendChild(el("a", { class: "btn btn-sm", target: "_blank", rel: "noopener",
        href: "https://genome.ucsc.edu/cgi-bin/hgTracks?db=" + ucsc + "&position="
          + encodeURIComponent(chr + ":" + s + "-" + e), text: "UCSC ↗" }));
    }
    c.appendChild(row);

    if (IV.overlays && IV.overlays.geneDescription) {
      const slot = el("p", { class: "note small gene-desc",
        style: { margin: "6px 0 0" } });
      c.appendChild(slot);
      IV.overlays.geneDescription(id).then(function (d) {
        if (!d || !d.text) { slot.remove(); return; }
        slot.textContent = d.text;
      }).catch(function () { slot.remove(); });
    }
    return c;
  }

  function geneFlowCard(ctx) {
    const { g, t, idx, d, mode } = ctx;
    if (!IV.px || !IV.px.sankey || !IV.px.available()) return el("div");
    const S = IV.stateApi;
    const mol = S.evidence(g, "mol", idx);
    if (!(mol > 0)) return el("div");

    const geneCounted = Math.min(Math.round(d.total[idx] || 0), mol);
    const geneUncounted = Math.max(0, mol - geneCounted);

    const off = g.col("tx_off")[idx], nTx = g.col("tx_n")[idx];
    let txCounted = 0;
    if (t.has("count") && nTx > 0) {
      const cnt = t.col("count");
      for (let k = 0; k < nTx; k++) txCounted += cnt[off + k] || 0;
    }
    txCounted = Math.min(Math.round(txCounted), geneCounted);
    const countedGeneOnly = Math.max(0, geneCounted - txCounted);

    const c = U.card("Where this " + mode.geneWord + "'s molecules went", {
      tour: "gene-funnel",
      note: "Of the " + F.int(mol) + " detected molecules, how many reach the "
        + mode.geneWord + "'s count, and how many of those reach a single "
        + mode.featureWord + ".",
    });

    const PINK = "rgba(236,0,140,.30)";
    const GREY = "rgba(140,133,152,.22)";
    const NODE_PINK = IV.dom.token("--brand");
    const NODE_GREY = IV.dom.token("--gm-400");
    const nodes = [
      { label: "Detected molecules · " + F.compact(mol, 2), color: NODE_PINK },
      { label: "Counted molecules, " + mode.geneWord + " · "
        + F.compact(geneCounted, 2), color: NODE_PINK },
      { label: "Not counted · " + F.compact(geneUncounted, 2), color: NODE_GREY },
      { label: "Counted molecules, " + mode.featureWord + " · "
        + F.compact(txCounted, 2), color: NODE_PINK },
      { label: "Counted for the " + mode.geneWord + " only · "
        + F.compact(countedGeneOnly, 2), color: NODE_GREY },
    ];
    const links = [
      { source: 0, target: 1, value: geneCounted, color: PINK },
      { source: 0, target: 2, value: geneUncounted, color: GREY },
      { source: 1, target: 3, value: txCounted, color: PINK },
      { source: 1, target: 4, value: countedGeneOnly, color: GREY },
    ].filter(function (l) { return l.value > 0; });

    const bad = IV.px.checkConserves(nodes, links);
    if (bad.length) {
      c.appendChild(el("div", { class: "empty",
        text: "Flow withheld: the per-gene totals do not balance." }));
      return c;
    }
    const host = el("div");
    c.appendChild(host);
    IV.px.sankey(host, { nodes: nodes, links: links },
      { height: 250, valuesuffix: "molecules",
        exportName: "gene-flow", uirevision: "gene-flow-" + idx });

    if (countedGeneOnly > 0) {
      c.appendChild(el("p", { class: "note small",
        html: "<strong>" + F.int(countedGeneOnly) + "</strong> counted molecules "
          + "(" + F.pctOf(countedGeneOnly, geneCounted, 0) + ") add to the "
          + mode.geneWord + "'s count but to no single " + mode.featureWord
          + "'s." }));
    }
    return c;
  }

  function tiles(ctx) {
    const { g, idx, d, nS, mode, core } = ctx;
    const S = IV.stateApi;
    const box = el("div", { "data-tour": "gene-tiles" });
    const mol = S.evidence(g, "mol", idx), molFl = S.evidence(g, "mol_fl", idx);
    const read = S.evidence(g, "read", idx);
    const nAnn = g.has("n_annotated") ? g.col("n_annotated")[idx] : null;

    const meanTpm = S.meanTpm(g, idx);
    const countedTotal = d.total[idx];
    const resolved = g.has("mol_resolved")
      ? S.evidence(g, "mol_resolved", idx) : null;
    const geneOnly = g.has("mol_gene_only")
      ? S.evidence(g, "mol_gene_only", idx) : null;
    const notCounted = Math.max(0, mol - countedTotal);
    const molItems = [
      { label: "Detected molecules", value: F.compact(mol, 2),
        help: "Every molecule assigned to this " + mode.geneWord + ".",
        sub: F.compact(read, 2) + " reads · "
          + F.dec(mol ? read / mol : 0, 1) + " per molecule" },
      { label: "Full-length", value: mol ? F.pctOf(molFl, mol) : "–",
        sub: F.int(molFl) + " of " + F.compact(mol, 2) + " detected molecules",
        help: "Share of detected molecules with both ends observed." },
      { label: "Counted molecules", value: F.compact(countedTotal, 2),
        tone: "brand",
        help: "Molecules quantification counted toward this " + mode.geneWord
          + " as a whole. Its individual " + mode.variantWordPlural + " account "
          + "for fewer, because " + mode.featureWord + " quantification is "
          + "stricter - the flow below splits the two.",
        sub: mol ? F.pctOf(countedTotal, mol, 0) + " of detected molecules"
          : "no molecules",
        meter: mol ? [
          { label: "Counted", value: countedTotal,
            color: IV.dom.token("--brand") },
          { label: "Present but not counted", value: notCounted,
            color: IV.dom.token("--gm-300") },
        ] : null },
      resolved != null ? {
        label: "Resolved to one " + mode.featureWord,
        value: F.compact(resolved, 2),
        sub: mol ? F.pctOf(resolved, mol, 0) + " of detected molecules"
                 : "no molecules",
        help: "Molecules whose assignment names a single " + mode.featureWord
          + " - an assignment fact, not a quantification one, so it is not a "
          + "step after \u201cCounted molecules\u201d but a different question "
          + "about the same molecules. Together with the "
          + mode.geneWord + "-only remainder it accounts for every detected "
          + "molecule.",
        meter: mol ? [
          { label: "Resolved to one " + mode.featureWord, value: resolved,
            color: IV.pal.familyColor("resolved") },
          { label: mode.geneWord + " only", value: Math.max(0, geneOnly || 0),
            color: IV.pal.familyColor("ambiguous") },
        ] : null,
      } : null,
    ];
    const perSample = [
      { label: "Mean counted molecules per sample", value: F.dec(S.meanCounts(g, idx), 1),
        sub: "across " + nS + (nS === 1 ? " sample" : " samples"),
        help: S.COUNTED_NOTE + " Counted molecules divided by the number of "
          + "selected samples - the per-sample form of \"Counted molecules\", "
          + "not of the evidence total." },
      { label: "Mean TPM per sample",
        value: meanTpm == null ? "–" : F.dec(meanTpm, 2),
        help: "Depth-normalised expression, so samples are comparable.",
        sub: meanTpm == null ? "no TPM in this mode" : "normalised per sample" },
    ];
    const varItems = [
      { label: F.pretty(mode.variantWordPlural) + " detected",
        value: F.int(d.nVarDet[idx]),
        unit: nAnn != null ? " / " + F.int(nAnn) : null,
        sub: (nAnn != null ? "annotated" : F.int(d.nVar[idx]) + " in scope")
          + (g.has("n_nnic")
            ? " · " + F.int(g.col("n_nic")[idx]) + " NIC, "
              + F.int(g.col("n_nnic")[idx]) + " NNIC" : "") },
      { label: "Dominant " + mode.variantWord,
        value: d.nVarDet[idx] > 1 ? F.pct(d.domShare[idx], 0) : "–",
        sub: d.nVarDet[idx] > 1
          ? "Shannon entropy " + F.dec(d.entropy[idx], 3)
          : "single " + mode.variantWord,
        help: "Share of the " + mode.geneWord + "'s expression held by its "
          + "most-used " + mode.variantWord + "." },
    ];
    if (nS > 1) {
      const pr = d.jsdPairs ? d.jsdPairs[idx] : null;
      const prTotal = d.nPairs != null ? d.nPairs : (nS * (nS - 1)) / 2;
      varItems.push({ label: "Mean JSD of " + mode.variantWord + " usage",
        value: d.nVarDet[idx] > 1 ? F.dec(d.jsdMean[idx], 3) : "–",
        sub: d.nVarDet[idx] > 1
          ? "Max JSD " + F.dec(d.jsdMax[idx], 3)
            + (pr != null ? " · " + F.int(pr) + " / " + F.int(prTotal)
                            + " sample pairs" : "")
          : "needs ≥2 " + mode.variantWordPlural,
        help: "How differently the samples use this " + mode.geneWord
          + "'s " + mode.variantWordPlural + ", averaged over every usable "
          + "pair of samples. A pair is "
          + "usable only when both samples counted something here, which is why "
          + "the pair count can be short of the "
          + F.int(prTotal) + " possible." });
      perSample.push({ label: "Detected in", value: F.int(d.nDetected[idx]),
        unit: " / " + nS,
        sub: nS === 1 ? "sample" : "samples" });
    }
    U.tileGroups(box, [
      { label: "Molecules on this " + mode.geneWord, items: molItems },
      { label: "This " + mode.geneWord + ", per sample", items: perSample },
      { label: F.pretty(mode.variantWord) + " usage", items: varItems },
    ]);
    return box;
  }

  function variantRows(ctx) {
    const { g, t, idx, d, vs } = ctx;
    const off = g.col("tx_off")[idx], n = g.col("tx_n")[idx];
    const mol = t.col("mol");
    const rows = [];
    for (let k = 0; k < n; k++) {
      const i = off + k;
      const kept = d.txKeep[i];
      if (!kept && !vs.showUndetected) continue;
      rows.push(i);
    }
    const S = IV.stateApi;
    const val = function (i) { return S.txValue(t, i); };
    const tpmM = t.has("tpm") ? t.col("tpm") : null;
    const tpmVal = function (i) {
      if (!tpmM) return val(i);
      const act = S.activeIdx();
      let sum = 0;
      for (let k2 = 0; k2 < act.length; k2++) sum += tpmM.get(i, act[k2]);
      return act.length ? sum / act.length : 0;
    };
    rows.sort(function (a, b) {
      const ka = d.txKeep[a] ? 0 : 1, kb = d.txKeep[b] ? 0 : 1;
      if (ka !== kb) return ka - kb;
      if (vs.sortBy === "value") return tpmVal(b) - tpmVal(a);
      if (vs.sortBy === "position") return t.col("start")[a] - t.col("start")[b];
      return (mol[b] - mol[a]) || (val(b) - val(a));
    });
    return { rows: rows, off: off, n: n };
  }

  function exonsOf(ctx, i) {
    const { t, struct } = ctx;
    const a = t.col("ex_off")[i], k = t.col("ex_n")[i];
    const s = struct.col("start"), e = struct.col("end"), num = struct.col("num");
    const eid = struct.has("exon_id") ? struct.col("exon_id") : null;
    const out = [];
    for (let x = a; x < a + k; x++) {
      out.push([s[x], e[x], num[x], eid ? IV.blocks.cell(eid, x) : ""]);
    }
    return out;
  }

  function modelCard(ctx) {
    const { g, t, idx, d, vs, mode } = ctx;
    const S = IV.stateApi;
    const c = U.card("Gene model", { tour: "gene-model" });

    const controls = el("div", { class: "control-row" });
    c.appendChild(controls);

    const { rows, n } = variantRows(ctx);
    if (!n) {
      c.appendChild(el("div", { class: "empty", text: "No " + mode.variantWordPlural + " in scope." }));
      return c;
    }

    const usage = {};
    let nDetected = 0;
    for (let k = 0; k < n; k++) {
      const i = g.col("tx_off")[idx] + k;
      if (!d.txKeep[i]) continue;
      nDetected++;
      for (const ex of exonsOf(ctx, i)) {
        const key = ex[0] + "-" + ex[1];
        usage[key] = (usage[key] || 0) + 1;
      }
    }

    let lo = Infinity, hi = -Infinity;
    for (const i of rows) {
      for (const ex of exonsOf(ctx, i)) {
        if (ex[0] < lo) lo = ex[0];
        if (ex[1] > hi) hi = ex[1];
      }
    }
    if (!isFinite(lo)) { lo = g.col("start")[idx]; hi = g.col("end")[idx]; }
    const pad = Math.max(40, Math.round((hi - lo) * 0.008));
    lo -= pad; hi += pad;

    const mol = t.col("mol"), names = t.col("name"), ids = t.col("id");
    const cls = t.has("class") ? t.col("class") : null;
    const cdsS = t.col("cds_start"), cdsE = t.col("cds_end");
    const chr = IV.blocks.cell(g.col("chr"), idx);

    const cdsKnown = mode.key === "ref";

    function variantTipRows(i) {
      const share = t.col("share")[i];
      const out = [
        ["Molecules", F.int(mol[i])],
        ["Mean " + S.valueLabel(), S.fmtValue(S.txValue(t, i))],
      ];
      if (share > 0) out.push(["Share of the gene", F.pct(share, 1)]);
      if (!d.txKeep[i]) out.push(["", "below the stringency floor"]);
      return out;
    }

    const trackRows = rows.map(function (i) {
      const kept = d.txKeep[i];
      const nm = IV.blocks.cell(names, i) || IV.blocks.cell(ids, i);
      const clsVal = cls ? IV.blocks.cell(cls, i) : null;
      const share = t.col("share")[i];
      return {
        id: IV.blocks.cell(ids, i),
        name: nm,
        exons: exonsOf(ctx, i),
        cds: cdsS[i] ? [cdsS[i], cdsE[i]] : null,
        cdsKnown: cdsKnown,
        strand: t.col("strand")[i],
        kept: kept,
        color: clsVal && clsVal !== "known"
          ? IV.pal.novelColor(clsVal) : IV.dom.token("--gm-600"),
        right: F.compact(mol[i], 1)
          + (mol[i] === 1 ? " molecule" : " molecules")
          + (S.totalTpm(t, i) != null
              ? " · " + F.tpm(S.totalTpm(t, i)) + " TPM" : "")
          + (share > 0 ? " · " + F.pct(share, 0) : ""),
        onClick: function () { hlVariant(ctx, i); },
        tipRow: function () {
          return IV.chart.tipHTML(nm, variantTipRows(i));
        },
        tipFor: function (ex) {
          const used = usage[ex[0] + "-" + ex[1]] || 0;
          return IV.chart.tipHTML(nm, variantTipRows(i).concat([
            { head: "Exon" },
            ["Position", (ex[2] ? "#" + ex[2] + " · " : "")
              + F.int(ex[0]) + "–" + F.int(ex[1])],
            ["Length", F.bp(ex[1] - ex[0] + 1)],
            ["In detected " + mode.variantWordPlural, used + " of " + nDetected
              + (nDetected ? " (" + F.pct(used / nDetected, 0) + ")" : "")],
            ["Category", exonCategory(used, nDetected, mode.variantWord)],
          ]));
        },
      };
    });

    const holder = el("div", { class: "gt-wrap" });
    const handle = IV.geneTrack.draw(holder, {
      chr: chr, gStart: lo, gEnd: hi, rows: trackRows,
      usage: usage, nDetected: nDetected, colorBy: vs.colorBy,
      overlays: vs.ov, state: vs.track,
      exportName: (ctx.geneName || ctx.geneId || "gene") + "-model",
      onSelect: function (sel) {
        for (const tr of document.querySelectorAll("tr[data-exon-key]")) {
          tr.classList.toggle("hl",
            !!sel.exonKey && tr.getAttribute("data-exon-key") === sel.exonKey);
        }
        if (sel.row) hlVariantById(sel.row.id);
      },
    });
    vs.handle = handle;

    const colourOpts = [
      { label: "Exon usage", value: "usage",
        help: "Shade each exon by how many detected " + mode.variantWordPlural
              + " contain it: dark = " +
              "constitutive, light = used by few." },
    ];
    if (cdsKnown) {
      colourOpts.push({ label: "Feature type", value: "cds",
        help: "Coding sequence against untranslated regions, one colour each. "
          + "Block height says the same thing; colour makes it legible at a "
          + "glance on a long locus." });
    }
    if (cls) {
      colourOpts.push({ label: F.pretty(mode.variantWord) + " class",
        value: "variant",
        help: "One colour per " + mode.variantWord
          + ", by known / NIC / NNIC class." });
    }
    if (!colourOpts.some(function (o) { return o.value === vs.colorBy; })) {
      vs.colorBy = "usage";
    }
    if (colourOpts.length > 1) {
      controls.appendChild(U.control("Colour", U.seg(colourOpts,
        vs.colorBy, function (v) { vs.colorBy = v; IV.app.rerender(); },
        { label: "Colour by" })));
    }
    controls.appendChild(U.control("Order", U.seg([
      { label: "Molecules", value: "support",
        help: "Detected molecules on the " + mode.variantWord
          + ", summed over the selected "
          + "samples - the raw evidence, whichever unit the card is showing." },
      t.has("tpm") ? { label: "TPM", value: "value",
        help: "Mean TPM per sample - depth-normalised, so a "
          + mode.variantWord + " is not "
          + "ranked high merely for sitting in the deepest library." } : null,
      { label: "Position", value: "position",
        help: "Genomic start coordinate, so the rows follow the locus rather "
          + "than the numbers." },
    ].filter(Boolean), vs.sortBy, function (v) { vs.sortBy = v; IV.app.rerender(); },
      { label: "Order " + mode.variantWordPlural + " by" })));

    if (handle.hasZoom) {
      const zin = el("button", { class: "btn btn-sm", text: "+", title: "Zoom in",
        onclick: function () { handle.zoomBy(2); } });
      const zout = el("button", { class: "btn btn-sm", text: "−", title: "Zoom out",
        onclick: function () { handle.zoomBy(0.5); } });
      const zres = el("button", { class: "btn btn-sm", text: "Reset",
        title: "Back to the whole locus", onclick: function () { handle.reset(); } });
      controls.appendChild(U.control("Zoom",
        el("div", { class: "btn-row" }, [zin, zout, zres])));

      const posErr = el("span", { class: "control-hint" });
      const posIn = el("input", { type: "text",
        placeholder: chr + ":" + F.int(lo + Math.round((hi - lo) / 2)),
        style: { width: "170px", fontFamily: "var(--mono)" },
        title: "Accepts chr:position or a plain coordinate. Frames ±100 bp." });
      function jump() {
        posErr.textContent = "";
        const r = IV.geneTrack.parsePosition(posIn.value, chr);
        if (!r) return;
        if (r.error) { posErr.textContent = r.error; return; }
        if (r.pos < lo || r.pos > hi) {
          posErr.textContent = "Outside this locus (" + F.int(lo) + "–"
            + F.int(hi) + ").";
          return;
        }
        handle.goTo(r.pos, 100);
      }
      posIn.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); jump(); }
      });
      controls.appendChild(U.control("Go to position",
        el("div", { class: "btn-row" }, [posIn,
          el("button", { class: "btn btn-sm", text: "Go", onclick: jump }), posErr])));
    }

    const undetected = countUndetected(ctx);
    if (undetected) {
      const cb = el("input", { type: "checkbox", checked: vs.showUndetected });
      cb.addEventListener("change", function () {
        vs.showUndetected = cb.checked;
        IV.app.rerender();
      });
      controls.appendChild(el("label", { class: "small",
        style: { display: "flex", gap: "6px", alignItems: "center", cursor: "pointer",
                 alignSelf: "flex-end" },
        title: "Draw the " + mode.variantWordPlural + " that exist for this "
          + mode.geneWord + " but do not reach the "
          + "stringency floor, as outlines" },
        [cb, "Show " + F.int(undetected) + " below the floor"]));
    }

    c.appendChild(IV.overlays.overlayBar(ctx,
      { chr: chr, lo: lo, hi: hi, rows: trackRows }));
    c.appendChild(holder);

    if (vs.colorBy === "usage") {
      c.appendChild(IV.chart.legend([
        { label: "Constitutive (all " + mode.variantWordPlural + ")",
          color: IV.pal.geneModelShade(1) },
        { label: "Most " + mode.variantWordPlural,
          color: IV.pal.geneModelShade(0.66) },
        { label: "Some " + mode.variantWordPlural,
          color: IV.pal.geneModelShade(0.42) },
        { label: "Unique to one", color: IV.pal.geneModelShade(0.2) },
      ]));
    } else if (vs.colorBy === "cds") {
      c.appendChild(IV.chart.legend([
        { label: "Coding (CDS)", color: IV.geneTrack.cdsFill(), shape: "tall" },
        { label: "Untranslated (UTR)", color: IV.geneTrack.utrFill(),
          shape: "short" },
      ]));
    } else if (cls) {
      c.appendChild(IV.chart.legend([
        { label: "Known", color: IV.dom.token("--gm-600") },
        { label: "NIC", color: IV.pal.novelColor("nic") },
        { label: "NNIC", color: IV.pal.novelColor("nnic") },
      ]));
    }
    return c;
  }

  function hlVariantById(id) {
    for (const r of document.querySelectorAll("tr[data-row-id]")) {
      r.classList.toggle("hl", r.getAttribute("data-row-id") === id);
    }
  }

  function hlVariant(ctx, i) {
    const id = IV.blocks.cell(ctx.t.col("id"), i);
    for (const r of document.querySelectorAll("tr[data-row-id]")) {
      r.classList.toggle("hl", r.getAttribute("data-row-id") === id);
    }
    const hit = document.querySelector('tr[data-row-id="' + id + '"]');
    if (hit && hit.scrollIntoView) {
      hit.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function countUndetected(ctx) {
    const { g, idx, d } = ctx;
    const off = g.col("tx_off")[idx], n = g.col("tx_n")[idx];
    let k = 0;
    for (let x = off; x < off + n; x++) if (!d.txKeep[x]) k++;
    return k;
  }

  function exonCategory(used, nDetected, word) {
    if (!nDetected) return "–";
    if (used >= nDetected) return "Constitutive";
    if (used === 1) return "Unique to one " + (word || "variant");
    return "Alternative";
  }

  function drawTrack(host, spec) {
    const w = spec.width, h = spec.height;
    const svg = svgEl("svg", { class: "track-svg",
      viewBox: "0 0 " + w + " " + h, height: h, preserveAspectRatio: "none" });
    const g0 = spec.gStart, g1 = spec.gEnd;
    const span = (g1 - g0) || 1;
    const sx = function (p) { return (p - g0) / span * w; };
    const midY = h / 2;
    const utrH = Math.max(5, h * 0.4);
    const cdsH = Math.max(9, h * 0.78);
    const exons = spec.exons || [];

    if (exons.length) {
      const a = sx(exons[0][0]), b = sx(exons[exons.length - 1][1]);
      svg.appendChild(svgEl("line", { x1: a, x2: b, y1: midY, y2: midY,
        stroke: spec.dim ? IV.dom.token("--border-strong") : spec.color,
        "stroke-width": 1.4, opacity: spec.dim ? 0.7 : 0.85 }));
      if (spec.strand !== 2 && b - a > 44) {
        const dir = spec.strand === 1 ? -1 : 1;
        for (let px = a + 16; px < b - 8; px += 28) {
          let inExon = false;
          for (const ex of exons) {
            if (px >= sx(ex[0]) - 1 && px <= sx(ex[1]) + 1) { inExon = true; break; }
          }
          if (inExon) continue;
          svg.appendChild(svgEl("path", {
            d: "M" + (px - 2.6 * dir) + "," + (midY - 3)
               + "L" + (px + 2.6 * dir) + "," + midY
               + "L" + (px - 2.6 * dir) + "," + (midY + 3),
            fill: "none", stroke: IV.dom.token("--ink-faint"), "stroke-width": 1.1,
            "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.75,
          }));
        }
      }
    }

    const cds = spec.cds && spec.cds[1] > spec.cds[0] ? spec.cds : null;
    for (const ex of exons) {
      const x0 = sx(ex[0]), x1 = sx(ex[1]);
      const bw = Math.max(1.4, x1 - x0);
      const coding = cds && ex[1] >= cds[0] && ex[0] <= cds[1];
      const eh = coding ? cdsH : utrH;
      let fill = spec.color;
      if (!spec.dim && spec.colorBy === "usage" && spec.nDetected) {
        const used = spec.usage[ex[0] + "-" + ex[1]] || 0;
        fill = IV.pal.sequential(0.18 + 0.82 * (used / spec.nDetected));
      }
      const r = svgEl("rect", {
        x: x0, y: midY - eh / 2, width: bw, height: eh, rx: 1.5,
        fill: spec.dim ? "none" : fill,
        stroke: spec.dim ? IV.dom.token("--border-strong") : IV.dom.token("--surface"),
        "stroke-width": spec.dim ? 1.2 : (bw > 4 ? 1 : 0),
        opacity: spec.dim ? 0.9 : 1,
      });
      if (spec.tipFor) {
        IV.chart.bindHover(r, (function (e) {
          return function () { return spec.tipFor(e); };
        })(ex));
      }
      svg.appendChild(r);
    }
    host.appendChild(svg);
  }

  function exonUsageCard(ctx) {
    const { g, t, idx, d, mode } = ctx;
    const c = U.card("Exon usage", {
      note: "Every distinct exon of this " + mode.geneWord + ", and how many "
        + "detected " + mode.variantWordPlural + " contain it.",
    });
    const off = g.col("tx_off")[idx], n = g.col("tx_n")[idx];
    const usage = {};
    const geom = {};
    let nDetected = 0;
    for (let k = 0; k < n; k++) {
      const i = off + k;
      if (!d.txKeep[i]) continue;
      nDetected++;
      for (const ex of exonsOf(ctx, i)) {
        const key = ex[0] + "-" + ex[1];
        usage[key] = (usage[key] || 0) + 1;
        if (!geom[key]) geom[key] = ex;
      }
    }
    const keys = Object.keys(usage);
    if (!keys.length) {
      c.appendChild(el("div", { class: "empty", text: "No exon structures available." }));
      return c;
    }
    const strandMinus = g.col("strand")[idx] === 1;
    keys.sort(function (a, b) {
      const d0 = geom[a][0] - geom[b][0];
      return strandMinus ? -d0 : d0;
    });

    let nConst = 0, nUniq = 0, nAlt = 0;
    for (const k of keys) {
      const cat = exonCategory(usage[k], nDetected, mode.variantWord);
      if (cat === "Constitutive") nConst++;
      else if (cat === "Unique to one " + mode.variantWord) nUniq++;
      else nAlt++;
    }
    const box = el("div");
    U.tiles(box, [
      { label: "Distinct exons", value: F.int(keys.length),
        sub: "across " + nDetected + " detected " + mode.variantWordPlural },
      { label: "Constitutive", value: F.int(nConst),
        sub: F.pctOf(nConst, keys.length, 0) + " - carry no isoform information" },
      { label: "Alternative", value: F.int(nAlt),
        sub: F.pctOf(nAlt, keys.length, 0) + " - in some "
          + mode.variantWordPlural },
      { label: "Unique to one", value: F.int(nUniq),
        sub: F.pctOf(nUniq, keys.length, 0) + " - the discriminating exons" },
    ]);
    c.appendChild(box);

    const ordinal = {};
    keys.forEach(function (k, i) { ordinal[k] = i + 1; });

    const anyEid = keys.some(function (k) { return geom[k][3]; });
    const rows = keys.map(function (k) {
      const ex = geom[k];
      const row = [String(ordinal[k])];
      if (anyEid) row.push(ex[3] || "–");
      return row.concat([
        F.int(ex[0]) + "–" + F.int(ex[1]),
        F.bp(ex[1] - ex[0] + 1),
        usage[k] + " / " + nDetected,
        F.pct(usage[k] / Math.max(1, nDetected), 0),
        exonCategory(usage[k], nDetected, mode.variantWord),
      ]);
    });
    const tbl = U.tableBehind(
      ["Exon"].concat(anyEid ? ["Exon ID"] : [])
        .concat(["Coordinates", "Length", "In " + mode.variantWordPlural,
                 "Share", "Category"]),
      rows, "Show all " + keys.length + " exons",
      { rowKey: { attr: "data-exon-key",
                  of: function (_r, ri) { return keys[ri]; } } });
    tbl.addEventListener("click", function (evt) {
      const tr = evt.target && evt.target.closest
        ? evt.target.closest("tr[data-exon-key]") : null;
      if (!tr) return;
      const key = tr.getAttribute("data-exon-key");
      const h = ctx.vs.handle;
      const now = (h && h.selectExon) ? h.selectExon(key) : null;
      for (const other of tbl.querySelectorAll("tr[data-exon-key]")) {
        other.classList.toggle("hl",
          !!now && other.getAttribute("data-exon-key") === now);
      }
    });
    c.appendChild(tbl);
    return c;
  }

  function unitOf(vs, key) {
    return vs[key] || IV.state.valueMode;
  }

  function withUnit(vm, fn) {
    const prev = IV.state.valueMode;
    if (vm && vm !== prev) IV.state.valueMode = vm;
    try { return fn(); } finally { IV.state.valueMode = prev; }
  }

  function unitSwitch(vs, key, redraw) {
    return IV.ui.control("Values", IV.ui.seg([
      { label: "TPM", value: "tpm",
        help: "Depth-normalised, so samples are comparable." },
      { label: "Molecules", value: "counts",
        help: "Molecules counted for the feature, as measured." },
    ], unitOf(vs, key), function (v) { vs[key] = v; redraw(); },
      { label: "Values" }));
  }

  function perSampleHeight(nS, rowH, gap) {
    const n = Math.max(1, nS || 1);
    return n * rowH + (n - 1) * (gap || 0);
  }

  function emptyLike(text, px) {
    return el("div", { class: "empty", text: text,
      style: { minHeight: Math.round(px) + "px", display: "flex",
               alignItems: "center", justifyContent: "center" } });
  }

  function geneAcrossSamplesCard(ctx) {
    const { g, idx, core, vs, mode } = ctx;
    const S = IV.stateApi;
    const c = U.card("Gene expression across samples", {
      note: "The " + ctx.mode.geneWord + "'s own value per sample. Read this "
        + "alongside " + mode.variantWord + " usage: a flat "
        + mode.geneWord + " can still switch " + mode.variantWordPlural + " "
        + "completely.",
    });
    const holder = el("div");
    const foot = el("p", { class: "note small", style: { marginTop: "8px" } });
    function draw() {
      withUnit(unitOf(vs, "vmGene"), function () {
        clear(holder);
        const row = Array.prototype.slice.call(S.geneValueRow(g, idx));
        IV.chart.barsH(holder, core.samples.map(function (sn, i) {
          return { label: sn, value: row[i], color: S.sampleColor(i) };
        }), { valueLabel: S.valueLabelCap(), labelW: 120, rowH: 20 });
        const mean = row.reduce(function (x, y) { return x + y; }, 0) / (row.length || 1);
        foot.innerHTML = "Mean <strong>" + S.fmtValue(mean) + "</strong> · CV <strong>"
          + F.dec(ctx.d.cv[idx], 2) + "</strong> · Detected in <strong>"
          + ctx.d.nDetected[idx] + " / " + ctx.nS + "</strong> samples";
      });
    }
    const row0 = el("div", { class: "control-row" });
    row0.appendChild(unitSwitch(vs, "vmGene", draw));
    c.appendChild(row0);
    c.appendChild(holder);
    c.appendChild(foot);
    draw();
    return c;
  }

  function usageAcrossSamplesCard(ctx) {
    const { g, t, idx, d, core, nS, mode } = ctx;
    const S = IV.stateApi;
    const c = U.card(F.pretty(mode.variantWord) + " usage", {
      note: nS > 1
        ? "One row per sample. A sample whose composition changes while the "
          + "gene's total stays flat is a switching candidate."
        : "Share of the " + mode.geneWord + "'s expression held by each "
          + mode.variantWord + ".",
    });
    const { rows } = variantRows(ctx);
    const kept = rows.filter(function (i) { return d.txKeep[i]; });
    if (!kept.length) {
      c.appendChild(emptyLike("No " + mode.variantWordPlural
        + " above the floor.",
        perSampleHeight(nS, 22, 6)));
      return c;
    }
    const names = t.col("name"), ids = t.col("id");
    const colors = {}, labels = {};
    kept.forEach(function (i, k) {
      colors["v" + k] = IV.pal.sequential(1 - 0.72 * k / Math.max(4, kept.length));
      labels["v" + k] = IV.blocks.cell(names, i) || IV.blocks.cell(ids, i);
    });
    const keys = kept.map(function (_, k) { return "v" + k; });

    const holder = el("div");
    function draw() {
      withUnit(unitOf(ctx.vs, "vmUsage"), function () {
        clear(holder);
        const vm = t.col(S.valueColumn());
        const groups = nS > 1
          ? core.samples.map(function (sn, j) {
              const values = {};
              kept.forEach(function (i, k) { values["v" + k] = vm.get(i, j); });
              return { label: sn, values: values };
            })
          : [{ label: "All", values: (function () {
                const values = {};
                kept.forEach(function (i, k) { values["v" + k] = vm.get(i, 0); });
                return values;
              })() }];
        IV.chart.stackGroups(holder, groups, keys, {
          colors: colors, labels: labels, labelW: 118, height: 22,
          valueLabel: S.valueLabelCap(),
          scale: ctx.vs.usageScale === "abs" ? "shared" : null,
        });
      });
    }
    const ctrl = el("div", { class: "control-row" });
    ctrl.appendChild(unitSwitch(ctx.vs, "vmUsage", draw));
    ctrl.appendChild(U.control("Scale", U.seg([
      { label: "Usage", value: "norm",
        help: "Each sample normalised to its own total for this gene, so the bars "
          + "show composition." },
      { label: "Absolute", value: "abs",
        help: "All samples on one scale, so bar length is the total as well." },
    ], ctx.vs.usageScale || "norm",
      function (v) { ctx.vs.usageScale = v; draw(); }, { label: "Bar scale" })));
    c.appendChild(ctrl);
    c.appendChild(holder);
    draw();
    return c;
  }

  function variantHeatmapCard(ctx) {
    const { t, core, d, nS, mode } = ctx;
    const S = IV.stateApi;
    const c = U.card(F.pretty(mode.variantWord) + " expression by sample");
    const { rows } = variantRows(ctx);
    const kept = rows.filter(function (i) { return d.txKeep[i]; });
    if (kept.length < 2 || nS < 2) {
      c.appendChild(emptyLike("Needs at least two " + mode.variantWordPlural
        + " and two samples.",
        perSampleHeight(nS, 22, 6)));
      return c;
    }
    const names = t.col("name"), ids = t.col("id");
    const holder = el("div");
    const vs = ctx.vs;

    function draw() {
      clear(holder);
      const vm = t.col(unitOf(vs, "vmHeat") === "tpm" ? "tpm" : "counts");
      const rowMean = kept.map(function (i) {
        let s = 0;
        for (let j = 0; j < nS; j++) s += vm.get(i, j);
        return s / nS;
      });
      const logv = function (v) { return Math.log(v + 1) / Math.LN2; };
      let maxAbs = 0, maxVal = 0;
      for (let r = 0; r < kept.length; r++) {
        for (let j = 0; j < nS; j++) {
          const v = vm.get(kept[r], j);
          if (v > maxVal) maxVal = v;
          const dv = Math.abs(logv(v) - logv(rowMean[r]));
          if (dv > maxAbs) maxAbs = dv;
        }
      }
      IV.chart.heatmap(holder, {
        exportName: "gene-variant-usage",
        rows: kept.map(function (i) {
          return IV.blocks.cell(names, i) || IV.blocks.cell(ids, i);
        }),
        cols: core.samples,
        cellW: Math.max(34, Math.min(70, 420 / nS)),
        cellH: Math.max(13, Math.min(22, 400 / kept.length)),
        labelW: 190, headH: nS > 6 ? 62 : 32,
        get: function (r, cc) { return vm.get(kept[r], cc); },
        scale: function (v, r) {
          if (vs.heatScale === "row") {
            if (!maxAbs) return IV.pal.diverging(0);
            return IV.pal.diverging((logv(v) - logv(rowMean[r])) / maxAbs);
          }
          return IV.pal.sequential(maxVal > 0 ? logv(v) / logv(maxVal) : 0);
        },
        tip: function (r, cc) {
          const i = kept[r];
          return IV.chart.tipHTML(
            IV.blocks.cell(names, i) || IV.blocks.cell(ids, i), [
              ["Sample", core.samples[cc]],
              [unitOf(vs, "vmHeat") === "tpm" ? "TPM" : "Molecules",
               unitOf(vs, "vmHeat") === "tpm"
                 ? F.dec(vm.get(i, cc), 2) : F.int(vm.get(i, cc))],
              [F.pretty(mode.variantWord) + " mean", S.fmtValue(rowMean[r])],
              ["Molecules", F.int(t.col("mol")[i])],
            ]);
        },
      });
      if (vs.heatScale === "row") {
        IV.chart.colorBar(holder, {
          title: "Difference from the " + mode.variantWord + "'s own mean, log₂",
          colorAt: function (tt) { return IV.pal.diverging(tt * 2 - 1); },
          ticks: [{ at: 0, label: "\u2212" + F.dec(maxAbs, 1) },
                  { at: 0.5, label: "0" },
                  { at: 1, label: "+" + F.dec(maxAbs, 1) }],
        });
      } else {
        const unit = unitOf(vs, "vmHeat") === "tpm" ? "TPM" : "molecules";
        IV.chart.colorBar(holder, {
          title: unit,
          colorAt: function (tt) { return IV.pal.sequential(tt); },
          ticks: [{ at: 0, label: "0" },
                  { at: 0.5, label: F.compact(Math.max(0, Math.sqrt(maxVal + 1) - 1), 0) },
                  { at: 1, label: F.compact(maxVal, 0) }],
        });
      }
    }

    IV.plots.controls(c, {
      groups: [
        { label: "Values", value: unitOf(vs, "vmHeat"),
          options: [{ label: "TPM", value: "tpm" },
                    { label: "Molecules", value: "counts" }],
          onChange: function (v) { vs.vmHeat = v; draw(); } },
        { label: "Scale", value: vs.heatScale,
          options: [{ label: "Row-centred", value: "row" },
                    { label: "Absolute", value: "abs" }],
          onChange: function (v) { vs.heatScale = v; draw(); } },
      ],
    });
    c.appendChild(holder);
    draw();
    return c;
  }

  function variantTableCard(ctx) {
    const { g, t, idx, d, mode, core, nS } = ctx;
    const S = IV.stateApi;
    const c = U.card(F.pretty(mode.variantWord) + " details", {
      note: "One row per " + mode.variantWord + ". These do not sum to the "
        + mode.geneWord + ".",
      tools: [U.csvButton(function () { tb.exportCSV("isoviewer_variants.csv"); })],
    });
    const off = g.col("tx_off")[idx], n = g.col("tx_n")[idx];
    if (!n) {
      c.appendChild(el("div", { class: "empty",
        text: "No " + mode.variantWordPlural + "." }));
      return c;
    }
    const rows = [];
    for (let k = 0; k < n; k++) rows.push(off + k);

    const names = t.col("name"), ids = t.col("id");
    const mol = t.col("mol"), molFl = t.col("mol_fl"), read = t.col("read");
    const nex = t.col("n_exons"), len = t.col("length");
    const share = t.col("share");
    const vm = t.col(S.valueColumn());
    const cls = t.has("class") ? t.col("class") : null;
    const bio = t.has("biotype") ? t.col("biotype") : null;
    const tsl = t.has("tsl") ? t.col("tsl") : null;
    const tag = t.has("tag") ? t.col("tag") : null;
    const supFrac = t.has("sup_frac_fl") ? t.col("sup_frac_fl") : null;
    const supGap = t.has("sup_frac_gap") ? t.col("sup_frac_gap") : null;
    const supReads = t.has("sup_reads") ? t.col("sup_reads") : null;

    const tpmM = t.has("tpm") ? t.col("tpm") : null;
    const meanTpmOf = function (i) {
      if (!tpmM || !nS) return 0;
      const act = IV.stateApi.activeIdx();
      let sum = 0;
      for (let k = 0; k < act.length; k++) sum += tpmM.get(i, act[k]);
      return act.length ? sum / act.length : 0;
    };

    const cols = [
      { key: "name", label: F.pretty(mode.variantWord),
        value: function (i) { return IV.blocks.cell(names, i); },
        render: function (i) {
          const box = el("span", {}, [
            el("span", { class: d.txKeep[i] ? "" : "faint",
              text: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i) }),
          ]);
          if (cls) {
            const cv = IV.blocks.cell(cls, i);
            if (cv && cv !== "known") {
              box.appendChild(el("span", { class: "pill pill-" + cv,
                style: { marginLeft: "6px" }, text: IV.pal.NOVEL_SHORT[cv] || cv }));
            }
          }
          if (!d.txKeep[i]) {
            box.appendChild(el("span", { class: "pill pill-off", text: "Below floor",
              style: { marginLeft: "6px" } }));
          }
          return box;
        } },
      { key: "id", label: F.pretty(mode.featureWord) + " ID", cls: "id",
        value: function (i) { return IV.blocks.cell(ids, i); } },
      (bio && IV.stateApi.hasBiotypes(t)) ? { key: "bio", label: "Biotype",
        value: function (i) { return IV.blocks.cell(bio, i); },
        render: function (i) {
          return el("span", { class: "small muted",
            text: F.prettyBiotype(IV.blocks.cell(bio, i)) });
        } } : null,
      { key: "meanMol", label: "Mean detected molecules per sample", align: "right",
        help: "Molecules whose assignment names this " + mode.variantWord
          + ", divided by the selected samples. Detected, not counted - a "
          + mode.variantWord + " can carry molecules and still count nothing.",
        value: function (i) { return nS ? mol[i] / nS : 0; },
        render: function (i) { return F.dec(nS ? mol[i] / nS : 0, 1); } },
      { key: "meanTpm", label: "Mean TPM per sample", align: "right",
        help: "Depth-normalised, so samples are comparable.",
        value: function (i) { return meanTpmOf(i); },
        render: function (i) { return F.dec(meanTpmOf(i), 2); } },
      { key: "share", label: "Share", align: "right",
        help: "This " + mode.variantWord + "'s share of the "
          + mode.geneWord + "'s total.",
        value: function (i) { return share[i]; },
        render: function (i) { return share[i] > 0 ? F.pct(share[i], 0) : "–"; } },
      { key: "mol", label: "Detected molecules", align: "right",
        help: "Molecules whose assignment names this " + mode.variantWord
          + ". Equal to the counted figure wherever the " + mode.variantWord
          + " has a count at all; a " + mode.variantWord + " that counted nothing "
          + "can still show molecules here.",
        value: function (i) { return mol[i]; } },
      { key: "counted", label: "Counted molecules", align: "right",
        help: S.COUNTED_NOTE,
        value: function (i) { return S.totalCounts(t, i); },
        render: function (i) { return F.int(Math.round(S.totalCounts(t, i))); } },
      { key: "fl", label: "Full-length", align: "right",
        help: "Molecules with at least one 3′ and one 5′ read observed, and what "
          + "fraction that is. Sorts on the fraction.",
        value: function (i) {
          return supFrac ? supFrac[i] : (mol[i] ? molFl[i] / mol[i] : 0);
        },
        render: function (i) {
          const v = supFrac ? supFrac[i] : (mol[i] ? molFl[i] / mol[i] : 0);
          if (!(supReads ? supReads[i] : mol[i])) return "–";
          return F.int(molFl[i]) + " (" + F.pct(v, 0) + ")";
        } },
      { key: "read", label: "Sequencing reads", align: "right",
        value: function (i) { return read[i]; } },
      nS > 1 ? { key: "spark", label: "Per sample", noSort: true,
        render: function (i) {
          const row = Array.prototype.slice.call(vm.row(i));
          const s = IV.chart.sparkBars(row, { width: 62, height: 13,
            color: IV.dom.token("--brand") });
          IV.chart.bindHover(s, function () {
            return IV.chart.tipHTML(IV.blocks.cell(names, i),
              core.samples.map(function (nm, j) {
                return [nm, S.fmtValue(row[j])];
              }));
          });
          return s;
        } } : null,
      { key: "nex", label: "Exons", align: "right",
        value: function (i) { return nex[i]; } },
      { key: "len", label: "Length", align: "right",
        help: "Summed exonic bases.",
        value: function (i) { return len[i]; },
        render: function (i) { return len[i] ? F.int(len[i]) : "–"; } },
      (tsl && IV.stateApi.hasValues(t, "tsl")) ? { key: "tsl", label: "TSL",
        help: "Ensembl transcript support level (1 best … 5, NA).",
        value: function (i) { return IV.blocks.cell(tsl, i); },
        render: function (i) {
          return el("span", { class: "small muted", text: IV.blocks.cell(tsl, i) || "–" });
        } } : null,
      (tag && IV.stateApi.hasValues(t, "tag")) ? { key: "tag", label: "Flags",
        value: function (i) { return IV.blocks.cell(tag, i); },
        render: function (i) {
          const v = IV.blocks.cell(tag, i);
          if (!v) return el("span", { class: "faint", text: "–" });
          return el("span", { class: "chips-row" }, v.split(",").map(function (x) {
            return el("span", { class: "pill pill-flag", text: F.prettyTag(x) });
          }));
        } } : null,
    ].filter(Boolean);

    const host = el("div");
    c.appendChild(host);
    const tb = new U.Table(host, {
      name: "variants", cols: cols, sortKey: "counted", sortDir: -1,
      pageSize: 200, total: rows.length,
      rowId: function (i) { return IV.blocks.cell(ids, i); },
    });
    tb.setRows(Int32Array.from(rows));
    const tools = c.querySelector(".h2-tools");
    if (tools) tools.insertBefore(tb.columnPicker(), tools.firstChild);
    return c;
  }

  function crossModeCard(ctx) {
    const { core, mode, idx } = ctx;
    const other = mode.key === "ref" ? "disc" : "ref";
    const info = IV.stateApi.MODES[other];
    const cross = (core.cross_mode
      || {})[mode.key === "ref" ? "ref_to_disc" : "disc_to_ref"] || {};
    const j = cross[String(idx)];
    const c = U.card("The same locus in " + info.long, {
      note: mode.key === "ref"
        ? "Discovery mode may reconstruct " + mode.variantWordPlural
          + " the annotation does not have. " +
          "Comparing the two shows whether a novel model fills a real gap."
        : "Reference mode quantifies only curated entries, so the comparison tells " +
          "you what the annotation already covers.",
    });
    if (j == null) {
      c.appendChild(el("div", { class: "empty",
        text: "No matching locus in " + info.long }));
      return c;
    }
    c.appendChild(el("button", { class: "btn btn-primary",
      text: "Open in " + info.long + " →",
      onclick: function () { IV.app.openGene(j, { mode: other }); } }));
    return c;
  }

  IV.views = IV.views || {};
  IV.geneView = { openStrip: openStrip };

  IV.views.gene = { render: render, title: "Gene detail", hidden: true };
})(window.IV);
