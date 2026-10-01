(function (IV) {
  "use strict";

  const { el, clear, svgEl, token } = IV.dom;
  const C = IV.chart;
  const F = IV.fmt;

  function controls(host, opts) {
    const row = el("div", { class: "plot-controls" });

    if (opts.value) {
      row.appendChild(IV.ui.seg([
        { label: "Counts", value: "counts",
          help: "Reconstructed molecules assigned to the feature." },
        { label: "TPM", value: "tpm",
          help: "Normalised within each sample, so samples are comparable." },
      ], opts.value.value, opts.value.onChange, { label: "Values" }));
    }

    for (const grp of opts.groups || []) {
      if (!grp || !grp.options || grp.options.length < 2) continue;
      row.appendChild(IV.ui.seg(grp.options, grp.value, grp.onChange,
        { label: grp.label, accent: grp.accent }));
    }
    row.appendChild(el("span", { style: { flex: "1" } }));
    if (opts.view) {
      row.appendChild(IV.ui.seg([
        { label: "Distribution", value: "bar",
          help: "Binned counts - shows the shape. Hover a bar for the top " +
                "features inside it." },
        { label: "Ranked", value: "dot",
          help: "Every feature as one point, ordered high to low - shows the tail " +
                "and the individual outliers." },
      ], opts.view.value, opts.view.onChange, { label: "View" }));
    }
    host.appendChild(row);
    return row;
  }

  function vWords() {
    const m = (IV.stateApi && IV.stateApi.modeInfo && IV.stateApi.modeInfo()) || {};
    return { one: m.variantWord || "variant",
             many: m.variantWordPlural || "variants" };
  }

  function featureRows(it, o) {
    const q = o || {};
    const rows = [];
    if (it.gene_ != null) rows.push(["Gene", it.gene_]);
    if (q.rank) rows.push(["Rank", q.rank]);
    if (q.metric && !q.metricLast) rows.push(q.metric);
    const molTotal = it.molTotal != null ? it.molTotal : it.mol;
    const nVarDet = it.nVarDet != null ? it.nVarDet : it.nVar;
    const nAnnotated = it.nAnnotated;
    if (molTotal != null) rows.push(["Detected molecules", F.int(molTotal)]);
    if (it.molFl != null) {
      rows.push(["Full-length molecules", F.int(it.molFl)
        + (molTotal ? " (" + F.pctOf(it.molFl, molTotal, 0) + " of detected)" : "")]);
    }
    if (it.molCounted != null) rows.push(["Counted molecules", F.int(it.molCounted)]);
    if (it.meanMol != null) {
      rows.push(["Mean counted molecules per sample", F.dec(it.meanMol, 1)]);
    }
    if (it.meanTpm != null) rows.push(["Mean TPM per sample", F.dec(it.meanTpm, 2)]);
    const vw = vWords();
    if (nAnnotated != null) {
      rows.push(["Annotated " + vw.many, F.int(nAnnotated)]);
    }
    if (nVarDet != null) rows.push(["Detected " + vw.many, F.int(nVarDet)]);
    for (const r of it.rows || []) rows.push(r);
    if (q.metric && q.metricLast) rows.push(q.metric);
    return rows;
  }

  const MAX_BINS = 50;

  function binHoverText(bi, count, total, tops, o, labelOf, topN) {
    let s = "<b>" + F.escapeHtml((o.binLabel ? o.binLabel + " " : "") + labelOf(bi)) + "</b>";
    s += "<br>" + F.escapeHtml(o.yTitle || "Count") + ": " + F.int(count);
    s += "<br>Share: " + F.pctOf(count, total, 1);
    if (tops.length) {
      const unit = o.topUnit || o.binLabel || "";
      s += "<br><br><b>" + F.escapeHtml(o.topLabel || ("Top " + Math.min(topN, tops.length)))
        + (unit ? " (" + F.escapeHtml(unit) + ")" : "") + "</b>";
      for (const it of tops) {
        s += "<br>" + F.escapeHtml(it.label) + "  " + F.escapeHtml(it.sub || "");
      }
    }
    return s;
  }

  function binnedBar(host, items, opts) {
    const o = opts || {};
    const b = o.binning || { kind: "log10", step: 0.1, lo: -2, hi: 6 };
    const nItems = items.length;
    if (!nItems) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "Nothing to plot" }));
      return;
    }

    let edges = [], keyOf, labelOf, tickOf;
    if (b.kind === "int") {
      const lo = b.min == null ? 1 : b.min;
      let mx = lo;
      for (const it of items) if (it.v > mx) mx = it.v;
      if (b.max) mx = Math.min(mx, b.max);
      const grouped = (mx - lo + 1) > MAX_BINS;
      const last = grouped ? lo + MAX_BINS - 1 : mx;
      for (let i = lo; i <= last + 1; i++) edges.push(i);
      keyOf = function (v) {
        const k = Math.round(v);
        if (k < lo) return -1;
        if (k >= last) return grouped ? last - lo : (k === last ? last - lo : -1);
        return k - lo;
      };
      labelOf = function (i) {
        return grouped && i === last - lo ? last + "+" : String(i + lo);
      };
      tickOf = labelOf;
    } else {
      const isLog = b.kind === "log10";
      const tr = isLog ? function (v) { return Math.log10(v + (b.eps == null ? 1e-3 : b.eps)); }
                       : function (v) { return v; };
      let lo = b.lo, hi = b.hi;
      if (lo == null || hi == null) {
        lo = Infinity; hi = -Infinity;
        for (const it of items) {
          const x = tr(it.v);
          if (!isFinite(x)) continue;
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        if (hi <= lo) hi = lo + 1;
      }
      let step = b.step || (hi - lo) / MAX_BINS;
      if ((hi - lo) / step > MAX_BINS) step = (hi - lo) / MAX_BINS;
      const nB = Math.max(1, Math.min(MAX_BINS, Math.ceil((hi - lo) / step)));
      for (let i = 0; i <= nB; i++) edges.push(lo + i * step);
      keyOf = function (v) {
        const x = tr(v);
        if (!isFinite(x) || x < lo || x > hi) return -1;
        return Math.min(nB - 1, Math.max(0, Math.floor((x - lo) / step)));
      };
      labelOf = function (i) {
        const a = edges[i], c = edges[i + 1];
        if (isLog) return F.compact(Math.pow(10, a), 1) + " – " + F.compact(Math.pow(10, c), 1);
        return C.fmtTick(a, b.tickKind) + " – " + C.fmtTick(c, b.tickKind);
      };
      tickOf = function (i) {
        const a = edges[i];
        return isLog ? F.compact(Math.pow(10, a), 1) : C.fmtTick(a, b.tickKind);
      };
    }

    const nB = edges.length - 1;
    const counts = new Int32Array(nB);
    const tops = new Array(nB);
    const topN = o.topN == null ? 10 : o.topN;
    for (const it of items) {
      const bi = keyOf(it.v);
      if (bi < 0) continue;
      counts[bi]++;
      let arr = tops[bi];
      if (!arr) { arr = tops[bi] = []; }
      const rv = it.rank == null ? it.v : it.rank;
      if (arr.length < topN) {
        arr.push(it);
        if (arr.length === topN) arr.sort(function (p, q) {
          return (q.rank == null ? q.v : q.rank) - (p.rank == null ? p.v : p.rank);
        });
      } else if (rv > (arr[topN - 1].rank == null ? arr[topN - 1].v : arr[topN - 1].rank)) {
        arr[topN - 1] = it;
        arr.sort(function (p, q) {
          return (q.rank == null ? q.v : q.rank) - (p.rank == null ? p.v : p.rank);
        });
      }
    }
    for (let i = 0; i < nB; i++) if (tops[i]) tops[i].sort(function (p, q) {
      return (q.rank == null ? q.v : q.rank) - (p.rank == null ? p.v : p.rank);
    });

    const logY = o.logY !== false;
    let maxC = 1;
    for (let i = 0; i < nB; i++) if (counts[i] > maxC) maxC = counts[i];

    const totalForHover = counts.reduce(function (a, c) { return a + c; }, 0);
    if (IV.px && IV.px.available()) {
      const bins = [];
      for (let i = 0; i < nB; i++) {
        bins.push({
          label: labelOf(i),
          tick: (tickOf || labelOf)(i),
          count: counts[i],
          hover: binHoverText(i, counts[i], totalForHover, tops[i] || [], o, labelOf, topN),
        });
      }
      const drew = IV.px.binnedBars(host, bins, {
        height: o.height || IV.px.GEOM.height,
        xTitle: o.xTitle,
        yTitle: o.yTitle,
        color: o.color,
        logY: logY,
        exportName: o.xTitle || "distribution",
        onPickBin: o.onPickBin
          ? function (bi) { o.onPickBin(tops[bi] || [], labelOf(bi)); }
          : null,
      });
      if (drew) return { counts: counts, edges: edges, tops: tops };
    }

    const fr = C.frame(host, {
      height: o.height || 230, width: o.width,
      margin: o.margin || { top: 10, right: 14, bottom: 40, left: 54 },
      label: o.label,
    });
    const yTop = logY ? Math.log10(maxC) * 1.04 : maxC * 1.04;
    const y = C.linear(0, yTop, fr.h, 0);
    const yv = function (c) { return logY ? (c > 0 ? Math.log10(c) : 0) : c; };

    if (logY) {
      const tv = [];
      for (let d = 0; Math.pow(10, d) <= maxC * 1.5; d++) tv.push(d);
      C.yAxis(fr, y, { values: tv, title: o.yTitle,
        format: function (v) { return F.compact(Math.pow(10, v), 0); } });
      for (const t of fr.g.querySelectorAll(".tick-text")) {
        const v = parseFloat(t.getAttribute("y"));
        void v;
      }
    } else {
      C.yAxis(fr, y, { title: o.yTitle, count: 4 });
    }

    const xs = C.linear(0, nB, 0, fr.w);
    if (b.kind === "int") {
      const stride = Math.max(1, Math.ceil(nB / 14));
      const vals = [];
      for (let i = 0; i < nB; i += stride) vals.push(i);
      drawXCategory(fr, xs, vals, function (i) { return labelOf(i); }, o.xTitle);
    } else {
      const stride = Math.max(1, Math.ceil(nB / 8));
      const vals = [];
      for (let i = 0; i <= nB; i += stride) vals.push(i);
      drawXCategory(fr, xs, vals, function (i) {
        const e = edges[Math.min(i, nB)];
        return b.kind === "log10" ? F.compact(Math.pow(10, e), 0) : C.fmtTick(e, b.tickKind);
      }, o.xTitle);
    }

    const fill = o.color || token("--seq-600");
    const slot = fr.w / nB;
    const bw = Math.max(1, slot - (slot > 4 ? C.GAP : 0));
    const totalPlotted = counts.reduce(function (a, c) { return a + c; }, 0);

    for (let i = 0; i < nB; i++) {
      const c = counts[i];
      if (!c) continue;
      const yy = y(yv(c));
      const hgt = Math.max(1, fr.h - yy);
      const p = svgEl("path", {
        d: C.barPath(i * slot + (slot - bw) / 2, yy, bw, hgt, C.R, false), fill: fill,
      });
      C.bindHover(p, (function (bi, cc) {
        return function () {
          const arr = tops[bi] || [];
          let h = '<div class="t-title">' + F.escapeHtml(o.binLabel || "")
            + (o.binLabel ? " " : "") + F.escapeHtml(labelOf(bi)) + "</div>"
            + '<div class="t-row"><span class="tk">' + F.escapeHtml(o.yTitle || "Count")
            + '</span><span class="tv">' + F.int(cc) + "</span></div>"
            + '<div class="t-row"><span class="tk">Share</span><span class="tv">'
            + F.pctOf(cc, totalPlotted, 1) + "</span></div>";
          if (arr.length) {
            const unit = o.topUnit || o.binLabel || "";
            h += '<div class="t-list"><b>' + F.escapeHtml(o.topLabel
              || ("Top " + Math.min(topN, arr.length)))
              + (unit ? ' <span class="t-unit">(' + F.escapeHtml(unit) + ")</span>" : "")
              + "</b>";
            for (const it of arr) {
              h += '<div class="t-li"><span>' + F.escapeHtml(it.label) + "</span>"
                + '<span class="tv">' + F.escapeHtml(it.sub || "") + "</span></div>";
            }
            h += "</div>";
          }
          return h;
        };
      })(i, c));
      if (o.onPickBin) {
        p.style.cursor = "pointer";
        p.addEventListener("click", (function (bi) {
          return function () { o.onPickBin(tops[bi] || [], labelOf(bi)); };
        })(i));
      }
      fr.g.appendChild(p);
    }
    return { counts: counts, edges: edges, tops: tops };
  }

  function drawXCategory(fr, xs, values, labelFn, title) {
    fr.g.appendChild(svgEl("line", { class: "axis-line", x1: 0, x2: fr.w,
      y1: fr.h, y2: fr.h }));
    for (const i of values) {
      const x = xs(i + 0.5);
      const t = svgEl("text", { class: "tick-text", x: x, y: fr.h + 14,
        "text-anchor": "middle" });
      t.textContent = labelFn(i);
      fr.g.appendChild(t);
    }
    if (title) {
      const t = svgEl("text", { class: "axis-title", x: fr.w / 2,
        y: fr.h + fr.m.bottom - 3, "text-anchor": "middle" });
      t.textContent = title;
      fr.g.appendChild(t);
    }
  }

  function rankHoverOpts(o, it, i, n) {
    return {
      rank: F.int(i + 1) + " of " + F.int(n),
      metric: o.valueInRows ? null
        : [o.valueLabel || "Value", o.fmtV ? o.fmtV(it.v) : F.dec(it.v, 3)],
      metricLast: !!o.metricLast,
    };
  }

  function linTickFormat(vmax) {
    return (vmax != null && Math.abs(vmax) >= 1000) ? ".2s" : "~g";
  }

  function rankedDots(host, items, opts) {
    const o = opts || {};
    if (!items.length) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "Nothing to plot" }));
      return;
    }
    const sorted = items.slice().sort(function (a, b) { return b.v - a.v; });
    const logY = !!o.logY;
    const yOf = function (i) {
      const v = sorted[i].v;
      return logY ? Math.log10(v + (o.eps == null ? 1e-3 : o.eps)) : v;
    };

    if (IV.px && IV.px.available()) {
      const n = sorted.length;
      const xs = new Array(n), ys = new Array(n), hov = new Array(n);
      const anyDim = !!o.dimOf;
      const hbg = anyDim ? new Array(n) : null;
      const hfg = anyDim ? new Array(n) : null;
      const hbd = anyDim ? new Array(n) : null;
      const T = IV.px.theme();
      for (let i = 0; i < n; i++) {
        xs[i] = i + 1;
        ys[i] = sorted[i].v;
        hov[i] = IV.px.rowsToHover(sorted[i].label,
          featureRows(sorted[i], rankHoverOpts(o, sorted[i], i, n)));
        if (anyDim) {
          const dim = !!o.dimOf(sorted[i]);
          hbg[i] = dim ? token("--surface-sunk") : T.surface;
          hfg[i] = dim ? token("--ink-faint") : T.ink;
          hbd[i] = dim ? token("--border") : null;
        }
      }
      const drew = IV.px.points(host, {
        x: xs, y: ys, hover: hov,
        hoverBg: hbg, hoverFg: hfg, hoverBorder: hbd,
        color: o.colorOf ? sorted.map(function (it) { return o.colorOf(it); }) : null,
      }, {
        height: o.height || IV.px.GEOM.height,
        xTitle: "Rank", yTitle: o.yTitle,
        color: o.color,
        exportName: o.yTitle || "ranked",
        xaxis: { rangemode: "tozero" },
        yaxis: logY
          ? { type: "log", tickformat: ".2s" }
          : { rangemode: "tozero", tickformat: linTickFormat(sorted[0].v) },
        onPick: o.onPick ? function (i) { o.onPick(sorted[i]); } : null,
      });
      if (drew) return;
    }

    C.scatter(host, {
      n: sorted.length,
      x: function (i) { return i + 1; },
      y: yOf,
      color: o.colorOf ? function (i) { return o.colorOf(sorted[i]); } : null,
      tip: function (i) {
        const it = sorted[i];
        return C.tipHTML(it.label,
          featureRows(it, rankHoverOpts(o, it, i, sorted.length)),
          o.colorOf ? o.colorOf(it) : null);
      },
    }, {
      height: o.height || 230, radius: o.radius,
      color: o.color || token("--seq-600"),
      xTitle: "Rank", yTitle: o.yTitle,
      yKind: logY ? "log1p_exact" : null,
      margin: o.margin || { top: 10, right: 14, bottom: 40, left: 54 },
      yTickFormat: logY ? function (v) { return F.compact(Math.pow(10, v), 0); } : null,
      onPick: o.onPick ? function (i) { o.onPick(sorted[i]); } : null,
    });
  }

  function intBars(host, counts, opts) {
    const o = opts || {};
    clear(host);
    const nB = counts.length;
    if (!nB) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "No data" }));
      return;
    }
    const total = counts.reduce(function (a, b) { return a + b; }, 0);
    const labelOf = function (i) {
      return (o.capAt != null && i >= o.capAt) ? i + "+" : String(i);
    };

    if (IV.px && IV.px.available()) {
      const bins = counts.map(function (c, i) {
        let h = "<b>" + F.escapeHtml((o.binLabel || "Bin") + " " + labelOf(i))
          + "</b><br>" + F.escapeHtml(o.yTitle || "Molecules") + ": " + F.int(c)
          + "<br>Share: " + F.pctOf(c, total, 2);
        const tops = o.topsFor ? o.topsFor(i) : [];
        if (tops.length) {
          h += "<br><br><b>" + F.escapeHtml(o.topLabel || "Top here") + "</b>";
          for (const t of tops) {
            h += "<br>" + F.escapeHtml(t.label) + "  " + F.escapeHtml(t.sub || "");
          }
        }
        return { label: labelOf(i), count: c, hover: h };
      });
      const drew = IV.px.binnedBars(host, bins, {
        height: o.height || 210,
        xTitle: o.xTitle, yTitle: o.yTitle || "Molecules",
        color: o.color, exportName: o.exportName || "end-support",
        onPickBin: o.onPick ? function (i) { o.onPick(i); } : null,
      });
      if (drew) return;
    }

    const fr = C.frame(host, { height: o.height || 210,
      margin: { top: 10, right: 14, bottom: 40, left: 54 } });
    let maxC = 1;
    for (const c of counts) if (c > maxC) maxC = c;
    const y = C.linear(0, Math.log10(maxC) * 1.04, fr.h, 0);
    const tv = [];
    for (let dd = 0; Math.pow(10, dd) <= maxC * 1.5; dd++) tv.push(dd);
    C.yAxis(fr, y, { values: tv, title: o.yTitle || "Molecules",
      format: function (v) { return F.compact(Math.pow(10, v), 0); } });
    const xs = C.linear(0, nB, 0, fr.w);
    const stride = Math.max(1, Math.ceil(nB / 14));
    const xv = [];
    for (let i = 0; i < nB; i += stride) xv.push(i);
    drawXCategory(fr, xs, xv, labelOf, o.xTitle);
    const slot = fr.w / nB;
    const bw = Math.max(1, slot - (slot > 4 ? C.GAP : 0));
    for (let i = 0; i < nB; i++) {
      const cc = counts[i];
      if (!cc) continue;
      const yy = y(Math.log10(cc));
      const path = svgEl("path", {
        d: C.barPath(i * slot + (slot - bw) / 2, yy, bw,
                     Math.max(1, fr.h - yy), C.R, false),
        fill: o.color || token("--brand"),
      });
      C.bindHover(path, (function (bin, count) {
        return function () {
          let h = '<div class="t-title">'
            + F.escapeHtml((o.binLabel || "Bin") + " " + labelOf(bin)) + "</div>"
            + '<div class="t-row"><span class="tk">'
            + F.escapeHtml(o.yTitle || "Molecules")
            + '</span><span class="tv">' + F.int(count) + "</span></div>"
            + '<div class="t-row"><span class="tk">Share</span><span class="tv">'
            + F.pctOf(count, total, 2) + "</span></div>";
          const tops = o.topsFor ? o.topsFor(bin) : [];
          if (tops.length) {
            h += '<div class="t-list"><b>'
              + F.escapeHtml(o.topLabel || "Top here") + "</b>";
            for (const t of tops) {
              h += '<div class="t-li"><span>' + F.escapeHtml(t.label) + "</span>"
                + '<span class="tv">' + F.escapeHtml(t.sub || "") + "</span></div>";
            }
            h += "</div>";
          }
          return h;
        };
      })(i, cc));
      fr.g.appendChild(path);
    }
  }

  function logFold(counts, opts) {
    const o = opts || {};
    const first = o.first == null ? 1 : o.first;
    const exact = o.exact == null ? 10 : o.exact;
    const perDecade = o.perDecade || 12;
    const out = [];
    let i = 0;
    for (; i < counts.length && (i + first) <= exact; i++) {
      out.push({ lo: i + first, hi: i + first, n: counts[i] });
    }
    let lo = exact + 1;
    const step = Math.pow(10, 1 / perDecade);
    const top = counts.length + first - 1;
    while (lo <= top) {
      let hi = Math.max(lo, Math.round(lo * step) - 1);
      if (hi > top) hi = top;
      let n = 0;
      for (let v = lo; v <= hi; v++) {
        const k = v - first;
        if (k >= 0 && k < counts.length) n += counts[k];
      }
      out.push({ lo: lo, hi: hi, n: n });
      lo = hi + 1;
    }
    return out;
  }

  const LOG2_TICKS = (function () {
    const vals = [], text = [];
    for (let e = 0; e <= 15; e++) {
      const v = Math.pow(2, e);
      vals.push(Math.log(v + 1) / Math.LN2);
      text.push(v >= 1000 ? (v / 1000) + "k" : String(v));
    }
    return { vals: vals, text: text };
  })();

  function metricScatter(host, spec) {
    clear(host);
    const items = spec.items;
    const state = spec.state;
    const nAll = items.length;

    const bar = el("div", { class: "plot-controls" });
    const minVar = Math.max(2, state.minVar || 2);
    let maxVar = 2;
    for (const it of items) if (it.nVar > maxVar) maxVar = it.nVar;

    const slider = el("input", { type: "range", min: 2, max: Math.max(3, maxVar),
      step: 1, value: Math.min(minVar, maxVar), style: { width: "150px" } });
    const num = el("input", { type: "number", min: 2, max: maxVar, step: 1,
      value: Math.min(minVar, maxVar), style: { width: "62px" } });
    const countLbl = el("span", { class: "control-hint" });
    const search = el("input", { type: "text", placeholder: "Highlight genes (comma separated)…",
      autocomplete: "off",
      value: state.search || "", style: { width: "190px" } });
    const searchLbl = el("span", { class: "control-hint" });

    const menu = el("div", { class: "pick-menu" });
    const picker = el("div", { class: "pick-wrap" }, [search, menu]);
    let pickList = [];
    let openIdx = -1;

    function closeMenu() { menu.classList.remove("open"); openIdx = -1; }

    function lastTerm() {
      const v = search.value;
      const i = v.lastIndexOf(",");
      return (i < 0 ? v : v.slice(i + 1)).trim();
    }

    function renderMenu() {
      clear(menu);
      const q = lastTerm().toUpperCase();
      const chosen = new Set(search.value.split(",")
        .map(function (x) { return x.trim().toUpperCase(); })
        .filter(Boolean));
      const hits = pickList.filter(function (it) {
        const nm = (it.label || "").toUpperCase();
        if (chosen.has(nm) && nm !== q) return false;
        if (!q) return true;
        return nm.indexOf(q) >= 0
          || (it.id || "").toUpperCase().indexOf(q) >= 0;
      });
      if (!hits.length) {
        menu.appendChild(el("div", { class: "pick-empty",
          text: "No gene here matches" }));
        menu.classList.add("open");
        return;
      }
      const CAP = 200;
      for (const it of hits.slice(0, CAP)) {
        const row = el("div", { class: "pick-item" }, [
          el("span", { text: it.label }),
          el("span", { class: "pick-metric",
            text: F.dec(it.metric, 3) + " · " + F.int(it.nVar) + " var" }),
        ]);
        row.addEventListener("mousedown", (function (item) {
          return function (ev) {
            ev.preventDefault();
            const v = search.value;
            const i = v.lastIndexOf(",");
            const head = i < 0 ? "" : v.slice(0, i + 1) + " ";
            search.value = head + item.label + ", ";
            state.search = search.value;
            renderMenu();
            draw();
            if (search.focus) search.focus();
          };
        })(it));
        menu.appendChild(row);
      }
      if (hits.length > CAP) {
        menu.appendChild(el("div", { class: "pick-empty",
          text: F.int(hits.length - CAP) + " more - keep typing to narrow" }));
      }
      menu.classList.add("open");
    }

    search.addEventListener("focus", renderMenu);
    search.addEventListener("blur", function () { setTimeout(closeMenu, 160); });
    search.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { closeMenu(); return; }
      if (ev.key === "Enter") {
        state.search = search.value;
        closeMenu();
        draw();
      }
    });

    bar.appendChild(IV.ui.control("Min " + vWords().many + " per "
      + (spec.geneWord || "gene"),
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        [slider, num])));
    bar.appendChild(IV.ui.control("Highlight",
      el("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
        [picker, el("button", { class: "btn btn-sm", text: "Clear",
          onclick: function () {
            search.value = ""; state.search = ""; closeMenu(); draw();
          } })])));
    bar.appendChild(el("span", { style: { flex: "1" } }));
    bar.appendChild(el("div", {}, [countLbl, el("br"), searchLbl]));
    host.appendChild(bar);

    let cbVmax = 2, cbVlog = Math.log(2);
    const plotHost = el("div", { class: "chart" });
    host.appendChild(plotHost);
    const legendHost = el("div");
    host.appendChild(legendHost);

    function onSlide(v) {
      const nv = Math.max(2, Math.min(maxVar, Math.round(v) || 2));
      state.minVar = nv;
      slider.value = nv;
      num.value = nv;
      draw();
    }
    slider.addEventListener("input", function () { onSlide(+slider.value); });
    num.addEventListener("change", function () { onSlide(+num.value); });
    search.addEventListener("input", IV.dom.debounce(function () {
      state.search = search.value;
      renderMenu();
      draw();
    }, 220));

    function draw() {
      clear(plotHost);
      clear(legendHost);
      const floor = Math.max(2, state.minVar || 2);
      const shown = items.filter(function (it) { return it.nVar >= floor; });
      countLbl.textContent = F.int(shown.length) + " of " + F.int(nAll)
        + " " + (spec.geneWordPlural || "genes") + " with several "
        + vWords().many;
      pickList = shown.slice().sort(function (a, b) { return b.metric - a.metric; });

      const terms = IV.stateApi.parseNames(state.search);
      const hits = [];
      if (terms && terms.size) {
        for (let i = 0; i < shown.length; i++) {
          const it = shown[i];
          if (terms.has((it.label || "").toUpperCase())
              || terms.has((it.id || "").toUpperCase())
              || terms.has(F.stripVersion(it.id || "").toUpperCase())) hits.push(i);
        }
        searchLbl.textContent = hits.length
          ? F.int(hits.length) + " highlighted"
          : "no match in this selection";
      } else {
        searchLbl.textContent = "";
      }

      if (!shown.length) {
        plotHost.appendChild(el("div", { class: "empty",
          text: "No " + (spec.geneWordPlural || "genes") + " with at least "
            + floor + " " + vWords().many }));
        return;
      }

      let vmax = 2;
      for (const it of shown) if (it.nVar > vmax) vmax = it.nVar;
      const vlog = Math.log(Math.max(2, vmax));
      cbVmax = vmax; cbVlog = vlog;
      const colorOf = function (n) {
        return IV.pal.sequential(vlog > 0 ? Math.log(Math.max(1, n)) / vlog : 0);
      };

      function metricRows(it) {
        const rows = [];
        for (const r of featureRows(it)) rows.push(r);
        rows.push([spec.metricLabel, F.dec(it.metric, 3)]);
        if (it.extra) rows.push(it.extra);
        return rows;
      }

      if (IV.px && IV.px.available()) {
        const n = shown.length;
        const xs = new Array(n), ys = new Array(n), hov = new Array(n), cols = new Array(n);
        for (let i = 0; i < n; i++) {
          xs[i] = IV.stat.log2(shown[i].value + 1);
          ys[i] = shown[i].metric;
          cols[i] = colorOf(shown[i].nVar);
          hov[i] = IV.px.rowsToHover(shown[i].label, metricRows(shown[i]));
        }
        const drew = IV.px.points(plotHost, {
          x: xs, y: ys, hover: hov, color: cols,
          highlight: hits,
          highlightLabels: hits.length && hits.length <= 40
            ? hits.map(function (i) { return shown[i].label; }) : null,
        }, {
          height: spec.height || 380,
          xTitle: spec.xTitle || spec.valueLabel,
          yTitle: spec.metricLabel,
          exportName: spec.metricLabel || "metric",
          highlightColor: token("--brand"),
          xaxis: { tickvals: LOG2_TICKS.vals, ticktext: LOG2_TICKS.text },
          yaxis: { range: [-0.04, 1.12], dtick: 0.2 },
          onPick: function (i) { spec.onPick(shown[i]); },
        });
        if (drew) { drawColorBar(); return; }
      }

      C.scatter(plotHost, {
        n: shown.length,
        x: function (i) { return IV.stat.log2(shown[i].value + 1); },
        y: function (i) { return shown[i].metric; },
        color: function (i) { return colorOf(shown[i].nVar); },
        tip: function (i) {
          const it = shown[i];
          return C.tipHTML(it.label, metricRows(it), colorOf(it.nVar));
        },
      }, {
        height: spec.height || 380,
        xTitle: spec.xTitle || spec.valueLabel,
        yTitle: spec.metricLabel,
        yDomain: [0, 1.12],
        margin: { top: 12, right: 16, bottom: 40, left: 58 },
        highlight: hits,
        highlightColor: token("--brand"),
        labelPoints: hits.length && hits.length <= 40
          ? hits.map(function (i) { return { i: i, text: shown[i].label }; }) : null,
        onPick: function (i) { spec.onPick(shown[i]); },
      });

      drawColorBar();
    }

    function drawColorBar() {
      const midVar = Math.max(2, Math.round(Math.exp(cbVlog / 2)));
      C.colorBar(legendHost, {
        title: "Detected " + vWords().many,
        colorAt: function (u) { return IV.pal.sequential(u); },
        ticks: [{ at: 0, label: "2" },
                { at: cbVlog > 0 ? Math.log(midVar) / cbVlog : 0.5, label: F.int(midVar) },
                { at: 1, label: F.int(cbVmax) }],
      });
    }

    draw();
  }

  function sampleBars(host, values, opts) {
    const o = opts || {};
    clear(host);
    const items = IV.stateApi.activeIdx().map(function (i) {
      return { label: IV.state.samples[i], value: values[i],
               color: IV.stateApi.sampleColor(i) };
    });
    C.barsH(host, items, {
      valueLabel: o.valueLabel || IV.stateApi.valueLabelCap(),
      labelW: o.labelW || 110, rowH: o.rowH || 18,
      total: o.share ? items.reduce(function (a, b) { return a + b.value; }, 0) : null,
    });
  }

  IV.plots = {
    featureRows, controls, binnedBar, intBars, logFold, rankedDots, metricScatter,
               sampleBars, drawXCategory };
})(window.IV);
