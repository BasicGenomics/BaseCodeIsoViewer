(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;

  const sv = {
    level: "gene",
    nHVG: null,
    basis: "tpm",
    corrMode: "hvg",
    pcaX: 0,
    pcaY: 1,
    heatRows: 100,
  };

  async function render(host) {
    clear(host);
    const core = IV.state.core;
    const nS = IV.stateApi.nActive();
    const nTotal = core.samples.length;
    if (!IV.state.sampleOn.length || IV.state.sampleOn.length !== nTotal) {
      IV.state.sampleOn = core.samples.map(function () { return true; });
    }

    if (core.sample_meta) host.appendChild(metaCard(core));

    if (nS < 2) {
      if (nTotal > 1 && IV.sampleSelect) {
        const pick = U.card("Samples included");
        IV.sampleSelect.chips(pick, function () { IV.app.rerender(); });
        host.appendChild(pick);
      }
      host.appendChild(U.callout(
        nTotal > 1
          ? "One sample is selected, so correlation, PCA, clustering and group "
            + "comparison have nothing to compare. Select a second sample above "
            + "to bring them back."
          : "This run has a single sample, so correlation, PCA, clustering and "
            + "group comparison are unavailable. Everything else works as normal.",
        "warn"));
      return;
    }
    await multivariateSection(host, core);
  }

  function metaCard(core) {
    const meta = core.sample_meta;
    const labels = meta.column_labels || meta.columns;
    const c = U.card("Samples");
    if (!meta.columns.length) {
      c.appendChild(U.simpleTable(["Sample"],
        core.samples.map(function (s) { return [s]; })));
      return c;
    }
    c.appendChild(U.simpleTable(["Sample"].concat(labels),
      core.samples.map(function (s) {
        const row = meta.rows[s] || {};
        return [s].concat(meta.columns.map(function (k) { return row[k] || "–"; }));
      })));
    return c;
  }

  function basisLabel() {
    return sv.basis === "tpm" ? "TPM" : "molecules";
  }

  async function multivariateSection(host, core) {
    const S = IV.stateApi;
    const mode = S.modeInfo();
    const u = await S.universe();
    const d = S.derive(u);

    const ctrl = U.card("What to compare on", {
      note: "On log₂(" + basisLabel() + " + 1), after stringency - the most "
        + "variable rows across samples drive the plots below.",
    });

    const chips = el("div", { class: "chips", style: { marginBottom: "var(--sp-3)" } });
    core.samples.forEach(function (s, i) {
      const chip = el("button", { class: "chip",
        "aria-pressed": String(!!IV.state.sampleOn[i]),
        title: "Click to include or exclude this sample" }, [
        el("span", { class: "swatch", style: { background: IV.stateApi.sampleColor(i) } }),
        el("span", { text: s }),
      ]);
      chip.addEventListener("click", function () {
        IV.state.sampleOn[i] = !IV.state.sampleOn[i];
        IV.app.rerender();
      });
      chips.appendChild(chip);
    });
    if (!IV.stateApi.allSamplesOn()) {
      chips.appendChild(el("button", { class: "btn btn-sm", text: "All samples",
        onclick: function () {
          IV.stateApi.setAllSamples(true);
          IV.app.rerender();
        } }));
    }
    ctrl.appendChild(chips);

    const row = el("div", { class: "control-row" });
    row.appendChild(U.control("Feature level", U.seg([
      { label: F.pretty(mode.geneWord), value: "gene" },
      { label: F.pretty(mode.featureWord), value: "tx" },
    ], sv.level, function (v) { sv.level = v; IV.app.rerender(); },
      { label: "Feature level", accent: sv.level === "tx" })));

    const hasTpm = (sv.level === "tx" ? u.tx : u.genes).has("tpm");
    if (hasTpm) {
      row.appendChild(U.control("Values", U.seg([
        { label: "TPM", value: "tpm",
          help: "Depth-normalised, so libraries of different size are "
            + "comparable. The right default for comparing samples." },
        { label: "Molecules", value: "counts",
          help: "Molecules as measured - NOT "
            + "depth-normalised.\n\nlog₂ compresses the scale but does not "
            + "remove a depth difference, so on this basis a deeper library sits "
            + "higher on nearly every feature and that shows up in the "
            + "clustering. Use it for the quantity as measured, within one run." },
      ], sv.basis, function (v) { sv.basis = v; IV.app.rerender(); },
        { label: "Values", accent: sv.basis === "counts" })));
    }
    if (!hasTpm && sv.basis === "tpm") sv.basis = "counts";

    let nQuant = 0;
    {
      const keep = d.keep, rows = sv.level === "tx" ? d.txRows : d.geneRows;
      for (let r = 0; r < rows.length; r++) if (keep[rows[r]]) nQuant++;
      if (!nQuant) nQuant = rows.length;
    }
    const hvgMax = Math.min(5000, Math.max(50, nQuant || 5000));
    const slider = el("input", { type: "range", min: 50, max: hvgMax, step: 50,
      value: Math.min(sv.nHVG == null ? Math.min(500, hvgMax) : sv.nHVG, hvgMax),
      style: { width: "170px" } });
    const num = el("input", { type: "number", min: 50, max: 20000, step: 50,
      value: sv.nHVG == null ? Math.min(500, hvgMax) : sv.nHVG,
      style: { width: "80px" } });
    const applyHVG = IV.dom.debounce(function () { IV.app.rerender(); }, 260);
    slider.addEventListener("input", function () {
      sv.nHVG = +slider.value; num.value = sv.nHVG; applyHVG();
    });
    num.addEventListener("change", function () {
      sv.nHVG = Math.max(10, +num.value || 500); slider.value = Math.min(5000, sv.nHVG);
      applyHVG();
    });
    row.appendChild(U.control("Highly variable features",
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        [slider, num])));
    ctrl.appendChild(row);
    host.appendChild(ctrl);

    const active = IV.stateApi.activeIdx();
    if (active.length < 2) {
      host.appendChild(el("div", { class: "empty",
        text: "Select at least two samples." }));
      return;
    }
    const M = buildMatrix(u, d, active);
    if (M.n < 3) {
      host.appendChild(el("div", { class: "empty",
        text: "Not enough features in the current selection." }));
      return;
    }
    ctrl.appendChild(el("p", { class: "note small", style: { marginTop: "var(--sp-2)" },
      html: "<strong>" + F.int(M.n) + "</strong> features in scope · using the top "
        + "<strong>" + F.int(M.hvg.length) + "</strong> by variance across "
        + active.length + " samples" }));

    host.appendChild(el("div", { class: "grid grid-2" }, [
      varianceCard(M, u, active), correlationCard(M, core, active),
    ]));
    host.appendChild(el("div", { class: "grid grid-2" }, [
      pcaCard(M, core, active), loadingsCard(M, u, active),
    ]));
    host.appendChild(clusterCard(M, core, u, active));
  }

  function buildMatrix(u, d, active) {
    const S = IV.stateApi;
    const isGene = sv.level === "gene";
    const frame = isGene ? u.genes : u.tx;
    const rows = isGene ? d.geneRows : d.txRows;
    const useTpm = sv.basis === "tpm" && frame.has("tpm");
    const vm = frame.col(useTpm ? "tpm" : "counts");
    const nS = active.length;

    const keep = [];
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      let any = false;
      for (let j = 0; j < nS; j++) if (vm.get(i, active[j]) > 0) { any = true; break; }
      if (any) keep.push(i);
    }
    const n = keep.length;
    const X = new Float64Array(n * nS);
    const varr = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      const i = keep[r];
      let mu = 0;
      for (let j = 0; j < nS; j++) {
        const v = Math.log(vm.get(i, active[j]) + 1) / Math.LN2;
        X[r * nS + j] = v;
        mu += v;
      }
      mu /= nS;
      let acc = 0;
      for (let j = 0; j < nS; j++) {
        const dv = X[r * nS + j] - mu;
        acc += dv * dv;
      }
      varr[r] = acc / nS;
    }
    const order = Array.from({ length: n }, function (_, i) { return i; })
      .sort(function (a, b) { return varr[b] - varr[a]; });
    const HVG_CAP = 5000;
    const HVG_DEFAULT = 500;
    if (sv.nHVG == null) sv.nHVG = Math.min(HVG_DEFAULT, n);
    const hvg = order.slice(0, Math.min(sv.nHVG, n));
    return { X: X, n: n, nS: nS, rows: keep, varr: varr, order: order, hvg: hvg,
             frame: frame, isGene: isGene, active: active };
  }

  function varianceCard(M, u, active) {
    const c = U.card("Feature variance ranking", {
      note: "Features ranked by variance of log₂(" + basisLabel() +
            " + 1) across the active samples. <em>Click a point to open its " +
            "gene.</em>",
    });
    const names = M.frame.col("name"), ids = M.frame.col("id");
    const gi = M.isGene ? null : u.tx.col("gene_idx");
    const gNames = u.genes.col("name");
    const cut = M.hvg.length;
    const S = IV.stateApi;
    const d = S.derive(u);
    const fr = M.frame;
    const mol = fr.has("mol") ? fr.col("mol") : null;
    const molFl = fr.has("mol_fl") ? fr.col("mol_fl") : null;
    const txCnt = (!M.isGene && fr.has("count")) ? fr.col("count") : null;
    const nAnn = u.genes.has("n_annotated") ? u.genes.col("n_annotated") : null;
    const nS = S.nActive();
    const items = M.order.map(function (r, rank) {
      const i = M.rows[r];
      return {
        v: M.varr[r],
        label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
        sub: F.dec(M.varr[r], 3),
        gene: M.isGene ? i : gi[i],
        hvg: rank < cut,
        gene_: M.isGene ? null : IV.blocks.cell(gNames, gi[i]),
        molTotal: mol ? mol[i] : null,
        molFl: molFl ? molFl[i] : null,
        molCounted: M.isGene ? Math.round(d.total[i] || 0)
          : (txCnt ? Math.round(txCnt[i] || 0) : null),
        meanMol: nS ? S.meanCounts(fr, i) : null,
        meanTpm: nS ? S.meanTpm(fr, i) : null,
        nAnnotated: (M.isGene && nAnn) ? nAnn[i] : null,
        nVarDet: M.isGene ? d.nVarDet[i] : null,
      };
    });
    const holder = el("div", { class: "chart" });
    IV.plots.rankedDots(holder, items, {
      yTitle: "Variance of log₂(" + basisLabel() + " + 1)",
      valueLabel: "Variance", height: 250, metricLast: true,
      colorOf: function (it) {
        return it.hvg ? IV.dom.token("--brand") : IV.dom.token("--border-strong");
      },
      onPick: function (it) { IV.app.openGene(it.gene); },
    });
    c.appendChild(holder);
    c.appendChild(IV.chart.legend([
      { label: "In the HVG window (" + F.int(cut) + ")", color: IV.dom.token("--brand") },
      { label: "Outside it", color: IV.dom.token("--border-strong") },
    ]));
    return c;
  }

  function correlationCard(M, core, active) {
    const c = U.card("Sample correlation", {
      note: "Pearson correlation of log₂(" + basisLabel() + " + 1) " +
            "between samples.",
    });
    const holder = el("div");
    const lab = IV.state.sampleLabels.labels;
    function draw() {
      clear(holder);
      const idx = sv.corrMode === "hvg" ? M.hvg : M.order;
      const m = corrMatrix(M, idx);
      let lo = 1;
      for (const rr of m) for (const x of rr) if (x < lo) lo = x;
      IV.chart.heatmap(holder, {
        exportName: "sample-correlation",
        rows: active.map(function (i) { return lab[i]; }),
        cols: active.map(function (i) { return lab[i]; }),
        aliasKey: IV.stateApi.sampleAliasKey(active),
        cellW: Math.max(30, Math.min(60, 380 / M.nS)),
        cellH: Math.max(20, Math.min(42, 320 / M.nS)),
        labelW: 118, headH: M.nS > 6 ? 64 : 32,
        get: function (r, cc) { return m[r][cc]; },
        scale: function (v) { return IV.pal.sequential(Math.max(0, Math.min(1, v))); },
        tip: function (r, cc) {
          return IV.chart.tipHTML(IV.stateApi.sampleTipName(active[r]) + 
          " vs " + IV.stateApi.sampleTipName(active[cc]), [["Pearson r", F.dec(m[r][cc], 4)],
            ["Features", F.int(idx.length)]]);
        },
      });
      IV.chart.colorBar(holder, {
        title: "Pearson r",
        colorAt: function (t) { return IV.pal.sequential(t); },
        ticks: [{ at: 0, label: "0" }, { at: 0.5, label: "0.5" },
                { at: 1, label: "1" }],
      });
    }
    IV.plots.controls(c, {
      groups: [{
        label: "Features", value: sv.corrMode,
        options: [{ label: "All", value: "all" }, { label: "HVGs only", value: "hvg" }],
        onChange: function (v) { sv.corrMode = v; draw(); },
      }],
    });
    c.appendChild(holder);
    draw();
    return c;
  }

  function corrMatrix(M, idx) {
    const nS = M.nS;
    const mu = new Float64Array(nS), sd = new Float64Array(nS);
    for (let j = 0; j < nS; j++) {
      let s = 0;
      for (const r of idx) s += M.X[r * nS + j];
      mu[j] = s / idx.length;
    }
    for (let j = 0; j < nS; j++) {
      let acc = 0;
      for (const r of idx) {
        const dv = M.X[r * nS + j] - mu[j];
        acc += dv * dv;
      }
      sd[j] = Math.sqrt(acc);
    }
    const out = [];
    for (let a = 0; a < nS; a++) {
      const rowa = [];
      for (let b = 0; b < nS; b++) {
        let acc = 0;
        for (const r of idx) {
          acc += (M.X[r * nS + a] - mu[a]) * (M.X[r * nS + b] - mu[b]);
        }
        rowa.push(sd[a] > 0 && sd[b] > 0 ? acc / (sd[a] * sd[b]) : 0);
      }
      out.push(rowa);
    }
    return out;
  }

  function pcaOf(M) {
    const nS = M.nS, idx = M.hvg;
    const n = idx.length;
    if (n < 2) return null;
    const C = [];
    for (let a = 0; a < nS; a++) C.push(new Float64Array(nS));
    const mu = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      let s = 0;
      for (let j = 0; j < nS; j++) s += M.X[idx[r] * nS + j];
      mu[r] = s / nS;
    }
    for (let a = 0; a < nS; a++) {
      for (let b = a; b < nS; b++) {
        let acc = 0;
        for (let r = 0; r < n; r++) {
          acc += (M.X[idx[r] * nS + a] - mu[r]) * (M.X[idx[r] * nS + b] - mu[r]);
        }
        C[a][b] = C[b][a] = acc / n;
      }
    }
    const eig = jacobiEigen(C, nS);
    const total = eig.values.reduce(function (a, b) { return a + Math.max(0, b); }, 0);
    const k = Math.min(nS, 4);
    const scores = [];
    for (let j = 0; j < nS; j++) {
      const row = [];
      for (let c = 0; c < k; c++) row.push(eig.vectors[j][c] * Math.sqrt(Math.max(0, eig.values[c])));
      scores.push(row);
    }
    const loadings = [];
    for (let c = 0; c < k; c++) {
      const l = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        let acc = 0;
        for (let j = 0; j < nS; j++) {
          acc += (M.X[idx[r] * nS + j] - mu[r]) * eig.vectors[j][c];
        }
        l[r] = acc;
      }
      loadings.push(l);
    }
    return {
      scores: scores, loadings: loadings, featureIdx: idx,
      explained: eig.values.slice(0, k).map(function (v) {
        return total > 0 ? Math.max(0, v) / total : 0;
      }),
    };
  }

  function jacobiEigen(A, n) {
    const a = A.map(function (r) { return Float64Array.from(r); });
    let v = [];
    for (let i = 0; i < n; i++) {
      v.push(new Float64Array(n));
      v[i][i] = 1;
    }
    for (let sweep = 0; sweep < 100; sweep++) {
      let offd = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) offd += a[i][j] * a[i][j];
      if (offd < 1e-18) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          if (Math.abs(a[p][q]) < 1e-20) continue;
          const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const cc = 1 / Math.sqrt(t * t + 1), ss = t * cc;
          for (let k = 0; k < n; k++) {
            const akp = a[k][p], akq = a[k][q];
            a[k][p] = cc * akp - ss * akq;
            a[k][q] = ss * akp + cc * akq;
          }
          for (let k = 0; k < n; k++) {
            const apk = a[p][k], aqk = a[q][k];
            a[p][k] = cc * apk - ss * aqk;
            a[q][k] = ss * apk + cc * aqk;
          }
          for (let k = 0; k < n; k++) {
            const vkp = v[k][p], vkq = v[k][q];
            v[k][p] = cc * vkp - ss * vkq;
            v[k][q] = ss * vkp + cc * vkq;
          }
        }
      }
    }
    const vals = [];
    for (let i = 0; i < n; i++) vals.push(a[i][i]);
    const ord = vals.map(function (_, i) { return i; })
      .sort(function (x, y) { return vals[y] - vals[x]; });
    return {
      values: ord.map(function (i) { return vals[i]; }),
      vectors: v.map(function (rowv) {
        return ord.map(function (i) { return rowv[i]; });
      }),
    };
  }

  function pcaCard(M, core, active) {
    const c = U.card("Sample PCA", {
      note: "Principal components of the HVG block.",
    });
    const pca = pcaOf(M);
    if (!pca) {
      c.appendChild(el("div", { class: "empty", text: "Not enough features." }));
      return c;
    }
    const k = pca.explained.length;
    sv.pcaX = Math.min(sv.pcaX, k - 1);
    sv.pcaY = Math.min(sv.pcaY, k - 1);
    if (sv.pcaY === sv.pcaX) sv.pcaY = Math.min(k - 1, sv.pcaX + 1);

    const selX = el("select", { class: "btn btn-sm" });
    const selY = el("select", { class: "btn btn-sm" });
    for (let j = 0; j < k; j++) {
      const lbl = "PC" + (j + 1) + " (" + F.pct(pca.explained[j], 1) + ")";
      selX.appendChild(el("option", { value: j, selected: j === sv.pcaX, text: lbl }));
      selY.appendChild(el("option", { value: j, selected: j === sv.pcaY, text: lbl }));
    }
    const row = el("div", { class: "plot-controls" });
    row.appendChild(U.control("X axis", selX));
    row.appendChild(U.control("Y axis", selY));
    c.appendChild(row);

    const holder = el("div");
    c.appendChild(holder);

    function draw() {
      clear(holder);
      const xi = sv.pcaX, yi = sv.pcaY;
      let drew = false;
      if (IV.px && IV.px.available()) {
        const xs = [], ys = [], cols = [], hov = [], txt = [], pos = [];
        let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
        for (let i = 0; i < M.nS; i++) {
          const xv = pca.scores[i][xi], yv = pca.scores[i][yi];
          xs.push(xv); ys.push(yv);
          if (xv < xlo) xlo = xv; if (xv > xhi) xhi = xv;
          if (yv < ylo) ylo = yv; if (yv > yhi) yhi = yv;
          cols.push(IV.stateApi.sampleColor(active[i]));
          txt.push(core.samples[active[i]]);
          hov.push(IV.px.rowsToHover(core.samples[active[i]], [
            ["PC" + (xi + 1), F.dec(xv, 3)],
            ["PC" + (yi + 1), F.dec(yv, 3)],
          ]));
        }
        const ymid = (ylo + yhi) / 2;
        for (let i = 0; i < ys.length; i++) {
          pos.push(ys[i] > ymid + (yhi - ymid) * 0.55 ? "bottom center" : "top center");
        }
        const padX = Math.max(1e-9, (xhi - xlo) * 0.14) || 1;
        const padY = Math.max(1e-9, (yhi - ylo) * 0.18) || 1;
        drew = IV.px.points(holder, {
          x: xs, y: ys, hover: hov, color: cols,
          text: txt, textposition: pos,
        }, {
          height: 430,
          xTitle: "PC" + (xi + 1) + " · " + F.pct(pca.explained[xi], 1),
          yTitle: "PC" + (yi + 1) + " · " + F.pct(pca.explained[yi], 1),
          exportName: "sample-pca",
          markerSize: 12,
          xaxis: { range: [xlo - padX, xhi + padX], zeroline: true },
          yaxis: { range: [ylo - padY, yhi + padY], zeroline: true },
        });
      }
      if (!drew) {
      IV.chart.scatter(holder, {
        n: M.nS,
        x: function (i) { return pca.scores[i][xi]; },
        y: function (i) { return pca.scores[i][yi]; },
        color: function (i) { return IV.stateApi.sampleColor(active[i]); },
        tip: function (i) {
          return IV.chart.tipHTML(core.samples[active[i]], [
            ["PC" + (xi + 1), F.dec(pca.scores[i][xi], 3)],
            ["PC" + (yi + 1), F.dec(pca.scores[i][yi], 3)],
          ], IV.stateApi.sampleColor(active[i]));
        },
      }, {
        height: 300, radius: 8, alpha: 1,
        xTitle: "PC" + (xi + 1) + " · " + F.pct(pca.explained[xi], 1),
        yTitle: "PC" + (yi + 1) + " · " + F.pct(pca.explained[yi], 1),
        margin: { top: 12, right: 18, bottom: 40, left: 58 },
        labelPoints: active.map(function (si, i) {
          return { i: i, text: core.samples[si] };
        }),
      });
      }
      holder.appendChild(IV.chart.legend(active.map(function (si) {
        return { label: core.samples[si], color: IV.stateApi.sampleColor(si) };
      })));
    }
    selX.addEventListener("change", function () { sv.pcaX = +selX.value; draw(); });
    selY.addEventListener("change", function () { sv.pcaY = +selY.value; draw(); });
    draw();
    c._pca = pca;
    return c;
  }

  function loadingsCard(M, u, active) {
    const c = U.card("PC loadings", {
      note: "Features contributing most to each component. "
        + "<em>Click an entry to open its gene.</em>",
    });
    const pca = pcaOf(M);
    if (!pca) return c;
    const names = M.frame.col("name"), ids = M.frame.col("id");
    const gi = M.isGene ? null : u.tx.col("gene_idx");
    const grid = el("div", { class: "grid" });

    for (let cIdx = 0; cIdx < Math.min(2, pca.explained.length); cIdx++) {
      const l = pca.loadings[cIdx];
      const order = Array.from({ length: l.length }, function (_, i) { return i; })
        .sort(function (a, b) { return Math.abs(l[b]) - Math.abs(l[a]); })
        .slice(0, 12);
      const box = el("div");
      box.appendChild(el("div", { class: "xsmall strong faint",
        text: "PC" + (cIdx + 1) + " · " + F.pct(pca.explained[cIdx], 1)
          + " of variance" }));
      const holder = el("div");
      IV.chart.barsH(holder, order.map(function (r) {
        const i = M.rows[pca.featureIdx[r]];
        return {
          label: IV.blocks.cell(names, i) || IV.blocks.cell(ids, i),
          value: Math.abs(l[r]),
          color: l[r] >= 0 ? IV.pal.diverging(1) : IV.pal.diverging(-1),
          onClick: function () { IV.app.openGene(M.isGene ? i : gi[i]); },
          valueText: F.dec(l[r], 2),
        };
      }), { valueLabel: "Loading", labelW: 170, rowH: 15,
            fmt: function (v) { return F.dec(v, 2); } });
      box.appendChild(holder);
      grid.appendChild(box);
    }
    c.appendChild(grid);
    c.appendChild(IV.chart.legend([
      { label: "Positive loading", color: IV.pal.diverging(1) },
      { label: "Negative loading", color: IV.pal.diverging(-1) },
    ]));
    return c;
  }

  function clusterCard(M, core, u, active) {
    const c = U.card("Hierarchical clustering heatmap", {
      note: "Top HVGs, log₂(" + basisLabel() + " + 1), row-centred. " +
            "Rows and columns are ordered by average-linkage clustering on " +
            "1 − correlation distance. <em>Click a row label to open " +
            "the gene.</em>",
    });
    const nRows = Math.min(sv.heatRows, M.hvg.length);
    if (nRows < 2) {
      c.appendChild(el("div", { class: "empty", text: "Not enough features." }));
      return c;
    }
    const names = M.frame.col("name"), ids = M.frame.col("id");
    const gi = M.isGene ? null : u.tx.col("gene_idx");
    const holder = el("div");

    const cap = Math.min(500, M.hvg.length);
    const lo = Math.min(20, cap);
    sv.heatRows = Math.max(lo, Math.min(sv.heatRows, cap));
    const slider = el("input", { type: "range", min: lo, max: cap,
      step: 10, value: sv.heatRows, style: { width: "160px" } });
    const row = el("div", { class: "plot-controls" });
    row.appendChild(U.control("Rows shown", slider));
    const lbl = el("span", { class: "control-hint", text: sv.heatRows + " features" });
    row.appendChild(lbl);
    c.appendChild(row);
    c.appendChild(holder);

    function draw() {
      clear(holder);
      const k = Math.max(1, Math.min(sv.heatRows, M.hvg.length));
      lbl.textContent = k + " features";
      const feat = M.hvg.slice(0, k);
      const nS = M.nS;

      const Z = [];
      for (const r of feat) {
        const v = new Float64Array(nS);
        let mu = 0;
        for (let j = 0; j < nS; j++) { v[j] = M.X[r * nS + j]; mu += v[j]; }
        mu /= nS;
        for (let j = 0; j < nS; j++) v[j] -= mu;
        Z.push(v);
      }
      const rowOrder = clusterOrder(Z, nS);
      const colVecs = [];
      for (let j = 0; j < nS; j++) {
        const v = new Float64Array(Z.length);
        for (let r = 0; r < Z.length; r++) v[r] = Z[r][j];
        colVecs.push(v);
      }
      const colOrder = clusterOrder(colVecs, Z.length);

      let maxAbs = 0;
      for (const v of Z) for (const x of v) if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x);
      if (!maxAbs) maxAbs = 1;

      IV.chart.heatmap(holder, {
        exportName: "hvg-clustering",
        rows: rowOrder.map(function (r) {
          const i = M.rows[feat[r]];
          return IV.blocks.cell(names, i) || IV.blocks.cell(ids, i);
        }),
        cols: colOrder.map(function (j) { return IV.state.sampleLabels.labels[active[j]]; }),
        aliasKey: IV.stateApi.sampleAliasKey(active),
        cellW: Math.max(30, Math.min(64, 420 / nS)),
        cellH: Math.max(2.4, Math.min(16, 2400 / rowOrder.length)),
        labelW: 196, headH: nS > 6 ? 62 : 32, alwaysLabelRows: true,
        get: function (r, cc) { return Z[rowOrder[r]][colOrder[cc]]; },
        scale: function (v) { return IV.pal.diverging(v / maxAbs); },
        tip: function (r, cc) {
          const i = M.rows[feat[rowOrder[r]]];
          return IV.chart.tipHTML(
            IV.blocks.cell(names, i) || IV.blocks.cell(ids, i), [
              ["Sample", IV.stateApi.sampleTipName(active[colOrder[cc]])],
              ["Row-centred log₂", F.dec(Z[rowOrder[r]][colOrder[cc]], 3)],
              [basisLabel(), IV.stateApi.fmtValue(
                M.frame.col(IV.stateApi.valueColumn()).get(i, active[colOrder[cc]]))],
            ]);
        },
        onPickRow: function (r) {
          const i = M.rows[feat[rowOrder[r]]];
          IV.app.openGene(M.isGene ? i : gi[i]);
        },
      });
      IV.chart.colorBar(holder, {
        title: "Row-centred log₂",
        colorAt: function (t) { return IV.pal.diverging(t * 2 - 1); },
        ticks: [{ at: 0, label: "−" + F.dec(maxAbs, 1) },
                { at: 0.5, label: "0" },
                { at: 1, label: "+" + F.dec(maxAbs, 1) }],
      });
    }
    slider.addEventListener("input", IV.dom.debounce(function () {
      const v = parseInt(slider.value, 10);
      if (isFinite(v) && v > 0) sv.heatRows = Math.min(v, cap);
      draw();
    }, 180));
    draw();
    return c;
  }

  function clusterOrder(vectors, dim) {
    const n = vectors.length;
    if (n < 3) return vectors.map(function (_, i) { return i; });
    const norm = vectors.map(function (v) {
      let mu = 0;
      for (let j = 0; j < dim; j++) mu += v[j];
      mu /= dim;
      const c = new Float64Array(dim);
      let ss = 0;
      for (let j = 0; j < dim; j++) { c[j] = v[j] - mu; ss += c[j] * c[j]; }
      const s = Math.sqrt(ss) || 1;
      for (let j = 0; j < dim; j++) c[j] /= s;
      return c;
    });
    const dist = function (a, b) {
      let acc = 0;
      for (let j = 0; j < dim; j++) acc += norm[a][j] * norm[b][j];
      return 1 - acc;
    };
    const used = new Uint8Array(n);
    const out = [0];
    used[0] = 1;
    for (let step = 1; step < n; step++) {
      const last = out[out.length - 1];
      let best = -1, bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const dd = dist(last, i);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      if (best < 0) break;
      used[best] = 1;
      out.push(best);
    }
    for (let i = 0; i < n; i++) if (!used[i]) out.push(i);
    return out;
  }

  IV.views = IV.views || {};
  IV.views.samples = { render: render, title: "Samples" };
})(window.IV);
