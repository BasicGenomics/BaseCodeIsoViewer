(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;

  let level = "gene";
  let lfcThresh = 1;
  let minEvidence = 10;
  let result = null;
  let basis = "tpm";

  function basisColumn() { return basis === "tpm" ? "tpm" : "counts"; }
  function basisLabel() { return basis === "tpm" ? "TPM" : "molecules"; }

  function groupColor(which) {
    return IV.pal.rampSeries(which === "B" ? 1 : 0, 2);
  }

  function lowerFirst(str) {
    const t = String(str || "");
    return t.charAt(0).toLowerCase() + t.slice(1);
  }

  async function render(host) {
    clear(host);
    const core = IV.state.core;
    if (core.samples.length < 2) {
      host.appendChild(el("div", { class: "empty",
        text: "Group comparison needs at least two samples." }));
      return;
    }
    if (!IV.state.group.length) {
      IV.state.group = core.samples.map(function (_, i) {
        return core.samples.length === 2 ? (i === 0 ? 1 : 2) : 0;
      });
    }

    host.appendChild(U.callout(
      "<strong>Descriptive comparison, not a statistical test.</strong> These are " +
      "mean differences and usage divergences: no p-values, no dispersion " +
      "estimate, no multiple-testing correction. Use them to build a shortlist.",
      "warn"));

    host.appendChild(groupCard(core, host));
    const resultsHost = el("div");
    host.appendChild(resultsHost);
    if (result) renderResults(resultsHost, core);
  }

  function groupCard(core, host) {
    const c = U.card("Define groups", {
      note: "<em>Click a sample once for group <strong>A</strong>, again for "
        + "<strong>B</strong>, a third time to leave it out.</em>",
    });
    const chips = el("div", { class: "chips" });
    core.samples.forEach(function (s, i) {
      const g = IV.state.group[i];
      const chip = el("button", {
        class: "chip" + (g === 1 ? " grp-a" : g === 2 ? " grp-b" : ""),
        "aria-pressed": String(g > 0),
      }, [
        el("span", { class: "swatch", style: { background: g === 1
          ? IV.dom.token("--brand") : g === 2 ? IV.dom.token("--accent")
          : IV.dom.token("--border-strong") } }),
        el("span", { text: s }),
        el("span", { class: "xsmall faint", text: g === 1 ? "A" : g === 2 ? "B" : "-" }),
      ]);
      chip.addEventListener("click", function () {
        IV.state.group[i] = (IV.state.group[i] + 1) % 3;
        IV.app.rerender();
      });
      chips.appendChild(chip);
    });
    c.appendChild(chips);

    const a = IV.state.group.filter(function (x) { return x === 1; }).length;
    const b = IV.state.group.filter(function (x) { return x === 2; }).length;

    const row = el("div", { class: "control-row", style: { marginTop: "var(--sp-3)" } });
    row.appendChild(U.control("Feature level",
      U.seg([{ label: "Gene", value: "gene" },
             { label: F.pretty(IV.stateApi.modeInfo().featureWord),
               value: "tx" }], level,
        function (v) { level = v; result = null; IV.app.rerender(); })));

    const uni = IV.state.loaded && IV.state.loaded[IV.state.mode];
    const frameForTpm = uni ? (level === "tx" ? uni.tx : uni.genes) : null;
    if (frameForTpm && frameForTpm.has("tpm")) {
      row.appendChild(U.control("Values",
        U.seg([{ label: "TPM", value: "tpm",
                 help: "Depth-normalised, so groups sequenced to different "
                   + "depths are comparable. The right default for a group "
                   + "comparison." },
               { label: "Molecules", value: "counts",
                 help: "Molecules as measured - NOT "
                   + "depth-normalised, so part of any fold change is the "
                   + "difference in sequencing depth between the groups." }], basis,
          function (v) { basis = v; result = null; IV.app.rerender(); },
          { label: "Values", accent: basis === "counts" })));
    }

    const btn = el("button", { class: "btn btn-primary",
      text: "Compare A vs B", disabled: !(a && b) });
    btn.addEventListener("click", async function () {
      result = await compute(core);
      IV.app.rerender();
    });
    row.appendChild(el("div", {}, btn));
    row.appendChild(el("span", { class: "control-hint",
      text: a && b
        ? a + " sample" + (a === 1 ? "" : "s") + " in A, "
          + b + " in B"
        : "Assign at least one sample to each group" }));
    c.appendChild(row);
    return c;
  }

  async function compute(core) {
    const u = await IV.stateApi.universe();
    const frame = level === "gene" ? u.genes : u.tx;
    const A = [], B = [];
    IV.state.group.forEach(function (g, i) {
      if (g === 1) A.push(i); else if (g === 2) B.push(i);
    });
    const tpm = frame.col(basisColumn());
    const mol = frame.col("mol");
    const ids = frame.col("id"), names = frame.col("name");
    const n = frame.n;

    const meanA = new Float64Array(n), meanB = new Float64Array(n);
    const lfc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sa = 0, sb = 0;
      for (const j of A) sa += tpm.get(i, j);
      for (const j of B) sb += tpm.get(i, j);
      meanA[i] = sa / A.length;
      meanB[i] = sb / B.length;
      lfc[i] = IV.stat.log2((meanA[i] + 1) / (meanB[i] + 1));
    }

    let jsd = null, entA = null, entB = null, geneIdxOf = null;
    if (level === "gene") {
      jsd = new Float64Array(n);
      entA = new Float64Array(n);
      entB = new Float64Array(n);
      const off = u.genes.col("tx_off"), cnt = u.genes.col("tx_n");
      const txTpm = u.tx.col(basisColumn());
      const normEnt = function (p, sum, k) {
        let h = 0, nz = 0;
        for (let x = 0; x < k; x++) {
          const q = p[x] / sum;
          if (q > 0) { h -= q * IV.stat.log2(q); nz++; }
        }
        return nz > 1 ? h / IV.stat.log2(nz) : 0;
      };
      for (let g = 0; g < n; g++) {
        const k = cnt[g];
        if (k < 2) continue;
        const pa = new Float64Array(k), pb = new Float64Array(k);
        let sa = 0, sb = 0;
        for (let x = 0; x < k; x++) {
          let va = 0, vb = 0;
          for (const j of A) va += txTpm.get(off[g] + x, j);
          for (const j of B) vb += txTpm.get(off[g] + x, j);
          pa[x] = va / A.length; pb[x] = vb / B.length;
          sa += pa[x]; sb += pb[x];
        }
        if (sa > 0) entA[g] = normEnt(pa, sa, k);
        if (sb > 0) entB[g] = normEnt(pb, sb, k);
        if (sa <= 0 || sb <= 0) continue;
        let acc = 0;
        for (let x = 0; x < k; x++) {
          const p = pa[x] / sa, q = pb[x] / sb, m = 0.5 * (p + q);
          if (p > 0) acc += 0.5 * p * IV.stat.log2(p / m);
          if (q > 0) acc += 0.5 * q * IV.stat.log2(q / m);
        }
        jsd[g] = Math.max(0, Math.min(1, acc));
      }
    } else {
      geneIdxOf = u.tx.col("gene_idx");
    }

    const molS = frame.has("mol_s") ? frame.col("mol_s") : null;
    const molFlS = frame.has("mol_fl_s") ? frame.col("mol_fl_s") : null;
    const cntS = frame.has("counts") ? frame.col("counts") : null;
    const tpmS = frame.has("tpm") ? frame.col("tpm") : null;
    const perGroup = function (m, idx, i) {
      if (!m) return null;
      let t = 0;
      for (const j of idx) t += m.get(i, j);
      return t;
    };

    const cntA = new Float64Array(n), cntB = new Float64Array(n);
    const tpmA = new Float64Array(n), tpmB = new Float64Array(n);
    if (cntS) {
      for (let i = 0; i < n; i++) {
        let a = 0, b = 0;
        for (const j of A) a += cntS.get(i, j);
        for (const j of B) b += cntS.get(i, j);
        cntA[i] = a; cntB[i] = b;
      }
    }
    if (tpmS) {
      for (let i = 0; i < n; i++) {
        let a = 0, b = 0;
        for (const j of A) a += tpmS.get(i, j);
        for (const j of B) b += tpmS.get(i, j);
        tpmA[i] = A.length ? a / A.length : 0;
        tpmB[i] = B.length ? b / B.length : 0;
      }
    }
    const evA = basis === "tpm" ? tpmA : cntA;
    const evB = basis === "tpm" ? tpmB : cntB;

    const d = IV.stateApi.derive(u);
    const nVarDet = level === "gene" ? d.nVarDet : null;
    const nAnn = (level === "gene" && u.genes.has("n_annotated"))
      ? u.genes.col("n_annotated") : null;

    return { u: u, frame: frame, A: A, B: B, meanA: meanA, meanB: meanB,
             lfc: lfc, jsd: jsd, entA: entA, entB: entB,
             mol: mol, ids: ids, names: names,
             molS: molS, molFlS: molFlS, perGroup: perGroup,
             cntA: cntA, cntB: cntB, tpmA: tpmA, tpmB: tpmB,
             evA: evA, evB: evB,
             nVarDet: nVarDet, nAnn: nAnn,
             geneIdxOf: geneIdxOf, n: n, level: level };
  }

  let heatRows = 60;

  function heatCard(r, usable, word, mode, core) {
    const c = U.card("Top differences per sample", {
      note: "Top |log₂FC| features, log₂(" + basisLabel() + " + 1), row-centred. "
        + "<em>Click a row label to open its "
        + F.escapeHtml(mode.geneWord) + ".</em>",
    });
    const ranked = usable.slice().sort(function (x, y) {
      return Math.abs(r.lfc[y]) - Math.abs(r.lfc[x]);
    });
    if (ranked.length < 2) {
      c.appendChild(el("div", { class: "empty", text: "Not enough features." }));
      return c;
    }
    const cols = r.A.concat(r.B);
    const nCol = cols.length;
    const vm = r.frame.col(basisColumn());
    const gi = r.level === "gene" ? null : r.geneIdxOf;

    const cap = Math.min(500, ranked.length);
    const lo = Math.min(10, cap);
    heatRows = Math.max(lo, Math.min(heatRows, cap));
    const slider = el("input", { type: "range", min: lo, max: cap, step: 10,
      value: heatRows, style: { width: "160px" } });
    const lbl = el("span", { class: "control-hint" });
    const row = el("div", { class: "plot-controls" });
    row.appendChild(U.control("Rows shown", slider));
    row.appendChild(lbl);
    c.appendChild(row);
    const holder = el("div");
    c.appendChild(holder);

    function draw() {
      clear(holder);
      const k = Math.max(1, Math.min(heatRows, ranked.length));
      lbl.textContent = k + " features · " + r.A.length + " in A, "
        + r.B.length + " in B";
      const feat = ranked.slice(0, k);

      const Z = [];
      for (const i of feat) {
        const v = new Float64Array(nCol);
        let mu = 0;
        for (let j = 0; j < nCol; j++) {
          v[j] = IV.stat.log2(vm.get(i, cols[j]) + 1);
          mu += v[j];
        }
        mu /= nCol;
        for (let j = 0; j < nCol; j++) v[j] -= mu;
        Z.push(v);
      }
      const rowOrder = clusterOrder(Z, nCol);
      let maxAbs = 0;
      for (const v of Z) for (const x of v) {
        if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x);
      }
      if (!maxAbs) maxAbs = 1;

      IV.chart.heatmap(holder, {
        exportName: "group-differences",
        rows: rowOrder.map(function (rr) {
          return IV.blocks.cell(r.names, feat[rr]);
        }),
        cols: cols.map(function (j) { return IV.state.sampleLabels.labels[j]; }),
        aliasKey: IV.stateApi.sampleAliasKey(cols),
        colBand: cols.map(function (j, x) {
          const g = x < r.A.length ? "A" : "B";
          return { color: groupColor(g), label: "Group " + g };
        }),
        cellW: Math.max(30, Math.min(64, 420 / nCol)),
        cellH: Math.max(2.4, Math.min(16, 2400 / rowOrder.length)),
        labelW: 196, headH: nCol > 6 ? 62 : 32, alwaysLabelRows: true,
        get: function (rr, cc) { return Z[rowOrder[rr]][cc]; },
        scale: function (v) { return IV.pal.diverging(v / maxAbs); },
        tip: function (rr, cc) {
          const i = feat[rowOrder[rr]];
          return IV.chart.tipHTML(IV.blocks.cell(r.names, i), [
            ["Sample", IV.stateApi.sampleTipName(cc)],
            ["Group", cc < r.A.length ? "A" : "B"],
            ["Row-centred log₂", F.dec(Z[rowOrder[rr]][cc], 3)],
            [basisLabel(), IV.stateApi.fmtValue(vm.get(i, cols[cc]))],
            ["log₂ FC (A / B)", F.dec(r.lfc[i], 3)],
          ]);
        },
        onPickRow: function (rr) {
          const i = feat[rowOrder[rr]];
          IV.app.openGene(r.level === "gene" ? i : gi[i],
            r.level === "gene" ? {} : { focusTx: i });
        },
      });
      IV.chart.colorBar(holder, {
        title: "Row-centred log₂",
        colorAt: function (t) { return IV.pal.diverging(t * 2 - 1); },
        ticks: [{ at: 0, label: "−" + F.dec(maxAbs, 1) },
                { at: 0.5, label: "0" },
                { at: 1, label: "+" + F.dec(maxAbs, 1) }],
      });
      holder.appendChild(IV.chart.legend([
        { label: "Group A (" + r.A.length
            + (r.A.length === 1 ? " sample)" : " samples)"),
          color: groupColor("A") },
        { label: "Group B (" + r.B.length
            + (r.B.length === 1 ? " sample)" : " samples)"),
          color: groupColor("B") },
      ]));
    }
    slider.addEventListener("input", IV.dom.debounce(function () {
      const v = parseInt(slider.value, 10);
      if (isFinite(v) && v > 0) heatRows = Math.min(v, cap);
      draw();
    }, 180));
    draw();
    return c;
  }

  function clusterOrder(vectors, dim) {
    const n = vectors.length;
    if (n < 3) return vectors.map(function (_, i) { return i; });
    const cent = vectors.map(function (v) {
      let mu = 0;
      for (let j = 0; j < dim; j++) mu += v[j];
      mu /= dim;
      const cv = new Float64Array(dim);
      let ss = 0;
      for (let j = 0; j < dim; j++) { cv[j] = v[j] - mu; ss += cv[j] * cv[j]; }
      return { v: cv, norm: Math.sqrt(ss) };
    });
    const corr = function (a, b) {
      if (!cent[a].norm || !cent[b].norm) return 0;
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += cent[a].v[j] * cent[b].v[j];
      return dot / (cent[a].norm * cent[b].norm);
    };
    const used = new Uint8Array(n);
    const order = [0];
    used[0] = 1;
    for (let step = 1; step < n; step++) {
      const last = order[order.length - 1];
      let best = -1, bestC = -Infinity;
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const cc = corr(last, j);
        if (cc > bestC) { bestC = cc; best = j; }
      }
      if (best < 0) break;
      used[best] = 1;
      order.push(best);
    }
    for (let j = 0; j < n; j++) if (!used[j]) order.push(j);
    return order;
  }

  function renderResults(host, core) {
    clear(host);
    const r = result;
    const mode = IV.stateApi.modeInfo();
    const word = r.level === "gene" ? mode.geneWord : mode.featureWord;

    const isTpm = basis === "tpm";
    const evLabel = isTpm ? "Minimum mean TPM" : "Minimum counted molecules";
    const evPopulation = isTpm ? "with TPM" : "with counted molecules";
    const tc = U.card(null);
    const eSlider = el("input", { type: "range", min: 0,
      max: isTpm ? 100 : 200, step: isTpm ? 1 : 5,
      value: Math.min(minEvidence, isTpm ? 100 : 200), style: { width: "170px" } });
    const eNum = el("input", { type: "number", min: 0, step: 1, value: minEvidence,
      style: { width: "70px" } });
    const slider = el("input", { type: "range", min: 0, max: 5, step: 0.25,
      value: lfcThresh, style: { width: "170px" } });
    const num = el("input", { type: "number", min: 0, step: 0.25, value: lfcThresh,
      style: { width: "70px" } });
    function sync(v) {
      lfcThresh = Math.max(0, v);
      slider.value = lfcThresh; num.value = lfcThresh;
      renderResults(host, core);
    }
    function syncEv(v) {
      minEvidence = Math.max(0, isFinite(v) ? v : 0);
      renderResults(host, core);
    }
    slider.addEventListener("input", function () { sync(parseFloat(slider.value)); });
    num.addEventListener("change", function () { sync(parseFloat(num.value) || 0); });
    eSlider.addEventListener("input", IV.dom.debounce(function () {
      syncEv(parseFloat(eSlider.value));
    }, 200));
    eNum.addEventListener("change", function () { syncEv(parseFloat(eNum.value) || 0); });
    tc.appendChild(el("div", { class: "control-row", style: { marginBottom: "0" } }, [
      U.control(evLabel,
        el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          [eSlider, eNum]),
        "Features below this in both groups are not compared."),
      U.control("|log₂ fold change| threshold",
        el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
          [slider, num]),
        "Descriptive cut-off for the counts below."),
    ]));
    host.appendChild(tc);

    const evOf = function (i) {
      return Math.max(r.evA ? r.evA[i] : 0, r.evB ? r.evB[i] : 0);
    };
    const usable = [];
    let present = 0;
    for (let i = 0; i < r.n; i++) {
      const has = r.meanA[i] > 0 || r.meanB[i] > 0;
      if (has) present++;
      if (has && evOf(i) >= minEvidence) usable.push(i);
    }

    const up = usable.filter(function (i) { return r.lfc[i] >= lfcThresh; }).length;
    const down = usable.filter(function (i) { return r.lfc[i] <= -lfcThresh; }).length;

    const box = el("div");
    U.tiles(box, [
      { label: F.pretty(word) + "s compared", value: F.int(usable.length), tone: "brand",
        sub: "of " + F.int(present) + " " + evPopulation + " · "
          + F.escapeHtml(lowerFirst(evLabel))
          + " " + F.dec(minEvidence, isTpm ? 1 : 0),
        help: "Features passing the evidence threshold in at least one group, out "
          + "of those carrying " + evPopulation.replace("with ", "")
          + " at all." },
      { label: "Higher in A", value: F.int(up) },
      { label: "Higher in B", value: F.int(down) },
    ].filter(Boolean));
    host.appendChild(box);

    host.appendChild(scatterCard(r, usable, word, mode));
    if (r.jsd) host.appendChild(usageRow(r, usable, word, mode, core));
    host.appendChild(heatCard(r, usable, word, mode, core));
    host.appendChild(tableCard(r, usable, word, mode, core));
  }

  function scatterCard(r, usable, word, mode) {
    const c = U.card("Group means", {
      note: "Group A against group B, log scale, one point per " + word
        + ". <em>Hover for its numbers, click to open it.</em>",
    });
    const holder = el("div", { class: "chart" });
    const maxAbs = Math.max(1, lfcThresh * 3);
    const unit = IV.stateApi.valueLabel();

    const nA = r.A.length, nB = r.B.length;
    const groupRows = function (i) { return groupRowsOf(r, i); };

    let drew = false;
    if (IV.px && IV.px.available()) {
      const xs = [], ys = [], cols = [], hov = [];
      let hi = 1;
      for (let k = 0; k < usable.length; k++) {
        const i = usable[k];
        const xv = r.meanB[i] + 1, yv = r.meanA[i] + 1;
        xs.push(xv); ys.push(yv);
        if (xv > hi) hi = xv;
        if (yv > hi) hi = yv;
        cols.push(IV.pal.diverging(r.lfc[i] / maxAbs));
        hov.push(IV.px.rowsToHover(IV.blocks.cell(r.names, i), groupRows(i)));
      }
      drew = IV.px.points(holder, {
        x: xs, y: ys, hover: hov, color: cols,
      }, {
        height: 340,
        xTitle: "Mean " + unit + " + 1 in B (log)",
        yTitle: "Mean " + unit + " + 1 in A (log)",
        exportName: "group-means",
        xaxis: { type: "log", tickformat: ".2s", constrain: "domain" },
        yaxis: { type: "log", tickformat: ".2s",
                 scaleanchor: "x", scaleratio: 1 },
        shapes: [{
          type: "line", xref: "x", yref: "y",
          x0: 1, y0: 1, x1: hi, y1: hi,
          line: { color: IV.dom.token("--ink-faint"), width: 1, dash: "dot" },
          layer: "below",
        }],
        onPick: function (k) {
          const i = usable[k];
          IV.app.openGene(r.level === "gene" ? i : r.geneIdxOf[i],
            r.level === "gene" ? {} : { focusTx: i });
        },
      });
    }
    if (!drew) {
      IV.chart.scatter(holder, {
        n: usable.length,
        x: function (k) { return Math.log10(r.meanB[usable[k]] + 1); },
        y: function (k) { return Math.log10(r.meanA[usable[k]] + 1); },
        color: function (k) {
          return IV.pal.diverging(r.lfc[usable[k]] / maxAbs);
        },
        tip: function (k) {
          const i = usable[k];
          return IV.chart.tipHTML(IV.blocks.cell(r.names, i), groupRows(i));
        },
      }, {
        height: 340, xTitle: "Mean " + unit + " in B (log₁₀)",
        yTitle: "Mean " + unit + " in A (log₁₀)",
        xKind: "log1p", yKind: "log1p", xGrid: true,
        onPick: function (k) {
          const i = usable[k];
          IV.app.openGene(r.level === "gene" ? i : r.geneIdxOf[i],
            r.level === "gene" ? {} : { focusTx: i });
        },
      });
    }
    c.appendChild(holder);
    c.appendChild(IV.chart.legend([
      { label: "Higher in B", color: IV.pal.diverging(-1) },
      { label: "No difference", color: IV.pal.diverging(0) },
      { label: "Higher in A", color: IV.pal.diverging(1) },
    ]));
    return c;
  }

  const usageView = { jsd: "bar" };

  function usageRow(r, usable, word, mode, core) {
    const wrap = el("div", { class: "plots-2col equal-cols" });
    const ent = entropyCard(r, usable, word, mode);
    const jsd = jsdCard(r, usable, word, mode);
    wrap.appendChild(ent);
    wrap.appendChild(jsd);
    alignPlotControls([ent, jsd]);
    return wrap;
  }

  function alignPlotControls(cards) {
    const has = cards.map(function (c) {
      return !!(c && c.querySelector && c.querySelector(".plot-controls"));
    });
    if (has.every(Boolean) || !has.some(Boolean)) return;
    cards.forEach(function (c, i) {
      if (has[i] || !c) return;
      const spacer = el("div", { class: "plot-controls", "aria-hidden": "true" });
      const note = c.noteEl;
      if (note && note.nextSibling) c.insertBefore(spacer, note.nextSibling);
      else if (note) c.appendChild(spacer);
      else c.insertBefore(spacer, c.firstChild);
    });
  }

  function entropyCard(r, usable, word, mode) {
    const c = U.card(F.pretty(mode.variantWord)
      + " usage entropy between groups", {
      note: "Normalised <strong>Shannon entropy</strong> of " + mode.variantWord
        + " usage in each group. <strong>0</strong> = one dominant "
        + mode.variantWord + ", <strong>1</strong> = "
        + "all used evenly. Off the diagonal means the usage got broader or "
        + "narrower between the groups.",
    });
    if (!r.entA) {
      c.appendChild(el("div", { class: "empty",
        text: "Entropy needs gene-level " + mode.variantWordPlural + "." }));
      return c;
    }
    const rows = usable.filter(function (i) {
      return (r.nVarDet ? r.nVarDet[i] > 1 : true)
        && (r.entA[i] > 0 || r.entB[i] > 0);
    });
    if (!rows.length) {
      c.appendChild(el("div", { class: "empty",
        text: "No " + mode.geneWordPlural + " with several "
          + mode.variantWordPlural + " and usage in both groups." }));
      return c;
    }
    const holder = el("div", { class: "chart" });
    const xs = [], ys = [], hov = [], cols = [];
    const maxAbs = Math.max(1, lfcThresh * 3);
    for (const i of rows) {
      xs.push(r.entB[i]);
      ys.push(r.entA[i]);
      cols.push(IV.pal.diverging(r.lfc[i] / maxAbs));
      hov.push(IV.px && IV.px.available()
        ? IV.px.rowsToHover(IV.blocks.cell(r.names, i), groupRowsOf(r, i))
        : "");
    }
    let drew = false;
    if (IV.px && IV.px.available()) {
      drew = IV.px.points(holder, { x: xs, y: ys, hover: hov, color: cols }, {
        height: 300, markerSize: 5,
        xTitle: "Entropy in B", yTitle: "Entropy in A",
        exportName: "group-entropy",
        xaxis: { range: [-0.03, 1.03], dtick: 0.2 },
        yaxis: { range: [-0.03, 1.03], dtick: 0.2 },
        shapes: [{ type: "line", xref: "x", yref: "y",
          x0: 0, y0: 0, x1: 1, y1: 1,
          line: { color: IV.dom.token("--ink-faint"), width: 1, dash: "dot" },
          layer: "below" }],
        onPick: function (k) {
          const i = rows[k];
          IV.app.openGene(r.level === "gene" ? i : r.geneIdxOf[i],
            r.level === "gene" ? {} : { focusTx: i });
        },
      });
    }
    if (!drew) {
      IV.chart.scatter(holder, {
        n: rows.length,
        x: function (k) { return r.entB[rows[k]]; },
        y: function (k) { return r.entA[rows[k]]; },
        color: function (k) { return cols[k]; },
        tip: function (k) {
          return IV.chart.tipHTML(IV.blocks.cell(r.names, rows[k]),
            groupRowsOf(r, rows[k]));
        },
      }, { height: 300, xTitle: "Entropy in B", yTitle: "Entropy in A",
           xDomain: [0, 1.03], yDomain: [0, 1.03] });
    }
    c.appendChild(holder);
    return c;
  }

  function jsdCard(r, usable, word, mode) {
    const rows = usable.filter(function (i) { return r.jsd[i] > 0; });
    const c = U.card(F.pretty(mode.variantWord)
      + " usage divergence between groups", {
      note: "<strong>Jensen-Shannon divergence</strong> of " + mode.variantWord
        + " usage between "
        + "the two groups. <strong>0</strong> means both groups use this "
        + mode.geneWord + "'s " + mode.variantWordPlural
        + " in the same proportions; <strong>1</strong> "
        + "means they use different ones entirely. <em>Each point is one "
        + mode.geneWord + " - hover for its numbers, click to open it.</em>",
    });
    if (!rows.length) {
      c.appendChild(el("div", { class: "empty",
        text: "No " + mode.geneWordPlural + " with several "
          + mode.variantWordPlural
          + " with evidence in both groups." }));
      return c;
    }
    const holder = el("div", { class: "chart" });

    const geneOf = function (i) {
      return r.level === "gene" ? i : r.geneIdxOf[i];
    };

    function draw() {
      IV.dom.clear(holder);
      const xs = [], ys = [], cols = [], hov = [], idx = [];
      const maxAbs = Math.max(1, lfcThresh * 3);
      for (const i of rows) {
        if (!(r.jsd[i] > 0)) continue;
        xs.push(r.lfc[i]);
        ys.push(r.jsd[i]);
        cols.push(IV.pal.diverging(r.lfc[i] / maxAbs));
        hov.push(IV.px && IV.px.available()
          ? IV.px.rowsToHover(IV.blocks.cell(r.names, i), groupRowsOf(r, i))
          : "");
        idx.push(i);
      }
      let drew = false;
      if (IV.px && IV.px.available()) {
        drew = IV.px.points(holder, { x: xs, y: ys, hover: hov, color: cols }, {
          height: 300, markerSize: 5,
          xTitle: "log₂ fold change, A over B",
          yTitle: "Usage JSD",
          exportName: "group-jsd-vs-lfc",
          yaxis: { range: [-0.03, 1.03], dtick: 0.2 },
          shapes: [
            { type: "line", xref: "x", yref: "paper",
              x0: lfcThresh, y0: 0, x1: lfcThresh, y1: 1,
              line: { color: IV.dom.token("--ink-faint"), width: 1, dash: "dot" },
              layer: "below" },
            { type: "line", xref: "x", yref: "paper",
              x0: -lfcThresh, y0: 0, x1: -lfcThresh, y1: 1,
              line: { color: IV.dom.token("--ink-faint"), width: 1, dash: "dot" },
              layer: "below" },
          ],
          onPick: function (k) { IV.app.openGene(geneOf(idx[k])); },
        });
      }
      if (!drew) {
        IV.chart.scatter(holder, {
          n: xs.length,
          x: function (k) { return xs[k]; },
          y: function (k) { return ys[k]; },
          color: function (k) { return cols[k]; },
          tip: function (k) {
            return IV.chart.tipHTML(IV.blocks.cell(r.names, idx[k]),
              groupRowsOf(r, idx[k]));
          },
        }, { height: 300, xTitle: "log₂ fold change, A over B",
             yTitle: "Usage JSD", yDomain: [0, 1.03],
             onPick: function (k) { IV.app.openGene(geneOf(idx[k])); } });
      }
    }
    c.appendChild(holder);
    draw();
    return c;
  }

  function groupRowsOf(r, i) {
    const nA = r.A.length, nB = r.B.length;
    const rows = [["A", "B"]];

    const dA = r.perGroup(r.molS, r.A, i), dB = r.perGroup(r.molS, r.B, i);
    if (dA != null) rows.push(["Detected molecules", F.int(dA), F.int(dB)]);
    else rows.push(["Detected molecules", F.int(r.mol[i])]);

    const fA = r.perGroup(r.molFlS, r.A, i), fB = r.perGroup(r.molFlS, r.B, i);
    if (fA != null) {
      rows.push(["Full-length molecules",
        F.int(fA) + (dA ? " (" + F.pctOf(fA, dA, 0) + ")" : ""),
        F.int(fB) + (dB ? " (" + F.pctOf(fB, dB, 0) + ")" : "")]);
    }
    if (r.cntA) {
      rows.push(["Molecules",
        F.int(Math.round(r.cntA[i])), F.int(Math.round(r.cntB[i]))]);
      rows.push(["Mean molecules per sample",
        F.dec(nA ? r.cntA[i] / nA : 0, 1), F.dec(nB ? r.cntB[i] / nB : 0, 1)]);
    }
    if (r.tpmA) {
      rows.push(["Mean TPM per sample", F.dec(r.tpmA[i], 2), F.dec(r.tpmB[i], 2)]);
    }

    const vwc = IV.stateApi.modeInfo();
    if (r.nAnn) {
      rows.push(["Annotated " + vwc.variantWordPlural, F.int(r.nAnn[i])]);
    }
    if (r.nVarDet) {
      rows.push(["Detected " + vwc.variantWordPlural, F.int(r.nVarDet[i])]);
    }

    rows.push(["log₂ FC (A / B)", F.dec(r.lfc[i], 3)]);
    if (r.entA) {
      rows.push([F.pretty(IV.stateApi.modeInfo().variantWord) + " usage entropy",
        F.dec(r.entA[i], 3), F.dec(r.entB[i], 3)]);
    }
    if (r.jsd) rows.push(["Usage JSD (A vs B)", F.dec(r.jsd[i], 3)]);
    return rows;
  }

  function tableCard(r, usable, word, mode, core) {
    const toolsHost = el("span");
    const nA = r.A.length, nB = r.B.length;
    const c = U.card("Results", {
      tools: [toolsHost,
        U.csvButton(function () { table.exportCSV("isoviewer_compare_" + r.level + ".csv"); })],
    });
    const tpm = r.frame.col(basisColumn());
    const cols = [
      { key: "name", label: F.pretty(word),
        value: function (i) { return IV.blocks.cell(r.names, i); },
        render: function (i) {
          return el("span", { class: "link", text: IV.blocks.cell(r.names, i) });
        } },
      { key: "id", label: (r.level === "gene" ? "Gene" : F.pretty(mode.featureWord)) + " ID", cls: "id",
        value: function (i) { return IV.blocks.cell(r.ids, i); } },
      { key: "cntA", label: "Molecules, A", align: "right",
        value: function (i) { return r.cntA ? r.cntA[i] : 0; },
        render: function (i) {
          return r.cntA ? F.int(Math.round(r.cntA[i])) : "–";
        } },
      { key: "cntB", label: "Molecules, B", align: "right",
        value: function (i) { return r.cntB ? r.cntB[i] : 0; },
        render: function (i) {
          return r.cntB ? F.int(Math.round(r.cntB[i])) : "–";
        } },
      { key: "mcA", label: "Mean molecules per sample, A", align: "right",
        value: function (i) {
          return r.cntA && nA ? r.cntA[i] / nA : 0;
        },
        render: function (i) {
          return r.cntA && nA ? F.dec(r.cntA[i] / nA, 1) : "–";
        } },
      { key: "mcB", label: "Mean molecules per sample, B", align: "right",
        value: function (i) {
          return r.cntB && nB ? r.cntB[i] / nB : 0;
        },
        render: function (i) {
          return r.cntB && nB ? F.dec(r.cntB[i] / nB, 1) : "–";
        } },
      { key: "tpmA", label: "Mean TPM per sample, A", align: "right",
        value: function (i) { return r.tpmA ? r.tpmA[i] : 0; },
        render: function (i) { return r.tpmA ? F.dec(r.tpmA[i], 2) : "–"; } },
      { key: "tpmB", label: "Mean TPM per sample, B", align: "right",
        value: function (i) { return r.tpmB ? r.tpmB[i] : 0; },
        render: function (i) { return r.tpmB ? F.dec(r.tpmB[i], 2) : "–"; } },
      { key: "lfc", label: "log₂ FC", align: "right",
        help: "log₂((mean A + 1) / (mean B + 1)) on the active value type. The +1 keeps zero-expression " +
              "features finite; it also shrinks fold changes at low abundance.",
        value: function (i) { return r.lfc[i]; },
        sort: function (i) { return Math.abs(r.lfc[i]); },
        render: function (i) {
          const v = r.lfc[i];
          return el("span", { style: { color: Math.abs(v) >= lfcThresh
            ? IV.pal.diverging(v > 0 ? 1 : -1) : "var(--ink-2)",
            fontWeight: Math.abs(v) >= lfcThresh ? "620" : "400" },
            text: (v > 0 ? "+" : "") + F.dec(v, 2) });
        } },
      r.entA ? { key: "entA", label: "Usage entropy, A", align: "right",
        value: function (i) { return r.entA[i]; },
        render: function (i) { return F.dec(r.entA[i], 3); } } : null,
      r.entB ? { key: "entB", label: "Usage entropy, B", align: "right",
        value: function (i) { return r.entB[i]; },
        render: function (i) { return F.dec(r.entB[i], 3); } } : null,
      r.jsd ? { key: "jsd", label: "Usage JSD", align: "right",
        value: function (i) { return r.jsd[i]; },
        render: function (i) { return r.jsd[i] > 0 ? F.dec(r.jsd[i], 3) : "–"; } } : null,
      r.molS ? { key: "molA", label: "Detected molecules, A", align: "right",
        value: function (i) { return r.perGroup(r.molS, r.A, i) || 0; },
        render: function (i) {
          return F.int(r.perGroup(r.molS, r.A, i) || 0);
        } } : null,
      r.molS ? { key: "molB", label: "Detected molecules, B", align: "right",
        value: function (i) { return r.perGroup(r.molS, r.B, i) || 0; },
        render: function (i) {
          return F.int(r.perGroup(r.molS, r.B, i) || 0);
        } } : null,
      !r.molS ? { key: "mol", label: "Detected molecules", align: "right",
        value: function (i) { return r.mol[i]; } } : null,
    ].filter(Boolean);

    core.samples.forEach(function (s, j) {
      cols.push({ key: "s" + j, label: s, align: "right",
        value: function (i) { return tpm.get(i, j); },
        render: function (i) { return IV.stateApi.fmtValue(tpm.get(i, j)); } });
    });

    const host = el("div");
    c.appendChild(host);
    const table = new U.Table(host, {
      name: "compare", cols: cols, sortKey: "lfc", sortDir: -1,
      total: r.n,
      onRow: function (i) {
        IV.app.openGene(r.level === "gene" ? i : r.geneIdxOf[i],
          r.level === "gene" ? {} : { focusTx: i });
      },
    });
    toolsHost.appendChild(table.columnPicker());
    table.setRows(Int32Array.from(usable));
    return c;
  }

  IV.views = IV.views || {};
  IV.views.compare = { render: render, title: "Compare",
    reset: function () { result = null; } };
})(window.IV);
