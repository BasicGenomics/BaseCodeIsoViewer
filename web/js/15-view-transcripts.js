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
    const t = u.tx;
    const nSamples = core.samples.length;

    if (IV.geneView && IV.geneView.openStrip) {
      const strip = IV.geneView.openStrip();
      if (strip) host.appendChild(strip);
    }

    const bio = t.has("biotype") ? t.col("biotype") : null;
    const cls = t.has("class") ? t.col("class") : null;

    let sqSub = null, sqGene = null, sqTx = null;
    if (mode.key === "disc" && core.sqanti && core.sqanti.n) {
      const sq = await IV.blocks.load("disc.sqanti");
      if (sq && sq.has("id")) {
        const sqIds = sq.col("id");
        const idx = new Map();
        for (let i = 0; i < sq.n; i++) idx.set(IV.blocks.cell(sqIds, i), i);
        const txIds = t.col("id");
        const sub = sq.has("subcategory") ? sq.col("subcategory") : null;
        const ag = sq.has("associated_gene") ? sq.col("associated_gene") : null;
        const at = sq.has("associated_transcript") ? sq.col("associated_transcript") : null;
        const rowOf = function (i) { return idx.get(IV.blocks.cell(txIds, i)); };
        const cellOf = function (col) {
          return function (i) {
            const k = rowOf(i);
            return (k == null || !col) ? "" : IV.blocks.cell(col, k);
          };
        };
        if (sub) sqSub = cellOf(sub);
        if (ag) sqGene = cellOf(ag);
        if (at) sqTx = cellOf(at);
      }
    }

    const filterCard = U.card("Filter " + mode.featureWordPlural);
    const panelHost = el("div");
    filterCard.appendChild(panelHost);
    host.appendChild(filterCard);

    const summaryBar = el("div");
    host.appendChild(summaryBar);

    const toolsHost = el("span");
    const tableCard = U.card(F.pretty(mode.featureWord) + " table", {
      tools: [toolsHost,
        U.csvButton(function () { table.exportCSV("isoviewer_" + mode.key + "_transcripts.csv"); })],
    });
    const tblHost = el("div");
    tableCard.appendChild(tblHost);
    host.appendChild(tableCard);

    const ids = t.col("id"), names = t.col("name"), gi = t.col("gene_idx");
    const gNames = u.genes.col("name");
    const gChr = u.genes.has("chr") ? u.genes.col("chr") : null;
    const gIds = u.genes.col("id");
    const count = t.col("count"), share = t.col("share");
    const vmat = t.col(S.valueColumn());
    const tmat = t.has("tpm") ? t.col("tpm") : null;
    const mol = t.col("mol"), molFl = t.col("mol_fl"), read = t.col("read");
    const nex = t.col("n_exons"), len = t.col("length"), nd = t.col("n_detected");
        const supReads = t.has("sup_reads") ? t.col("sup_reads") : null;
    const supFrac = t.has("sup_frac_fl") ? t.col("sup_frac_fl") : null;
    const supGap = t.has("sup_frac_gap") ? t.col("sup_frac_gap") : null;
    const supAln = t.has("sup_mean_aligned") ? t.col("sup_mean_aligned") : null;
    const tsl = t.has("tsl") ? t.col("tsl") : null;
    const tag = t.has("tag") ? t.col("tag") : null;
    const novel = t.has("novel") ? t.col("novel") : null;

    const cols = [
      { key: "name", label: F.pretty(mode.featureWord), width: "180px",
        value: function (i) { return IV.blocks.cell(names, i); },
        render: function (i) {
          const box = el("span", {}, [
            el("span", { class: "link", text: IV.blocks.cell(names, i) }),
          ]);
          if (cls) {
            const k = IV.blocks.cell(cls, i);
            if (k && k !== "known") {
              box.appendChild(el("span", { class: "pill pill-" + k,
                style: { marginLeft: "6px" }, text: IV.pal.NOVEL_SHORT[k] || k }));
            }
          } else if (novel && novel[i]) {
            box.appendChild(el("span", { class: "pill pill-nnic", text: "Novel",
              style: { marginLeft: "6px" } }));
          }
          return box;
        } },
      { key: "id", label: F.pretty(mode.featureWord) + " ID", cls: "id",
        value: function (i) { return IV.blocks.cell(ids, i); } },
      cls ? { key: "novelty", label: "Novelty",
        value: function (i) { return IV.blocks.cell(cls, i) || ""; },
        render: function (i) {
          const k = IV.blocks.cell(cls, i);
          if (!k) return el("span", { class: "faint", text: "–" });
          if (k === "known") return el("span", { class: "small muted", text: "Known" });
          return el("span", { class: "pill pill-" + k,
            text: IV.pal.NOVEL_SHORT[k] || k });
        } } : null,
      sqSub ? { key: "sqSub", label: "Subcategory", optional: true,
        value: sqSub } : null,
      sqGene ? { key: "sqGene", label: "Associated gene", optional: true,
        cls: "id", value: sqGene } : null,
      sqTx ? { key: "sqTx", label: "Associated transcript", optional: true,
        cls: "id", value: sqTx } : null,
      { key: "gene", label: F.pretty(mode.geneWord),
        value: function (i) { return IV.blocks.cell(gNames, gi[i]); },
        render: function (i) {
          return el("span", { class: "link", text: IV.blocks.cell(gNames, gi[i]) });
        } },
      { key: "geneId", label: F.pretty(mode.geneWord) + " ID", cls: "id",
        value: function (i) { return IV.blocks.cell(gIds, gi[i]); } },
      gChr ? { key: "chr", label: "Chr",
        value: function (i) { return IV.blocks.cell(gChr, gi[i]); },
        render: function (i) {
          return el("span", { class: "small muted",
            text: IV.blocks.cell(gChr, gi[i]) });
        } } : null,
      { key: "counted", label: "Counted molecules", align: "right",
        help: S.TOTAL_COUNTED_NOTE,
        value: function (i) { return S.totalCounts(t, i); },
        render: function (i) { return F.int(Math.round(S.totalCounts(t, i))); } },
      { key: "meanMol", label: "Mean counted molecules per sample", align: "right",
        help: S.COUNTED_NOTE,
        value: function (i) { return S.meanCounts(t, i); },
        render: function (i) { return F.dec(S.meanCounts(t, i), 1); } },
      { key: "meanTpm", label: "Mean TPM per sample", align: "right",
        help: "Depth-normalised, so comparable across samples.",
        value: function (i) { return S.meanTpm(t, i) || 0; },
        render: function (i) {
          const v = S.meanTpm(t, i);
          return v == null ? "–" : F.dec(v, 2);
        } },
      { key: "share", label: "Share of gene", align: "right",
        help: "This " + mode.variantWord + "'s share of its "
          + mode.geneWord + "'s total mean TPM.",
        value: function (i) { return share[i]; },
        render: function (i) { return share[i] > 0 ? F.pct(share[i], 0) : "–"; } },
      nSamples > 1 ? { key: "spark", label: "Per sample", noSort: true,
        render: function (i) {
          const row = Array.prototype.slice.call(vmat.row(i));
          const tRow = tmat ? Array.prototype.slice.call(tmat.row(i)) : null;
          const s = IV.chart.sparkBars(row, { width: 62, height: 13 });
          const act = S.activeIdx();
          IV.chart.bindHover(s, function () {
            return IV.chart.tipHTML(IV.blocks.cell(names, i),
              act.map(function (j) {
                let v = F.mols(Math.round(row[j]), 0);
                if (tRow) v += "  ·  " + F.dec(tRow[j], 2) + " TPM";
                return [core.samples[j], v];
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
      (tsl && S.hasValues(t, "tsl")) ? { key: "tsl", label: "TSL",
        help: "Ensembl transcript support level (1 best … 5, NA).",
        value: function (i) { return IV.blocks.cell(tsl, i); },
        render: function (i) {
          const v = IV.blocks.cell(tsl, i);
          return el("span", { class: "small muted", text: v || "–" });
        } } : null,
      (tag && S.hasValues(t, "tag")) ? { key: "tag", label: "Flags",
        value: function (i) { return IV.blocks.cell(tag, i); },
        render: function (i) {
          const v = IV.blocks.cell(tag, i);
          if (!v) return el("span", { class: "faint", text: "–" });
          return el("span", { class: "chips-row" }, v.split(",").map(function (x) {
            return el("span", { class: "pill pill-flag", text: F.prettyTag(x) });
          }));
        } } : null,
      nSamples > 1 ? { key: "nd", label: "Detected in samples", align: "right",
        value: function (i) { return nd[i]; },
        render: function (i) { return nd[i] + "/" + S.nActive(); } } : null,
      (bio && S.hasBiotypes(t)) ? { key: "biotype", label: "Biotype",
        value: function (i) { return IV.blocks.cell(bio, i); },
        render: function (i) {
          return el("span", { class: "small muted",
            text: F.prettyBiotype(IV.blocks.cell(bio, i)) });
        } } : null,
      { key: "mol", label: "Detected molecules", align: "right",
        help: "Distinct molecules matched to this " + mode.featureWord +
              (mode.key === "ref"
                ? " and resolved to it uniquely."
                : ", including molecules also compatible with other models."),
        value: function (i) { return mol[i]; } },
      { key: "molFl", label: "Full-length", align: "right",
        help: "Molecules with at least one 3′ and one 5′ read observed, and what "
          + "fraction of the supporting molecules that is. Sorts on the fraction.",
        value: function (i) { return supFrac ? supFrac[i] : (mol[i] ? molFl[i] / mol[i] : 0); },
        render: function (i) {
          const v = supFrac ? supFrac[i] : (mol[i] ? molFl[i] / mol[i] : 0);
          const known = supFrac ? (supReads && supReads[i]) : mol[i];
          if (!known) return "–";
          return F.int(molFl[i]) + " (" + F.pct(v, 0) + ")";
        } },
    ].filter(Boolean);

    table = new U.Table(tblHost, {
      name: mode.key + "-transcripts",
      cols: cols, sortKey: "meanMol", sortDir: -1, total: d.txRows.length,
      onRow: function (i) { IV.app.openGene(gi[i], { focusTx: i }); },
    });
    toolsHost.appendChild(table.columnPicker());

    panel = new IV.RangePanel(panelHost, {
      level: "tx", universe: u,
      onApply: function (f) { apply(u, d, f, summaryBar, mode); },
    });
    panel.apply();
  }

  function apply(u, d, f, summaryBar, mode) {
    const S = IV.stateApi;
    const rows = S.filterTx(u, f);
    panel.setCount(F.int(rows.length) + " of " + F.int(d.txRows.length) + " in scope");
    table.setRows(rows, { total: d.txRows.length });
    const t = u.tx;
    const mol = t.col("mol"), molFl = t.col("mol_fl");
    const count = t.col("count");
    let sMol = 0, sFl = 0, sCnt = 0, quantified = 0;
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k];
      sMol += mol[i]; sFl += molFl[i];
      sCnt += S.totalCounts(t, i);
      if (count[i] > 0) quantified++;
    }
    const totalMol = (((IV.state.core.assignment || {}).stats) || {}).n_molecules || 0;
    let quantTotal = 0;
    for (let i = 0; i < t.n; i++) if (count[i] > 0) quantTotal++;
    const shownTiles = [
      { label: F.pretty(mode.featureWordPlural) + " shown", value: F.int(rows.length),
        tone: "brand", mark: d.floor > 0,
        sub: (quantTotal > 0 && rows.length <= quantTotal)
          ? F.pctOf(rows.length, quantTotal, 1) + " of "
            + F.compact(quantTotal, 2) + " quantified"
          : null,
        help: "Rows surviving the filters above, against every "
          + mode.featureWord + " with a counted value in this mode." },
      quantified < rows.length ? { mark: d.floor > 0,
        label: F.pretty(mode.featureWordPlural) + " quantified",
        value: F.int(quantified),
        sub: F.pctOf(quantified, rows.length, 1) + " of those shown · "
          + F.int(rows.length - quantified) + " detected only",
        help: F.pretty(mode.featureWordPlural) + " with a non-zero counted value.",
        meter: [
          { label: "Quantified", value: quantified,
            color: IV.dom.token("--brand") },
          { label: "Detected, not quantified", value: rows.length - quantified,
            color: IV.dom.token("--gm-300") },
        ] } : null,
    ];
    const evidenceTiles = [
      { mark: d.floor > 0,
        label: mode.key === "disc" ? "Molecule–model matches" : "Detected molecules",
        value: F.compact(sMol, 2),
        help: "Summed over the " + mode.featureWordPlural + " shown."
          + (mode.key === "disc"
              ? " Models can overlap, so a molecule compatible with several is "
                + "counted under each: these are (molecule, model) matches rather "
                + "than molecules."
              : ""),
        sub: mode.key === "disc"
          ? "counts a molecule once per model it matches"
          : (totalMol > 0
              ? F.pctOf(sMol, totalMol, 1) + " of all reconstructed molecules"
              : "sum over the rows shown") },
      { mark: d.floor > 0,
        label: "Counted molecules", value: F.compact(Math.round(sCnt), 2),
        sub: sMol ? F.pctOf(sCnt, sMol, 1) + " of detected molecules"
          : "no molecules",
        help: "Counted by IsoQuant, summed over the "
          + mode.featureWordPlural + " shown." },
      d.floor > 0 ? (function () {
        const t2 = u.tx;
        const cnt = t2.has("count") ? t2.col("count") : null;
        let below = 0;
        for (let i = 0; i < t2.n; i++) {
          if (!d.txKeep[i] && cnt && cnt[i] > 0) below++;
        }
        return { mark: true, label: "Below stringency", value: F.int(below),
          sub: "of " + F.compact(below + d.txRows.length) + " quantified "
            + mode.featureWordPlural + " · "
            + F.pctOf(below, below + d.txRows.length, 0) + " excluded",
          help: "Quantified " + mode.featureWordPlural
            + " the stringency floor excludes." };
      })() : null,
    ];
    U.tileGroups(summaryBar, [
      { label: F.pretty(mode.featureWordPlural) + " shown", items: shownTiles },
      { label: "Evidence on those " + mode.featureWordPlural,
        items: evidenceTiles },
    ]);
  }

  IV.views = IV.views || {};
  IV.views.transcripts = { render: render,
    title: function () {
      return F.pretty(IV.stateApi.modeInfo().featureWordPlural);
    } };
})(window.IV);
