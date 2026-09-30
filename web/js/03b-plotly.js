(function (IV) {
  "use strict";

  const { el, clear, token } = IV.dom;
  const F = IV.fmt;

  function available() {
    return typeof Plotly !== "undefined" && Plotly && typeof Plotly.react === "function";
  }

  const FONT = 'Mona Sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

  function theme() {
    return {
      ink: token("--ink") || "#1c1527",
      ink2: token("--ink-2") || "#4c445c",
      muted: token("--ink-muted") || "#726a80",
      faint: token("--ink-faint") || "#9a93a6",
      grid: token("--grid") || "#ece7f2",
      surface: token("--surface") || "#ffffff",
      border: token("--border") || "#e4dced",
      brand: token("--brand") || "#ec008c",
      accent: token("--accent") || "#583092",
    };
  }

  const GEOM = { height: 250, left: 62, right: 16, top: 12, bottom: 48 };

  function baseLayout(o) {
    const t = theme();
    const m = o.margin || {};
    return {
      autosize: true,
      height: o.height || GEOM.height,
      margin: {
        l: m.left == null ? GEOM.left : m.left,
        r: m.right == null ? GEOM.right : m.right,
        t: m.top == null ? GEOM.top : m.top,
        b: m.bottom == null ? GEOM.bottom : m.bottom,
      },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: FONT, size: 11.5, color: t.ink2 },
      showlegend: false,
      hovermode: o.hovermode || "closest",
      hoverlabel: {
        bgcolor: t.surface,
        bordercolor: t.border,
        font: { family: FONT, size: 11.5, color: t.ink },
        align: "left",
      },
      xaxis: axis(o.xTitle, t, o.xaxis),
      yaxis: axis(o.yTitle, t, o.yaxis),
      dragmode: o.dragmode || "zoom",
      shapes: o.shapes || [],
      annotations: o.annotations || [],
      uirevision: o.uirevision == null ? (o.exportName || true) : o.uirevision,
    };
  }

  function axis(title, t, extra) {
    return Object.assign({
      title: title ? { text: title, font: { size: 11.5, color: t.muted } } : undefined,
      gridcolor: t.grid,
      zeroline: false,
      linecolor: t.border,
      tickfont: { size: 11, color: t.muted },
      automargin: false,
    }, extra || {});
  }

  function config(o) {
    const name = (o && o.exportName) || "isoviewer-plot";
    return {
      displaylogo: false,
      responsive: true,
      scrollZoom: false,
      modeBarButtonsToRemove: [
        "select2d", "lasso2d", "autoScale2d", "hoverClosestCartesian",
        "hoverCompareCartesian", "toggleSpikelines",
      ],
      modeBarButtonsToAdd: [{
        name: "Download as PNG",
        title: "Download as PNG",
        icon: (window.Plotly && Plotly.Icons && Plotly.Icons.camera) || undefined,
        click: function (gd) {
          Plotly.downloadImage(gd, { format: "png", filename: name, scale: 2 });
        },
      }],
      toImageButtonOptions: {
        format: "svg",
        filename: name,
        scale: 2,
      },
    };
  }

  function draw(host, traces, layoutOpts) {
    if (!available()) return false;
    clear(host);
    const node = el("div", { class: "pl-plot" });
    host.appendChild(node);
    const layout = baseLayout(layoutOpts || {});
    Plotly.newPlot(node, traces, layout, config(layoutOpts));
    observe(node);
    return true;
  }

  function observe(node) {
    if (typeof ResizeObserver === "undefined") return;
    let last = 0;
    const ro = new ResizeObserver(function (entries) {
      const w = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
      if (!w || !node.isConnected) return;
      if (Math.abs(w - last) < 1) return;
      last = w;
      try { Plotly.Plots.resize(node); } catch (_e) { }
    });
    ro.observe(node);
    node._ivRO = ro;
  }

  function purge(root) {
    if (!available() || !root || !root.querySelectorAll) return;
    const nodes = root.querySelectorAll(".pl-plot");
    for (const n of nodes) {
      if (n._ivRO) { try { n._ivRO.disconnect(); } catch (_e) { } n._ivRO = null; }
      try { Plotly.purge(n); } catch (_e) { }
    }
  }

  function rowsToHover(title, rows) {
    let s = "<b>" + F.escapeHtml(title) + "</b>";
    for (const r of rows || []) {
      if (!r) continue;
      if (r.length > 2) {
        s += "<br>" + F.escapeHtml(String(r[0])) + ": "
          + F.escapeHtml(String(r[1])) + "  /  " + F.escapeHtml(String(r[2]));
      } else if (r.length === 1) {
        s += "<br><b>" + F.escapeHtml(String(r[0])) + "</b>";
      } else if (r[1] === "" || r[1] == null) {
        s += "<br>" + F.escapeHtml(String(r[0]));
      } else {
        s += "<br>" + F.escapeHtml(String(r[0])) + ": " + F.escapeHtml(String(r[1]));
      }
    }
    return s;
  }

  function binnedBars(host, bins, o) {
    if (!available()) return false;
    const opts = o || {};
    const t = theme();
    const logY = opts.logY !== false;
    const trace = {
      type: "bar",
      x: bins.map(function (b) { return b.label; }),
      y: bins.map(function (b) {
        return (logY && !(b.count > 0)) ? null : b.count;
      }),
      marker: { color: opts.color || t.brand, line: { width: 0 } },
      hovertext: bins.map(function (b) { return b.hover || ""; }),
      hoverinfo: "text",
      hovertemplate: "%{hovertext}<extra></extra>",
    };
    const labels = bins.map(function (b) { return b.label; });
    const ticks = bins.map(function (b) { return b.tick == null ? b.label : b.tick; });
    let widest = 1;
    for (const s of ticks) if (String(s).length > widest) widest = String(s).length;
    const PX_PER_CHAR = 7, MIN_GAP = 14;
    const approxPlotW = 420;
    const maxTicks = Math.max(2,
      Math.floor(approxPlotW / (widest * PX_PER_CHAR + MIN_GAP)));
    const stride = Math.max(1, Math.ceil(labels.length / maxTicks));
    const tickvals = [], ticktext = [];
    for (let i = 0; i < labels.length; i += stride) {
      tickvals.push(labels[i]);
      ticktext.push(ticks[i]);
    }
    const ok = draw(host, [trace], {
      height: opts.height || GEOM.height,
      xTitle: opts.xTitle,
      yTitle: opts.yTitle,
      margin: opts.margin,
      exportName: opts.exportName,
      hovermode: "x",
      hoverdistance: -1,
      xaxis: { type: "category", tickangle: 0,
               tickmode: "array", tickvals: tickvals, ticktext: ticktext },
      yaxis: logY
        ? { type: "log", rangemode: "tozero", tickformat: ".2s" }
        : { rangemode: "tozero", tickformat: ".2s" },
      dragmode: "zoom",
    });
    if (ok && opts.onPickBin) {
      const node = host.querySelector(".pl-plot");
      node.on("plotly_click", function (ev) {
        const p = ev && ev.points && ev.points[0];
        if (p) opts.onPickBin(p.pointNumber, p.x);
      });
    }
    return ok;
  }

  const GL_MIN = 25000;

  function hoverBorderColor(spec, n, dotColor) {
    if (!spec.hoverBorder) return dotColor;

    const borders = new Array(n);
    const isArray = Array.isArray(dotColor);
    for (let i = 0; i < n; i++) {
      borders[i] = (spec.hoverBorder[i]) || (isArray ? dotColor[i] : dotColor);
    }
    return borders;
  }



  function points(host, spec, o) {
    if (!available()) return false;
    const opts = o || {};
    const t = theme();
    const n = spec.x.length;
    const logAx = function (cfg) { return cfg && cfg.type === "log"; };
    const clampLog = function (arr, isLog) {
      if (!isLog) return arr;
      return arr.map(function (v) {
        return (typeof v === "number" && v > 0) ? v : null;
      });
    };
    const xs = clampLog(spec.x, logAx(opts.xaxis));
    const ys = clampLog(spec.y, logAx(opts.yaxis));
    const dotColor = spec.color || opts.color || t.brand;
    const trace = {
      type: n > GL_MIN ? "scattergl" : "scatter",
      mode: spec.text ? "markers+text" : "markers",
      x: xs,
      y: ys,
      text: spec.text || null,
      textposition: spec.textposition || "top center",
      textfont: spec.text ? { size: 10.5, color: t.ink } : undefined,
      
      marker: {
        size: opts.markerSize || (n > 20000 ? 3 : n > 5000 ? 4 : 6),
        color: dotColor,
        opacity: opts.opacity == null ? (n > 20000 ? 0.55 : 0.8) : opts.opacity,
        line: { width: 0 },
      },
      hovertext: spec.hover,
      hoverinfo: "text",
      hovertemplate: "%{hovertext}<extra></extra>",
      hoverlabel: {
        bgcolor: spec.hoverBg || undefined,
        bordercolor: hoverBorderColor(spec, n, dotColor),
        font: spec.hoverFg ? { family: FONT, size: 11.5, color: spec.hoverFg }
                           : undefined,
        align: "left",
      },
    };
    const traces = [trace];
    const highlightColor = opts.highlightColor || t.accent;
    if (spec.highlight && spec.highlight.length) {
      traces.push({
        type: "scatter",
        mode: spec.highlightLabels ? "markers+text" : "markers",
        x: spec.highlight.map(function (i) { return xs[i]; }),
        y: spec.highlight.map(function (i) { return ys[i]; }),
        text: spec.highlightLabels || null,
        textposition: spec.highlight.map(function (i) {
          const yv = ys[i];
          const hi = (opts.yaxis && opts.yaxis.range) ? opts.yaxis.range[1] : null;
          if (hi != null && yv != null && yv > hi * 0.88) return "bottom center";
          return "top center";
        }),
        textfont: { size: 10, color: t.ink },
        marker: {
          size: 10,
          color: highlightColor,
          line: { width: 1.5, color: t.surface },
        },
        hovertext: spec.highlight.map(function (i) { return spec.hover[i]; }),
        hoverinfo: "text",
        hovertemplate: "%{hovertext}<extra></extra>",
        hoverlabel: {
          bordercolor: highlightColor,
          align: "left",
        },
      });
    }

    const ok = draw(host, traces, {
      height: opts.height || 300,
      xTitle: opts.xTitle,
      yTitle: opts.yTitle,
      margin: opts.margin,
      exportName: opts.exportName,
      xaxis: opts.xaxis,
      yaxis: opts.yaxis,
    });
    if (ok && opts.onPick) {
      const node = host.querySelector(".pl-plot");
      node.on("plotly_click", function (ev) {
        const p = ev && ev.points && ev.points[0];
        if (!p) return;
        const idx = p.curveNumber === 1 && spec.highlight
          ? spec.highlight[p.pointNumber] : p.pointNumber;
        opts.onPick(idx);
      });
    }
    return ok;
  }

  function heat(host, spec, o) {
    if (!available()) return false;
    const opts = o || {};
    const t = theme();
    const trace = {
      type: "heatmap",
      z: spec.z,
      x: spec.x,
      y: spec.y,
      colorscale: spec.colorscale || [[0, t.surface], [1, t.brand]],
      zmin: spec.zmin,
      zmax: spec.zmax,
      hovertext: spec.hover || null,
      hoverinfo: spec.hover ? "text" : "z",
      hovertemplate: spec.hover ? "%{hovertext}<extra></extra>" : null,
      colorbar: {
        thickness: 10,
        len: 0.85,
        outlinewidth: 0,
        tickfont: { size: 10, color: t.muted },
        title: spec.zTitle ? { text: spec.zTitle, font: { size: 10, color: t.muted } } : undefined,
      },
      xgap: 1,
      ygap: 1,
    };
    return draw(host, [trace], {
      height: opts.height || 320,
      xTitle: opts.xTitle,
      yTitle: opts.yTitle,
      margin: opts.margin,
      exportName: opts.exportName,
      xaxis: { type: "category", side: "top", tickangle: -35 },
      yaxis: { type: "category", autorange: "reversed" },
    });
  }

  function layeredPositions(nodes, links) {
    const n = nodes.length;
    if (!n) return null;
    const inn = [], out = [];
    for (let i = 0; i < n; i++) { inn.push([]); out.push([]); }
    for (const l of links) {
      if (l.source == null || l.target == null) continue;
      out[l.source].push(l);
      inn[l.target].push(l);
    }
    const depth = new Array(n).fill(0);
    let changed = true, passes = 0;
    while (changed) {
      changed = false;
      if (++passes > n + 1) return null;
      for (const l of links) {
        const d = depth[l.source] + 1;
        if (d > depth[l.target]) { depth[l.target] = d; changed = true; }
      }
    }
    let maxD = 0;
    for (let i = 0; i < n; i++) if (depth[i] > maxD) maxD = depth[i];

    const val = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let a = 0, b = 0;
      for (const l of inn[i]) a += l.value || 0;
      for (const l of out[i]) b += l.value || 0;
      val[i] = Math.max(a, b);
    }

    const cols = [];
    for (let d = 0; d <= maxD; d++) cols.push([]);
    for (let i = 0; i < n; i++) cols[depth[i]].push(i);

    const x = new Array(n).fill(0);
    const y = new Array(n).fill(0.5);
    const X0 = 0.02, X1 = 0.98;
    const GAP = 0.035;
    for (let d = 0; d <= maxD; d++) {
      const col = cols[d];
      const xs = maxD > 0 ? X0 + (X1 - X0) * (d / maxD) : X0;
      let tot = 0;
      for (const i of col) tot += val[i];
      const gaps = GAP * Math.max(0, col.length - 1);
      const usable = Math.max(0.05, 1 - gaps);
      let cursor = 0;
      for (const i of col) {
        const h = tot > 0 ? (val[i] / tot) * usable : usable / col.length;
        x[i] = xs;
        y[i] = Math.min(0.98, Math.max(0.02, cursor + h / 2));
        cursor += h + GAP;
      }
    }
    return { x: x, y: y, depth: depth, maxDepth: maxD };
  }

  function nodeHovers(nodes, links, opts, fmtCount) {
    const inSum = new Array(nodes.length).fill(0);
    const outSum = new Array(nodes.length).fill(0);
    for (const l of links || []) {
      if (l.target >= 0 && l.target < nodes.length) inSum[l.target] += l.value || 0;
      if (l.source >= 0 && l.source < nodes.length) outSum[l.source] += l.value || 0;
    }
    return nodes.map(function (n, i) {
      if (n.text) return n.text + (n.note ? "<br>" + n.note : "");
      const v = Math.max(inSum[i], outSum[i]);
      return fmtCount(v) + (opts.valuesuffix ? " " + opts.valuesuffix : "")
        + (n.note ? "<br>" + n.note : "");
    });
  }

  function sankey(host, spec, o) {
    if (!available()) return false;
    const opts = o || {};
    const t = theme();
    clear(host);
    const node = el("div", { class: "pl-plot" });
    host.appendChild(node);
    const pos = opts.layered === false ? null
      : layeredPositions(spec.nodes, spec.links);
    function fmtCount(v) {
      return F.compact(Math.round(v || 0), 2);
    }
    const trace = {
      type: "sankey",
      orientation: "h",
      arrangement: pos ? "fixed" : "snap",
      valueformat: ",.0f",
      valuesuffix: opts.valuesuffix ? " " + opts.valuesuffix : "",
      node: {
        label: spec.nodes.map(function (n) { return n.label; }),
        color: spec.nodes.map(function (n) { return n.color || t.brand; }),
        pad: opts.nodePad == null ? 24 : opts.nodePad,
        thickness: opts.nodeThickness == null ? 16 : opts.nodeThickness,
        line: { color: t.border, width: 1 },
        customdata: nodeHovers(spec.nodes, spec.links, opts, fmtCount),
        hovertemplate: "%{label}<br>%{customdata}<extra></extra>",
        x: pos ? pos.x : undefined,
        y: pos ? pos.y : undefined,
      },
      link: {
        source: spec.links.map(function (l) { return l.source; }),
        target: spec.links.map(function (l) { return l.target; }),
        value: spec.links.map(function (l) { return l.value; }),
        color: spec.links.map(function (l) { return l.color || "rgba(236,0,140,.28)"; }),
        customdata: spec.links.map(function (l) {
          const nm = function (i) {
            const n = spec.nodes[i] || {};
            return n.short || n.label || "";
          };
          const val = fmtCount(l.value)
            + (opts.valuesuffix ? " " + opts.valuesuffix : "");
          return nm(l.source) + " → " + nm(l.target)
            + "<br>" + (l.text || val) + (l.note ? "<br>" + l.note : "");
        }),
        hovertemplate: "%{customdata}<extra></extra>",
      },
    };
    const layout = {
      autosize: true,
      height: opts.height || 340,
      margin: { l: 8, r: 8, t: 10, b: 10 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: FONT, size: 11.5, color: t.ink2 },
      hoverlabel: {
        bgcolor: t.surface, bordercolor: t.border,
        font: { family: FONT, size: 11.5, color: t.ink }, align: "left",
      },
      uirevision: opts.uirevision == null ? (opts.exportName || true) : opts.uirevision,
    };
    Plotly.newPlot(node, [trace], layout, config(opts));
    observe(node);
    return true;
  }

  function checkConserves(nodes, links) {
    const inn = new Array(nodes.length).fill(0);
    const out = new Array(nodes.length).fill(0);
    for (const l of links) {
      out[l.source] += l.value;
      inn[l.target] += l.value;
    }
    const bad = [];
    for (let i = 0; i < nodes.length; i++) {
      if (inn[i] > 0 && out[i] > 0 && Math.abs(inn[i] - out[i]) > 0.5) {
        bad.push({ node: nodes[i].label, in: inn[i], out: out[i],
                   delta: inn[i] - out[i] });
      }
    }
    return bad;
  }

  IV.px = {
    layeredPositions,
    GEOM, sankey, checkConserves,
    available, draw, purge, rowsToHover,
    binnedBars, points, heat,
    theme, baseLayout, config,
  };
})(window.IV);
