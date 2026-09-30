(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;

  let table = null;
  let panel = null;

  async function render(host) {
    clear(host);
    const core = IV.state.core;
    const mode = IV.stateApi.modeInfo();
    const S = IV.stateApi;
    const u = await S.universe();
    const d = S.derive(u);
    const g = u.genes;
    const nS = IV.stateApi.nActive();

    if (IV.geneView && IV.geneView.openStrip) {
      const strip = IV.geneView.openStrip();
      if (strip) host.appendChild(strip);
    }

    const evidenceOnly = mode.key === "ref"
      ? (core.universe.ref.genes_evidence_only || 0) : 0;

    const filterCard = U.card("Filter " + mode.geneWordPlural);
    const panelHost = el("div");
    filterCard.appendChild(panelHost);
    host.appendChild(filterCard);

    const summaryBar = el("div");
    host.appendChild(summaryBar);
    IV.ui.termsPanel(host, {});

    const toolsHost = el("span");
    const tableCard = U.card(F.pretty(mode.geneWordPlural), {
      tour: "genes-table",
      tools: [
        toolsHost,
        U.csvButton(function () { table.exportCSV("isoviewer_" + mode.key + "_genes.csv"); }),
      ],
    });
    const tblHost = el("div");
    tableCard.appendChild(tblHost);
    host.appendChild(tableCard);

    const ids = g.col("id"), names = g.col("name"), chr = g.col("chr");
    const bio = g.col("biotype");
    const mol = g.col("mol"), molFl = g.col("mol_fl"), read = g.col("read");
    const vmat = g.col(S.valueColumn());
    const tmat = g.has("tpm") ? g.col("tpm") : null;
    const novel = g.has("novel") ? g.col("novel") : null;
    const isQuant = function (i) { return d.total[i] > 0; };
    const nAnn = g.has("n_annotated") ? g.col("n_annotated") : null;
    const nNic = g.has("n_nic") ? g.col("n_nic") : null;
    const nNnic = g.has("n_nnic") ? g.col("n_nnic") : null;
    const cross = (core.cross_mode
      || {})[mode.key === "ref" ? "ref_to_disc" : "disc_to_ref"] || {};

    const cols = [
      { key: "name", label: mode.key === "ref" ? "Gene" : "Locus", width: "168px",
        value: function (i) { return IV.blocks.cell(names, i); },
        render: function (i) {
          const box = el("span", {}, [
            el("span", { class: isQuant(i) ? "link" : "link faint",
              text: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i) }),
          ]);
          if (novel && novel[i]) {
            box.appendChild(el("span", { class: "pill pill-nnic", text: "Novel",
              style: { marginLeft: "6px" } }));
          }
          if (!isQuant(i)) {
            box.appendChild(el("span", { class: "pill pill-off", text: "Evidence only",
              style: { marginLeft: "6px" },
              title: "Molecules were assigned to this gene but none uniquely, so " +
                     "its quantified count is zero." }));
          }
          return box;
        } },
      { key: "id", label: "Gene ID", cls: "id",
        value: function (i) { return IV.blocks.cell(ids, i); },
        render: function (i) { return F.stripVersion(IV.blocks.cell(ids, i)); } },
      { key: "chr", label: "Chr",
        value: function (i) { return IV.blocks.cell(chr, i); },
        render: function (i) {
          return el("span", { class: "small muted", text: IV.blocks.cell(chr, i) });
        } },
      { key: "counted", label: "Counted molecules", align: "right",
        help: S.TOTAL_COUNTED_NOTE,
        value: function (i) { return S.totalCounts(g, i); },
        render: function (i) { return F.int(Math.round(S.totalCounts(g, i))); } },
      { key: "meanMol", label: "Mean counted molecules per sample", align: "right",
        help: S.COUNTED_NOTE,
        value: function (i) { return S.meanCounts(g, i); },
        render: function (i) { return F.dec(S.meanCounts(g, i), 1); } },
      { key: "meanTpm", label: "Mean TPM per sample", align: "right",
        help: "Depth-normalised, so this is comparable across samples - and is "
          + "not a molecule count.",
        value: function (i) { return S.meanTpm(g, i) || 0; },
        render: function (i) {
          const v = S.meanTpm(g, i);
          return v == null ? "–" : F.dec(v, 2);
        } },
      nS > 1 ? { key: "spark", label: "Per sample", noSort: true,
        render: function (i) {
          const row = Array.prototype.slice.call(vmat.row(i));
          const tRow = tmat ? Array.prototype.slice.call(tmat.row(i)) : null;
          const s = IV.chart.sparkBars(row, { width: 62, height: 13 });
          const act = S.activeIdx();
          IV.chart.bindHover(s, function () {
            return IV.chart.tipHTML(IV.blocks.cell(names, i),
              act.map(function (j) {
                let v = F.int(Math.round(row[j])) + " counted molecules";
                if (tRow) v += "  ·  " + F.dec(tRow[j], 2) + " TPM";
                return [core.samples[j], v];
              }));
          });
          return s;
        } } : null,
      { key: "nvar", label: "Detected " + mode.variantWordPlural, align: "right",
        help: (mode.key === "ref" && nAnn)
          ? F.pretty(mode.variantWordPlural) + " surviving stringency here, over "
            + "the count this gene has in the reference annotation. Sorts on the "
            + "detected count."
          : "Detected " + mode.variantWordPlural + " surviving stringency.",
        value: function (i) { return d.nVarDet[i]; },
        render: (mode.key === "ref" && nAnn) ? function (i) {
          return el("span", { title: "Detected / annotated "
            + mode.variantWordPlural,
            html: F.int(d.nVarDet[i])
              + '<span class="faint">/' + F.int(nAnn[i]) + "</span>" });
        } : null },
      (mode.key === "ref" && nAnn) ? { key: "nann",
        label: "Annotated " + mode.variantWordPlural,
        align: "right", optional: true,
        help: "Transcript variants this gene has in the reference annotation.",
        value: function (i) { return nAnn[i]; } } : null,
      nNnic ? { key: "novelVar", label: "Novel var.", align: "right",
        value: function (i) { return (nNic ? nNic[i] : 0) + nNnic[i]; },
        render: function (i) {
          const nic = nNic ? nNic[i] : 0;
          if (!nic && !nNnic[i]) return el("span", { class: "faint", text: "–" });
          return el("span", { class: "small", html:
            (nic ? '<span class="pill pill-nic">' + nic + " NIC</span> " : "")
            + (nNnic[i] ? '<span class="pill pill-nnic">' + nNnic[i] + " NNIC</span>" : "") });
        } } : null,
      nS > 1 ? { key: "cv", label: "CV", align: "right",
        help: "Coefficient of variation of the gene value across samples.",
        value: function (i) { return d.cv[i]; },
        render: function (i) { return F.dec(d.cv[i], 2); } } : null,
      { key: "ent", label: "Entropy", align: "right",
        help: "Normalised Shannon entropy of " + mode.variantWord
          + " usage: 0 = one dominant, " +
              "1 = perfectly even.",
        value: function (i) { return d.nVarDet[i] > 1 ? d.entropy[i] : null; },
        render: function (i) { return d.nVarDet[i] > 1 ? F.dec(d.entropy[i], 3) : "–"; } },
      nS > 1 ? { key: "jsd", label: "Mean JSD", align: "right",
        help: "Mean pairwise Jensen–Shannon divergence of "
          + mode.variantWord + " usage.",
        value: function (i) { return d.nVarDet[i] > 1 ? d.jsdMean[i] : null; },
        render: function (i) { return d.nVarDet[i] > 1 ? F.dec(d.jsdMean[i], 3) : "–"; } } : null,
      nS > 1 ? { key: "ns", label: "Detected in samples", align: "right",
        value: function (i) { return d.nDetected[i]; },
        render: function (i) { return d.nDetected[i] + "/" + nS; } } : null,
      S.hasBiotypes(g) ? { key: "bio", label: "Gene type",
        value: function (i) { return IV.blocks.cell(bio, i); },
        render: function (i) {
          return el("span", { class: "small muted",
            text: F.prettyBiotype(IV.blocks.cell(bio, i)) });
        } } : null,
      { key: "mol", label: "Detected molecules", align: "right",
        help: "Distinct reconstructed molecules assigned to this " + mode.geneWord
          + ", summed across all samples.",
        value: function (i) { return mol[i]; } },
      { key: "molFl", label: "Full-length", align: "right",
        help: "Molecules with at least one 3′ and one 5′ read observed, and what "
          + "fraction of the detected molecules that is. Sorts on the fraction.",
        value: function (i) { return mol[i] ? molFl[i] / mol[i] : 0; },
        render: function (i) {
          if (!mol[i]) return "–";
          return F.int(molFl[i]) + " (" + F.pct(molFl[i] / mol[i], 0) + ")";
        } },

      { key: "cross", label: "Also in", noSort: true,
        value: function (i) { return cross[String(i)] == null ? "" : "yes"; },
        render: function (i) { return crossCell(cross, i, mode); } },
    ].filter(Boolean);

    const prior = IV.state.explorerState;
    table = new U.Table(tblHost, {
      name: mode.key + "-genes",
      cols: cols,
      sortKey: (prior && prior.sortKey) || "meanMol",
      sortDir: (prior && prior.sortDir) || -1,
      pageSize: (prior && prior.pageSize) || 50,
      total: (d.geneRowsAll || d.geneRows).length,
      onRow: function (i) {
        saveState();
        IV.app.openGene(i);
      },
    });

    panel = new IV.RangePanel(panelHost, {
      level: "gene", universe: u,
      onApply: function (f) { apply(u, d, f, summaryBar, mode); },
    });
    let wantPage = null;
    if (prior && prior.mode === mode.key && prior.valueMode === IV.state.valueMode
        && prior.stringency === IV.state.stringency) {
      panel.restore(prior.panel);
      wantPage = prior.page;
    }
    panel.apply();
    if (wantPage) {
      table.page = wantPage;
      table.render();
    }

    function saveState() {
      IV.state.explorerState = {
        mode: mode.key, valueMode: IV.state.valueMode,
        stringency: IV.state.stringency,
        panel: panel.snapshot(),
        sortKey: table.sortKey, sortDir: table.sortDir,
        pageSize: table.pageSize, page: table.page,
      };
    }
    IV.views.genes._saveState = saveState;
    toolsHost.appendChild(table.columnPicker());
  }

  function apply(u, d, f, summaryBar, mode) {
    const S = IV.stateApi;
    const rows = S.filterGenes(u, f);
    table.setRows(rows, { total: (d.geneRowsAll || d.geneRows).length });
    panel.setCount(F.int(rows.length) + " of " + F.int(d.geneRows.length) + " in scope");

    const g = u.genes;
    const mol = g.col("mol"), molFl = g.col("mol_fl");
    let sMol = 0, sFl = 0, multi = 0, sCnt = 0;
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k];
      sMol += mol[i]; sFl += molFl[i];
      sCnt += S.totalCounts(g, i);
      if (d.nVarDet[i] > 1) multi++;
    }
    const totalMol = IV.state.core.assignment.stats.n_molecules;

    const quantTotal = (function () {
      let n = 0;
      for (let i = 0; i < g.n; i++) if (d.total[i] > 0) n++;
      return n;
    })();
    function evidenceShown() {
      let n = 0;
      for (let k = 0; k < rows.length; k++) if (!(d.total[rows[k]] > 0)) n++;
      return n;
    }
    const shownTiles = [
      { label: F.pretty(mode.geneWordPlural) + " shown", value: F.int(rows.length),
        tone: "brand", mark: d.floor > 0,
        sub: (quantTotal > 0 && rows.length <= quantTotal)
          ? F.pctOf(rows.length, quantTotal, 1) + " of "
            + F.compact(quantTotal, 2) + " quantified"
          : null,
        help: "Rows surviving the filters above, against every "
          + mode.geneWord + " with a counted value in this mode." },
      evidenceShown() > 0 ? (function () {
        const q = Math.max(0, rows.length - evidenceShown());
        return {
          mark: d.floor > 0,
          label: F.pretty(mode.geneWordPlural) + " quantified",
          value: F.int(q),
          sub: F.pctOf(q, rows.length, 1) + " of those shown · "
            + F.int(evidenceShown()) + " detected only",
          help: F.pretty(mode.geneWordPlural) + " with a non-zero counted value.",
          meter: [
            { label: "Quantified", value: q, color: IV.dom.token("--brand") },
            { label: "Detected, not quantified", value: evidenceShown(),
              color: IV.dom.token("--gm-300") },
          ] };
      })() : null,
    ];
    const evidenceTiles = [
      { mark: d.floor > 0,
        label: mode.key === "disc" ? "Molecule–model matches" : "Detected molecules",
        value: F.compact(sMol, 2),
        sub: mode.key === "disc"
          ? "counts a molecule once per " + mode.geneWord + " it matches"
          : F.pctOf(sMol, totalMol, 1) + " of all reconstructed molecules",
        help: "Summed over the " + mode.geneWordPlural + " shown."
          + (mode.key === "disc"
              ? " Gene models can overlap, so this counts (molecule, "
                + mode.geneWord + ") matches rather than molecules - 573,656 "
                + "against 570,614 molecules that matched anything on the test "
                + "run."
              : "") },
      { mark: d.floor > 0,
        label: "Counted molecules", value: F.compact(Math.round(sCnt), 2),
        sub: F.pctOf(sCnt, sMol, 1)
          + (mode.key === "disc" ? " of those matches" : " of detected molecules"),
        help: "Counted by IsoQuant, summed over the "
          + mode.geneWordPlural + " shown." },
      { mark: d.floor > 0,
        label: "Multi-" + mode.variantWord, value: F.int(multi),
        sub: F.pctOf(multi, rows.length, 0) + " of the "
          + mode.geneWordPlural + " shown" },
      d.floor > 0 ? (function () {
        let below = 0;
        for (let i = 0; i < g.n; i++) if (d.total[i] > 0 && !d.keep[i]) below++;
        return { mark: true, label: "Below stringency", value: F.int(below),
          sub: "of " + F.compact(below + d.geneRows.length) + " quantified "
            + mode.geneWordPlural + " · "
            + F.pctOf(below, below + d.geneRows.length, 0) + " excluded",
          help: "Quantified " + mode.geneWordPlural
            + " the stringency floor excludes." };
      })() : null,
    ];
    U.tileGroups(summaryBar, [
      { label: F.pretty(mode.geneWordPlural) + " shown", items: shownTiles },
      { label: "Evidence on those " + mode.geneWordPlural, items: evidenceTiles },
    ]);
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
      if (IV.views.genes._saveState) IV.views.genes._saveState();
      IV.app.openGene(j, { mode: other });
    });
    return b;
  }

  IV.views = IV.views || {};
  IV.views.genes = { render: render, title: "Genes" };
})(window.IV);
