(function (IV) {
  "use strict";

  const { el, svgEl, clear, token } = IV.dom;
  const F = IV.fmt;

  const GAP = 2;
  const R = 4;
  const TIP_OFFSET = 22;

  let tipNode = null;
  function tip() {
    if (!tipNode) {
      tipNode = el("div", { id: "tip", role: "tooltip" });
      document.body.appendChild(tipNode);
    }
    return tipNode;
  }

  function showTip(evt, content) {
    const t = tip();
    clear(t);
    if (typeof content === "string") t.innerHTML = content;
    else IV.dom.append(t, content);
    t.classList.add("open");
    moveTip(evt);
  }

  function moveTip(evt) {
    const t = tip();
    const r = t.getBoundingClientRect();
    let x = evt.clientX + TIP_OFFSET;
    let y = evt.clientY + TIP_OFFSET;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - TIP_OFFSET;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - TIP_OFFSET;
    t.style.left = Math.max(4, x) + "px";
    t.style.top = Math.max(4, y) + "px";
  }

  function hideTip() {
    if (tipNode) tipNode.classList.remove("open");
  }

  function tipHTML(title, rows, swatch) {
    let h = '<div class="t-title">'
      + (swatch ? '<span class="t-swatch" style="background:' + swatch + '"></span>' : "")
      + F.escapeHtml(title) + "</div>";
    const wide = (rows || []).some(function (r) { return r && r.length > 2; });
    for (const r of rows || []) {
      if (r == null) continue;
      if (!Array.isArray(r) && r.head) {
        h += '<div class="t-sec">' + F.escapeHtml(r.head) + "</div>";
        continue;
      }
      if (r.length > 2) {
        h += '<div class="t-row t-row2"><span class="tk">' + F.escapeHtml(r[0])
          + '</span><span class="tv">' + F.escapeHtml(r[1])
          + '</span><span class="tv">' + F.escapeHtml(r[2]) + "</span></div>";
      } else if (r.length === 1) {
        h += '<div class="t-head2"><span class="tk"></span>'
          + '<span class="tv">' + F.escapeHtml(r[0]) + "</span></div>";
      } else {
        h += '<div class="t-row' + (wide ? " t-row2 t-span" : "") + '">'
          + '<span class="tk">' + F.escapeHtml(r[0])
          + '</span><span class="tv">' + F.escapeHtml(r[1]) + "</span></div>";
      }
    }
    return h;
  }

  function bindHover(node, makeContent, swatch) {
    node.addEventListener("mouseenter", function (e) {
      const c = makeContent();
      if (c) showTip(e, c);
    });
    node.addEventListener("mousemove", moveTip);
    node.addEventListener("mouseleave", hideTip);
    if (swatch) node.style.cursor = "default";
  }

  function linear(d0, d1, r0, r1) {
    const span = (d1 - d0) || 1;
    const f = function (v) { return r0 + (v - d0) / span * (r1 - r0); };
    f.invert = function (p) { return d0 + (p - r0) / ((r1 - r0) || 1) * span; };
    f.domain = [d0, d1];
    f.range = [r0, r1];
    return f;
  }

  const TICK_CAP = 200;

  function ticks(lo, hi, count) {
    if (!isFinite(lo) || !isFinite(hi)) return [];
    if (hi === lo) return [lo];
    if (hi < lo) { const t = lo; lo = hi; hi = t; }
    const n = Math.max(1, count || 5);
    const raw = (hi - lo) / n;
    if (!(raw > 0)) return [lo, hi];
    const mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    const norm = raw / mag;
    const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
    if (!(step > 0)) return [lo, hi];
    const out = [];
    for (let v = Math.ceil(lo / step) * step;
         v <= hi + step * 1e-9 && out.length < TICK_CAP;
         v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out;
  }

  function fmtTick(v, kind) {
    if (kind === "pct") return Math.round(v * 100) + "%";
    if (kind === "log1p") {
      const back = Math.pow(10, v) - 1;
      return back >= 1000 ? F.compact(back, 0) : (back < 1 ? back.toFixed(1) : String(Math.round(back)));
    }
    if (Math.abs(v) >= 1000) return F.compact(v, v >= 1e6 ? 1 : 0);
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 100) / 100);
  }

  function frame(host, opts) {
    const o = opts || {};
    const width = o.width || host.clientWidth || 480;
    const height = o.height || 220;
    const m = Object.assign({ top: 10, right: 12, bottom: 28, left: 46 }, o.margin);
    const w = Math.max(40, width - m.left - m.right);
    const h = Math.max(30, height - m.top - m.bottom);

    const svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      preserveAspectRatio: "none",
      height: height,
      role: "img",
    });
    if (o.label) svg.appendChild(svgEl("title")).textContent = o.label;
    const g = svgEl("g", { transform: "translate(" + m.left + "," + m.top + ")" });
    svg.appendChild(g);
    host.appendChild(svg);
    return { svg: svg, g: g, w: w, h: h, m: m, width: width, height: height };
  }

  function yAxis(fr, scale, opts) {
    const o = opts || {};
    const tv = o.values || ticks(scale.domain[0], scale.domain[1], o.count || 4);
    for (const v of tv) {
      const y = scale(v);
      if (y < -1 || y > fr.h + 1) continue;
      if (o.grid !== false) {
        fr.g.appendChild(svgEl("line", {
          class: "grid-line", x1: 0, x2: fr.w, y1: y, y2: y,
        }));
      }
      const t = svgEl("text", {
        class: "tick-text", x: -6, y: y, "text-anchor": "end",
        "dominant-baseline": "middle",
      });
      t.textContent = o.format ? o.format(v) : fmtTick(v, o.kind);
      fr.g.appendChild(t);
    }
    if (o.title) {
      const t = svgEl("text", {
        class: "axis-title", transform: "rotate(-90)",
        x: -fr.h / 2, y: -fr.m.left + 11, "text-anchor": "middle",
      });
      t.textContent = o.title;
      fr.g.appendChild(t);
    }
  }

  function xAxis(fr, scale, opts) {
    const o = opts || {};
    fr.g.appendChild(svgEl("line", {
      class: "axis-line", x1: 0, x2: fr.w, y1: fr.h, y2: fr.h,
    }));
    const tv = o.values || ticks(scale.domain[0], scale.domain[1], o.count || 5);
    for (const v of tv) {
      const x = scale(v);
      if (x < -1 || x > fr.w + 1) continue;
      if (o.grid) {
        fr.g.appendChild(svgEl("line", {
          class: "grid-line", x1: x, x2: x, y1: 0, y2: fr.h,
        }));
      }
      const t = svgEl("text", {
        class: "tick-text", x: x, y: fr.h + 13, "text-anchor": "middle",
      });
      t.textContent = o.format ? o.format(v) : fmtTick(v, o.kind);
      fr.g.appendChild(t);
    }
    if (o.title) {
      const t = svgEl("text", {
        class: "axis-title", x: fr.w / 2, y: fr.h + fr.m.bottom - 2,
        "text-anchor": "middle",
      });
      t.textContent = o.title;
      fr.g.appendChild(t);
    }
  }

  function barPath(x, y, w, h, r, horizontal) {
    const rr = Math.max(0, Math.min(r, horizontal ? w : h, w / 2, h / 2));
    if (rr <= 0.5) return "M" + x + "," + y + "h" + w + "v" + h + "h" + (-w) + "Z";
    if (horizontal) {
      return "M" + x + "," + y
        + "h" + (w - rr) + "a" + rr + "," + rr + " 0 0 1 " + rr + "," + rr
        + "v" + (h - 2 * rr) + "a" + rr + "," + rr + " 0 0 1 " + (-rr) + "," + rr
        + "h" + (-(w - rr)) + "Z";
    }
    return "M" + x + "," + (y + h)
      + "v" + (-(h - rr)) + "a" + rr + "," + rr + " 0 0 1 " + rr + "," + (-rr)
      + "h" + (w - 2 * rr) + "a" + rr + "," + rr + " 0 0 1 " + rr + "," + rr
      + "v" + (h - rr) + "Z";
  }

  function histogram(host, hist, opts) {
    clear(host);
    const o = opts || {};
    if (!hist || !hist.counts || !hist.counts.length) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "No data" }));
      return;
    }
    const counts = hist.counts, edges = hist.edges;

    if (IV.px && IV.px.available()) {
      const total = counts.reduce(function (a, b) { return a + b; }, 0);
      const bins = counts.map(function (c, i) {
        const lo = edges[i], hi = edges[i + 1];
        const range = hist.log
          ? F.compact(Math.pow(10, lo) - 1, 1) + " – " + F.compact(Math.pow(10, hi) - 1, 1)
          : fmtTick(lo, o.xKind) + " – " + fmtTick(hi, o.xKind);
        const tops = (hist.tops && hist.tops[i]) || [];
        let hv = "<b>" + F.escapeHtml((o.binLabel ? o.binLabel + " " : "") + range) + "</b>"
          + "<br>" + F.escapeHtml(o.yTitle || "Features") + ": " + F.int(c)
          + "<br>Share: " + F.pctOf(c, total, 1);
        if (tops.length) {
          hv += "<br><br><b>" + F.escapeHtml(o.topLabel || "Largest here")
            + (o.topUnit ? " (" + F.escapeHtml(o.topUnit) + ")" : "") + "</b>";
          for (const t of tops) {
            hv += "<br>" + F.escapeHtml(String(t[0]))
              + (t[1] == null ? "" : "  " + F.compact(t[1], 1));
          }
        }
        return { label: range, count: c, hover: hv };
      });
      const drew = IV.px.binnedBars(host, bins, {
        height: o.height || (IV.px && IV.px.GEOM ? IV.px.GEOM.height : 220),
        xTitle: o.xTitle, yTitle: o.yTitle || "Features",
        color: o.color, logY: false,
        exportName: o.xTitle || "histogram",
      });
      if (drew) return null;
    }

    const fr = frame(host, {
      height: o.height || 190, width: o.width,
      margin: o.margin || { top: 8, right: 12, bottom: 34, left: 48 },
      label: o.label,
    });
    const maxC = Math.max.apply(null, counts) || 1;
    const x = linear(edges[0], edges[edges.length - 1], 0, fr.w);
    const y = linear(0, maxC, fr.h, 0);

    yAxis(fr, y, { title: o.yTitle || "Features", count: 4 });
    xAxis(fr, x, {
      title: o.xTitle, kind: hist.log ? "log1p" : o.xKind, count: o.xTicks || 5,
    });

    const fill = o.color || token("--seq-600");
    const nb = counts.length;
    const slot = fr.w / nb;
    const bw = Math.max(1, slot - GAP);
    for (let i = 0; i < nb; i++) {
      const c = counts[i];
      if (!c) continue;
      const hgt = fr.h - y(c);
      const bx = i * slot + (slot - bw) / 2;
      const p = svgEl("path", {
        d: barPath(bx, y(c), bw, hgt, R, false), fill: fill,
      });
      const lo = edges[i], hi = edges[i + 1];
      bindHover(p, function () {
        const range = hist.log
          ? F.compact(Math.pow(10, lo) - 1, 1) + " – " + F.compact(Math.pow(10, hi) - 1, 1)
          : fmtTick(lo, o.xKind) + " – " + fmtTick(hi, o.xKind);
        return tipHTML(o.binLabel ? o.binLabel + " " + range : range,
                       [[o.yTitle || "Features", F.int(c)],
                        ["Share", F.pctOf(c, counts.reduce(function (a, b) { return a + b; }, 0))]],
                       fill);
      });
      fr.g.appendChild(p);
    }
    return fr;
  }

  function barsH(host, items, opts) {
    clear(host);
    const o = opts || {};
    if (!items || !items.length) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "No data" }));
      return;
    }
    const rowH = o.rowH || 20;
    const labelW = o.labelW || 168;
    const total = o.total != null ? o.total
      : items.reduce(function (a, b) { return a + (b.value || 0); }, 0);
    const pctOf = function (d) {
      if (d.of != null) return d.of > 0 ? F.pctOf(d.value, d.of, 1) : null;
      return total ? F.pctOf(d.value, total, 1) : null;
    };
    let widestNum = 0;
    for (const d of items) {
      const w = F.int(d.value || 0).length;
      if (w > widestNum) widestNum = w;
    }
    const valueW = o.valueW
      || Math.max(92, widestNum * 7 + (total ? 46 : 10));
    const max = o.max != null ? o.max
      : Math.max.apply(null, items.map(function (d) { return d.value || 0; })) || 1;

    const wrap = el("div", { class: "bars-h" });
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = labelW + "px minmax(60px, 1fr) " + valueW + "px";
    wrap.style.gap = "3px 10px";
    wrap.style.alignItems = "center";
    wrap.style.fontSize = "var(--fs-sm)";

    for (const d of items) {
      const lab = el("div", { class: "nowrap", style: { overflow: "hidden",
        textOverflow: "ellipsis", color: "var(--ink-2)" }, text: d.label });
      if (d.help) {
        bindHover(lab, (function (row) {
          return function () {
            return tipHTML(row.label, [["", row.help]], row.color);
          };
        })(d));
      }
      wrap.appendChild(lab);

      const track = el("div", { style: { position: "relative", height: rowH + "px",
        background: "var(--surface-sunk)", borderRadius: R + "px" } });
      const frac = max > 0 ? (d.value || 0) / max : 0;
      const bar = el("div", {
        style: {
          position: "absolute", left: "0", top: "0", bottom: "0",
          width: Math.max(frac > 0 ? 2 : 0, frac * 100) + "%",
          background: d.color || token("--seq-600"),
          borderRadius: R + "px",
        },
      });
      track.appendChild(bar);
      if (d.onClick) {
        track.style.cursor = "pointer";
        track.addEventListener("click", d.onClick);
      }
      bindHover(track, function () {
        const fmtV = o.fmt || function (v) { return F.int(v); };
        return tipHTML(d.label, [
          [o.valueLabel || "Count",
            d.valueText != null ? d.valueText : fmtV(d.value)],
          pctOf(d) ? [o.shareLabel || "Share", pctOf(d)] : null,
        ].filter(Boolean), d.color);
      });
      if (d.help) track.setAttribute("aria-label", d.label + ": " + d.help);
      wrap.appendChild(track);

      wrap.appendChild(el("div", {
        class: "num right small nowrap",
        style: { color: "var(--ink-2)" },
        html: (d.valueText != null
                ? F.escapeHtml(d.valueText)
                : (o.fmt ? o.fmt(d.value) : F.int(d.value)))
          + (pctOf(d)
            ? ' <span class="faint xsmall">' + pctOf(d) + "</span>" : ""),
      }));
    }
    host.appendChild(wrap);
  }

  function stackBar(host, segments, opts) {
    clear(host);
    const o = opts || {};
    const segs = (segments || []).filter(function (s) { return (s.value || 0) > 0; });
    if (!segs.length) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "No data" }));
      return;
    }
    const total = segs.reduce(function (a, b) { return a + b.value; }, 0);
    const h = o.height || 26;
    const row = el("div", { style: { display: "flex", gap: GAP + "px", height: h + "px",
      borderRadius: R + "px", overflow: "hidden" } });
    for (const s of segs) {
      const frac = s.value / total;
      const cell = el("div", {
        style: {
          flex: frac + " 1 0", minWidth: "3px", background: s.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        },
      });
      if (frac >= (o.labelMin || 0.08) && o.inlineLabels !== false) {
        cell.appendChild(el("span", {
          class: "xsmall nowrap",
          style: { color: "#fff", fontWeight: "600", mixBlendMode: "normal",
                   textShadow: "0 0 3px rgba(0,0,0,.45)" },
          text: F.pct(frac, frac < 0.1 ? 1 : 0),
        }));
      }
      bindHover(cell, function () {
        return tipHTML(s.label, [
          [o.valueLabel || "Molecules", F.int(s.value)],
          ["Share", F.pct(frac, 2)],
          s.help ? ["Meaning", s.help] : null,
        ].filter(Boolean), s.color);
      });
      row.appendChild(cell);
    }
    host.appendChild(row);
    if (o.legend !== false) host.appendChild(legend(segs, { total: total }));
  }

  function stackGroups(host, groups, keys, opts) {
    clear(host);
    const o = opts || {};
    if (!groups || !groups.length) {
      host.appendChild(el("div", { class: "empty", text: "No data" }));
      return;
    }
    const wrap = el("div", { style: { display: "grid", gap: "6px" } });
    const shared = o.scale === "shared";
    let maxTotal = 0;
    if (shared) {
      for (const grp of groups) {
        const tt = keys.reduce(function (a, k) { return a + (grp.values[k] || 0); }, 0);
        if (tt > maxTotal) maxTotal = tt;
      }
    }
    for (const grp of groups) {
      const total = keys.reduce(function (a, k) { return a + (grp.values[k] || 0); }, 0);
      const line = el("div", { style: { display: "grid",
        gridTemplateColumns: (o.labelW || 120) + "px 1fr " + (o.valueW || 84) + "px",
        gap: "10px", alignItems: "center" } });
      line.appendChild(el("div", { class: "small nowrap",
        style: { color: "var(--ink-2)" }, text: grp.label }));
      const barHost = el("div");
      stackBar(barHost, keys.map(function (k) {
        return { label: o.labels ? o.labels[k] || k : k, value: grp.values[k] || 0,
                 color: o.colors[k], help: o.help ? o.help[k] : null };
      }), { height: o.height || 18, legend: false, labelMin: 0.14,
            valueLabel: o.valueLabel });
      if (shared) {
        barHost.style.width = (maxTotal > 0
          ? Math.max(0.4, 100 * total / maxTotal) : 0) + "%";
      }
      line.appendChild(barHost);
      line.appendChild(el("div", { class: "num right small faint", text: F.compact(total) }));
      wrap.appendChild(line);
    }
    host.appendChild(wrap);
    if (o.legend !== false) {
      host.appendChild(legend(keys.map(function (k) {
        return { label: o.labels ? o.labels[k] || k : k, color: o.colors[k] };
      })));
    }
  }

  function legend(items, opts) {
    const o = opts || {};
    const box = el("div", { class: "legend", role: "list" });
    for (const it of items) {
      if (!it) continue;
      const sw = { background: it.color };
      if (it.shape === "short") {
        sw.height = "5px"; sw.alignSelf = "center";
      } else if (it.shape === "outline") {
        sw.background = "transparent";
        sw.border = "1.5px solid " + (it.stroke || token("--gm-600"));
      } else if (it.shape === "line") {
        sw.height = "2px"; sw.alignSelf = "center"; sw.borderRadius = "0";
      }
      const node = el("span", { class: "legend-item", role: "listitem" }, [
        el("span", { class: "swatch", style: sw }),
        el("span", { text: it.label }),
      ]);
      if (o.total && it.value != null) {
        node.appendChild(el("span", { class: "lv", text: F.pctOf(it.value, o.total, 1) }));
      }
      if (it.help) node.title = it.help;
      box.appendChild(node);
    }
    return box;
  }

  function scatter(host, data, opts) {
    clear(host);
    const o = opts || {};
    const n = data.n;
    if (!n) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "Nothing to plot" }));
      return;
    }
    const width = o.width || host.clientWidth || 560;
    const height = o.height || 300;
    const m = Object.assign({ top: 10, right: 14, bottom: 34, left: 50 }, o.margin);
    const w = Math.max(40, width - m.left - m.right);
    const h = Math.max(30, height - m.top - m.bottom);

    let xlo = o.xDomain ? o.xDomain[0] : Infinity;
    let xhi = o.xDomain ? o.xDomain[1] : -Infinity;
    let ylo = o.yDomain ? o.yDomain[0] : Infinity;
    let yhi = o.yDomain ? o.yDomain[1] : -Infinity;
    if (!o.xDomain || !o.yDomain) {
      for (let i = 0; i < n; i++) {
        const xv = data.x(i), yv = data.y(i);
        if (!o.xDomain && isFinite(xv)) { if (xv < xlo) xlo = xv; if (xv > xhi) xhi = xv; }
        if (!o.yDomain && isFinite(yv)) { if (yv < ylo) ylo = yv; if (yv > yhi) yhi = yv; }
      }
    }
    if (!isFinite(xlo)) { xlo = 0; xhi = 1; }
    if (!isFinite(ylo)) { ylo = 0; yhi = 1; }
    if (xhi === xlo) xhi = xlo + 1;
    if (yhi === ylo) yhi = ylo + 1;

    const shell = el("div", { style: { position: "relative", width: "100%" } });
    host.appendChild(shell);

    const fr = frame(shell, { width: width, height: height, margin: m, label: o.label });
    fr.svg.style.position = "relative";
    fr.svg.style.zIndex = "0";
    fr.svg.style.zIndex = "2";
    fr.svg.style.pointerEvents = "none";

    const x = linear(xlo, xhi, 0, w);
    const y = linear(ylo, yhi, h, 0);
    yAxis(fr, y, { title: o.yTitle, kind: o.yKind, count: o.yTicks || 4,
                   format: o.yTickFormat });
    xAxis(fr, x, { title: o.xTitle, kind: o.xKind, count: o.xTicks || 5,
                   grid: !!o.xGrid, format: o.xTickFormat });

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = el("canvas", {
      width: Math.round(w * dpr), height: Math.round(h * dpr),
      style: {
        position: "absolute", left: m.left + "px", top: m.top + "px",
        width: w + "px", height: h + "px", zIndex: "2",
      },
    });
    shell.appendChild(cv);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);

    const rad = o.radius || (n > 20000 ? 1.6 : n > 4000 ? 2.2 : 3.2);
    const base = o.color || token("--seq-600");
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const drawn = new Uint8Array(n);

    ctx.globalAlpha = o.alpha != null ? o.alpha : (n > 20000 ? 0.42 : n > 4000 ? 0.6 : 0.78);
    let lastColor = null;
    for (let i = 0; i < n; i++) {
      const xv = data.x(i), yv = data.y(i);
      if (!isFinite(xv) || !isFinite(yv)) { px[i] = NaN; continue; }
      const cx = x(xv), cy = y(yv);
      px[i] = cx; py[i] = cy;
      drawn[i] = 1;
      const c = data.color ? data.color(i) : base;
      if (c !== lastColor) { ctx.fillStyle = c; lastColor = c; }
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, 6.283185307179586);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (o.highlight && o.highlight.length) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = token("--surface");
      const hc = o.highlightColor || token("--brand");
      for (const i of o.highlight) {
        if (!drawn[i]) continue;
        ctx.beginPath();
        ctx.arc(px[i], py[i], Math.max(4, rad + 2.4), 0, 6.283185307179586);
        ctx.fillStyle = hc;
        ctx.fill();
        ctx.stroke();
      }
    }

    if (o.labelPoints && o.labelPoints.length) {
      for (const lp of o.labelPoints) {
        if (!drawn[lp.i]) continue;
        const tx = px[lp.i], ty = py[lp.i] - 9;
        const halo = svgEl("text", {
          x: tx, y: ty, "text-anchor": "middle", class: "mark-label",
          stroke: token("--surface"), "stroke-width": 3,
          "stroke-linejoin": "round", "paint-order": "stroke",
        });
        halo.textContent = lp.text;
        halo.setAttribute("fill", token("--ink"));
        fr.g.appendChild(halo);
      }
    }

    const CELL = 14;
    const cols = Math.ceil(w / CELL) + 1;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      if (!drawn[i]) continue;
      const k = ((py[i] / CELL) | 0) * cols + ((px[i] / CELL) | 0);
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      arr.push(i);
    }
    const hit = el("div", {
      style: {
        position: "absolute", left: m.left + "px", top: m.top + "px",
        width: w + "px", height: h + "px", zIndex: "3", cursor: o.onPick ? "pointer" : "crosshair",
      },
    });
    shell.appendChild(hit);

    let hovered = -1;
    function pick(evt) {
      const r = hit.getBoundingClientRect();
      const mx = evt.clientX - r.left, my = evt.clientY - r.top;
      const cx0 = (mx / CELL) | 0, cy0 = (my / CELL) | 0;
      let best = -1, bestD = 400;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = grid.get((cy0 + dy) * cols + (cx0 + dx));
          if (!arr) continue;
          for (const i of arr) {
            const d = (px[i] - mx) * (px[i] - mx) + (py[i] - my) * (py[i] - my);
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      return best;
    }
    hit.addEventListener("mousemove", function (e) {
      const i = pick(e);
      if (i < 0) { hovered = -1; hideTip(); return; }
      if (i !== hovered) {
        hovered = i;
        showTip(e, data.tip(i));
      } else moveTip(e);
    });
    hit.addEventListener("mouseleave", function () { hovered = -1; hideTip(); });
    if (o.onPick) {
      hit.addEventListener("click", function (e) {
        const i = pick(e);
        if (i >= 0) o.onPick(i);
      });
    }
    return { x: x, y: y, frame: fr };
  }

  function heatmap(host, opts) {
    clear(host);
    const o = opts;
    const nr = o.rows.length, nc = o.cols.length;
    if (!nr || !nc) {
      host.appendChild(el("div", { class: "empty", text: "No data" }));
      return;
    }
    const cellW = o.cellW || Math.max(8, Math.min(46, 620 / nc));
    const cellH = o.cellH || Math.max(3, Math.min(18, 620 / nr));
    const labelW = o.labelW || 132;
    let widestCol = 0;
    for (let c = 0; c < nc; c++) {
      const L = String(o.cols[c] == null ? "" : o.cols[c]).length;
      if (L > widestCol) widestCol = L;
    }
    const COL_PX_PER_CHAR = 6.4;
    const colTextW = widestCol * COL_PX_PER_CHAR;
    const rotate = colTextW + 6 > cellW;
    const BAND_H = 7;
    const bandSpace = (o.colBand && o.colBand.length) ? BAND_H + 13 : 0;
    const headH = (o.headH || (rotate ? Math.min(160, Math.max(56, colTextW + 14)) : 56))
      + bandSpace;
    const w = nc * cellW, h = nr * cellH;

    function exportSVG() {
      const W = labelW + w + 16, H = headH + h + 6;
      const esc = function (t) {
        return String(t == null ? "" : t)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      };
      const out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W
        + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
      out.push('<rect width="' + W + '" height="' + H + '" fill="'
        + (token("--surface") || "#fff") + '"/>');
      const fnt = 'font-family="Inter, system-ui, sans-serif"';
      const ink = token("--ink-2") || "#444";
      out.push('<g ' + fnt + ' font-size="10" fill="' + ink + '">');
      for (let c = 0; c < nc; c++) {
        const cx = labelW + c * cellW + cellW / 2, cy = headH - 6 - bandSpace;
        out.push('<text x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '"'
          + ' text-anchor="' + (rotate ? "start" : "middle") + '"'
          + (rotate ? ' transform="rotate(-90 ' + cx.toFixed(1) + ' '
              + cy.toFixed(1) + ')"' : "")
          + '>' + esc(o.cols[c]) + '</text>');
      }
      out.push('</g>');
      if (o.colBand && o.colBand.length) {
        const bandH = BAND_H;
        out.push('<g shape-rendering="crispEdges">');
        for (let c = 0; c < nc; c++) {
          const b = o.colBand[c];
          if (!b || !b.color) continue;
          out.push('<rect x="' + (labelW + c * cellW).toFixed(2)
            + '" y="' + (headH - bandH + 1).toFixed(2)
            + '" width="' + Math.max(1, cellW - 0.5).toFixed(2)
            + '" height="' + (bandH - 2) + '" fill="' + b.color + '"/>');
        }
        out.push('</g>');
      }
      out.push('<g shape-rendering="crispEdges">');
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          const v = o.get(r, c);
          if (v == null) continue;
          out.push('<rect x="' + (labelW + c * cellW).toFixed(2)
            + '" y="' + (headH + r * cellH).toFixed(2)
            + '" width="' + cellW.toFixed(2) + '" height="' + cellH.toFixed(2)
            + '" fill="' + o.scale(v) + '"/>');
        }
      }
      out.push('</g>');
      const fs = Math.max(6, Math.min(11, cellH - 1));
      out.push('<g ' + fnt + ' font-size="' + fs.toFixed(1) + '" fill="' + ink
        + '" text-anchor="end">');
      for (let r = 0; r < nr; r++) {
        out.push('<text x="' + (labelW - 6) + '" y="'
          + (headH + r * cellH + cellH / 2 + fs * 0.36).toFixed(1) + '">'
          + esc(o.rows[r]) + '</text>');
      }
      out.push('</g></svg>');
      IV.dom.download((o.exportName || "heatmap") + ".svg", out.join(""),
        "image/svg+xml;charset=utf-8");
    }

    const bar = el("div", { style: { display: "flex", justifyContent: "flex-end",
      marginBottom: "4px" } });
    bar.appendChild(el("button", { class: "btn btn-sm", title: "Download as SVG",
      text: "Download SVG",
      onclick: exportSVG }));
    host.appendChild(bar);

    const shell = el("div", { style: { position: "relative", overflowX: "auto" } });
    const inner = el("div", { style: { position: "relative",
      width: (labelW + w + 16) + "px", height: (headH + h + 6) + "px" } });
    shell.appendChild(inner);
    host.appendChild(shell);

    const hd = svgEl("svg", { width: labelW + w + 16, height: headH,
      style: "position:absolute;left:0;top:0;overflow:visible" });
    for (let c = 0; c < nc; c++) {
      const cx = labelW + c * cellW + cellW / 2;
      const cy = headH - 6 - bandSpace;
      const t = svgEl("text", { class: "tick-text", x: cx, y: cy,
        "text-anchor": rotate ? "start" : "middle" });
      if (rotate) {
        t.setAttribute("transform", "rotate(-90 " + cx + " " + cy + ")");
        t.setAttribute("dominant-baseline", "central");
      }
      t.textContent = o.cols[c];
      hd.appendChild(t);
    }
    if (o.colBand && o.colBand.length) {
      const bandH = BAND_H;
      for (let c = 0; c < nc; c++) {
        const b = o.colBand[c];
        if (!b || !b.color) continue;
        hd.appendChild(svgEl("rect", {
          x: labelW + c * cellW, y: headH - bandH + 1,
          width: Math.max(1, cellW - 0.5), height: bandH - 2,
          fill: b.color,
          "data-col-band": b.label || "",
        }));
      }
      let runStart = 0;
      for (let c = 1; c <= nc; c++) {
        const prev = o.colBand[c - 1], cur = c < nc ? o.colBand[c] : null;
        const same = cur && prev && cur.label === prev.label;
        if (same) continue;
        const lab = prev && prev.label;
        const runW = (c - runStart) * cellW;
        if (lab && runW >= 34) {
          const t2 = svgEl("text", {
            x: labelW + runStart * cellW + runW / 2, y: headH - bandH - 3,
            "text-anchor": "middle", class: "mark-label",
            style: "font-weight:700;fill:" + (prev.color || "currentColor"),
          });
          t2.textContent = lab;
          hd.appendChild(t2);
        }
        runStart = c;
      }
    }
    inner.appendChild(hd);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = el("canvas", {
      width: Math.round(w * dpr), height: Math.round(h * dpr),
      style: { position: "absolute", left: labelW + "px", top: headH + "px",
               width: w + "px", height: h + "px" },
    });
    inner.appendChild(cv);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);

    const gapX = cellW >= 6 ? GAP : (cellW >= 2 ? Math.max(0.5, cellW * 0.16) : 0);
    const gapY = cellH >= 6 ? GAP : (cellH >= 2 ? Math.max(0.5, cellH * 0.16) : 0);
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        ctx.fillStyle = o.scale(o.get(r, c), r, c);
        ctx.fillRect(c * cellW, r * cellH,
                     Math.max(0.5, cellW - gapX), Math.max(0.5, cellH - gapY));
      }
    }

    if (cellH >= 9 || o.alwaysLabelRows) {
      const rl = svgEl("svg", { width: labelW, height: h,
        style: "position:absolute;left:0;top:" + headH + "px;overflow:visible" });
      const baseFs = cellH < 9 ? Math.max(4.5, cellH - 1.5) : null;
      const MAG = 14;
      const texts = [];
      const HIDE = Math.max(1, Math.ceil((MAG * 1.1) / Math.max(1, cellH) / 2));
      let plate = null;
      function applyMag(centre) {
        if (plate) { plate.remove ? plate.remove() : null; plate = null; }
        for (let r = 0; r < texts.length; r++) {
          const t = texts[r];
          if (centre == null) {
            t.style.fontSize = baseFs ? baseFs + "px" : "";
            t.style.fontWeight = "";
            t.style.fill = "";
            t.style.opacity = "";
            continue;
          }
          const dist = Math.abs(r - centre);
          if (dist === 0) continue;
          t.style.fontSize = baseFs ? baseFs + "px" : "";
          t.style.fontWeight = "";
          t.style.fill = token("--ink-faint");
          t.style.opacity = dist <= HIDE ? "0" : "0.28";
        }
        if (centre == null) return;
        const t = texts[centre];
        if (!t) return;
        const padY = MAG * 0.75, padX = 6;
        plate = svgEl("rect", {
          x: 0, y: centre * cellH + cellH / 2 - padY,
          width: labelW, height: padY * 2,
          fill: token("--surface"), rx: 3,
        });
        plate.style.pointerEvents = "none";
        t.parentNode.insertBefore(plate, t.parentNode.firstChild);
        t.style.fontSize = MAG + "px";
        t.style.fontWeight = "650";
        t.style.fill = token("--brand");
        t.style.opacity = "1";
        t.parentNode.appendChild(t);
      }

      for (let r = 0; r < nr; r++) {
        const t = svgEl("text", { class: "tick-text dock-label", x: labelW - 8,
          y: r * cellH + cellH / 2, "text-anchor": "end",
          "dominant-baseline": "middle",
          style: baseFs ? "font-size:" + baseFs + "px" : null });
        t.textContent = o.rows[r];
        texts.push(t);
        if (o.onPickRow) {
          t.style.cursor = "pointer";
          t.addEventListener("click", (function (i) {
            return function () { o.onPickRow(i); };
          })(r));
        }
        rl.appendChild(t);
      }

      if (baseFs && baseFs < MAG - 1) {
        for (const t of texts) t.style.transition =
          "font-size .08s linear, opacity .08s linear, fill .08s linear";
        const gutter = el("div", { style: { position: "absolute", left: "0",
          top: headH + "px", width: labelW + "px", height: h + "px" } });
        gutter.addEventListener("mousemove", function (e) {
          const b = gutter.getBoundingClientRect();
          const r = Math.min(nr - 1, Math.max(0, ((e.clientY - b.top) / cellH) | 0));
          applyMag(r);
        });
        gutter.addEventListener("mouseleave", function () { applyMag(null); });
        if (o.onPickRow) {
          gutter.style.cursor = "pointer";
          gutter.addEventListener("click", function (e) {
            const b = gutter.getBoundingClientRect();
            const r = Math.min(nr - 1, Math.max(0, ((e.clientY - b.top) / cellH) | 0));
            o.onPickRow(r);
          });
        }
        inner.appendChild(rl);
        inner.appendChild(gutter);
      } else {
        inner.appendChild(rl);
      }
    }

    const hit = el("div", { style: { position: "absolute", left: labelW + "px",
      top: headH + "px", width: w + "px", height: h + "px",
      cursor: o.onPickRow ? "pointer" : "default" } });
    inner.appendChild(hit);
    hit.addEventListener("mousemove", function (e) {
      const b = hit.getBoundingClientRect();
      const c = Math.min(nc - 1, Math.max(0, ((e.clientX - b.left) / cellW) | 0));
      const r = Math.min(nr - 1, Math.max(0, ((e.clientY - b.top) / cellH) | 0));
      showTip(e, o.tip(r, c));
    });
    hit.addEventListener("mouseleave", hideTip);
    if (o.onPickRow) {
      hit.addEventListener("click", function (e) {
        const b = hit.getBoundingClientRect();
        const r = Math.min(nr - 1, Math.max(0, ((e.clientY - b.top) / cellH) | 0));
        o.onPickRow(r);
      });
    }
    return shell;
  }

  function ranked(host, values, opts) {
    clear(host);
    const o = opts || {};
    const n = values.length;
    if (!n) {
      host.appendChild(el("div", { class: "empty", text: "No data" }));
      return;
    }
    const idx = Array.from({ length: n }, function (_, i) { return i; })
      .sort(function (a, b) { return values[b] - values[a]; });
    scatter(host, {
      n: n,
      x: function (i) { return i + 1; },
      y: function (i) { return o.log ? Math.log10(values[idx[i]] + 1) : values[idx[i]]; },
      tip: function (i) {
        return tipHTML(o.label ? o.label(idx[i]) : "Rank " + (i + 1),
                       [["Rank", F.int(i + 1)],
                        [o.valueLabel || "Value", o.fmt ? o.fmt(values[idx[i]]) : F.tpm(values[idx[i]])]]);
      },
    }, {
      height: o.height || 190, xTitle: o.xTitle || "Rank",
      yTitle: o.yTitle, yKind: o.log ? "log1p" : null,
      color: o.color, radius: 1.6, alpha: 0.55,
      onPick: o.onPick ? function (i) { o.onPick(idx[i]); } : null,
    });
  }

  function track(host, spec) {
    const w = spec.width || 460;
    const h = spec.height || 18;
    const svg = svgEl("svg", { class: "track-svg", viewBox: "0 0 " + w + " " + h,
      height: h, preserveAspectRatio: "none" });
    const g0 = spec.gStart, g1 = spec.gEnd;
    const span = (g1 - g0) || 1;
    const sx = function (p) { return (p - g0) / span * w; };
    const midY = h / 2;
    const utrH = Math.max(4, h * 0.42);
    const cdsH = Math.max(7, h * 0.78);
    const color = spec.color || token("--seq-600");
    const dim = spec.dim;

    const exons = spec.exons || [];
    if (exons.length) {
      const a = sx(exons[0][0]), b = sx(exons[exons.length - 1][1]);
      svg.appendChild(svgEl("line", {
        x1: a, x2: b, y1: midY, y2: midY,
        stroke: dim ? token("--border-strong") : color,
        "stroke-width": 1.4, opacity: dim ? 0.7 : 0.85,
      }));
      if (spec.strand !== 2 && b - a > 40) {
        const dir = spec.strand === 1 ? -1 : 1;
        for (let px = a + 14; px < b - 6; px += 26) {
          let inExon = false;
          for (const ex of exons) {
            if (px >= sx(ex[0]) - 1 && px <= sx(ex[1]) + 1) { inExon = true; break; }
          }
          if (inExon) continue;
          svg.appendChild(svgEl("path", {
            d: "M" + (px - 2.4 * dir) + "," + (midY - 2.8)
               + "L" + (px + 2.4 * dir) + "," + midY
               + "L" + (px - 2.4 * dir) + "," + (midY + 2.8),
            fill: "none", stroke: token("--ink-faint"), "stroke-width": 1.1,
            "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.75,
          }));
        }
      }
    }

    const cds = spec.cds && spec.cds[1] > spec.cds[0] ? spec.cds : null;
    for (const ex of exons) {
      const x0 = sx(ex[0]), x1 = sx(ex[1]);
      const bw = Math.max(1.2, x1 - x0);
      const coding = cds && ex[1] >= cds[0] && ex[0] <= cds[1];
      const eh = coding ? cdsH : utrH;
      const r = svgEl("rect", {
        x: x0, y: midY - eh / 2, width: bw, height: eh, rx: 1.5,
        fill: dim ? "none" : color,
        stroke: dim ? token("--border-strong") : "none",
        "stroke-width": dim ? 1.2 : 0,
        opacity: dim ? 0.9 : 1,
      });
      if (spec.tipFor) {
        bindHover(r, (function (e) {
          return function () { return spec.tipFor(e); };
        })(ex), color);
      }
      svg.appendChild(r);
    }
    host.appendChild(svg);
    return svg;
  }

  function sparkBars(values, opts) {
    const o = opts || {};
    const n = values.length;
    const w = o.width || 62, h = o.height || 14;
    const max = Math.max.apply(null, values) || 1;
    const svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h,
      style: "vertical-align:middle" });
    const slot = w / n;
    const bw = Math.max(1, slot - GAP);
    for (let i = 0; i < n; i++) {
      const bh = Math.max(values[i] > 0 ? 1.2 : 0, (values[i] / max) * h);
      if (!bh) continue;
      svg.appendChild(svgEl("rect", {
        x: i * slot + (slot - bw) / 2, y: h - bh, width: bw, height: bh,
        rx: 1, fill: o.color || token("--seq-500"),
      }));
    }
    return svg;
  }

  function colorBar(host, spec) {
    const w = spec.width || 190, h = spec.height || 9;
    const wrap = el("div", { class: "cbar" });
    if (spec.title) wrap.appendChild(el("span", { class: "cbar-title", text: spec.title }));
    const svg = svgEl("svg", { class: "cbar-svg", width: w, height: h + 15,
      viewBox: "0 0 " + w + " " + (h + 15) });
    const N = 48;
    for (let i = 0; i < N; i++) {
      svg.appendChild(svgEl("rect", {
        x: i / N * w, y: 0, width: w / N + 0.6, height: h,
        fill: spec.colorAt(i / (N - 1)),
      }));
    }
    for (const t of (spec.ticks || [])) {
      const x = Math.max(0, Math.min(w, t.at * w));
      const tx = svgEl("text", { class: "cbar-tick", x: x, y: h + 11,
        "text-anchor": t.at <= 0.02 ? "start" : t.at >= 0.98 ? "end" : "middle" });
      tx.textContent = t.label;
      svg.appendChild(tx);
    }
    wrap.appendChild(svg);
    host.appendChild(wrap);
    return wrap;
  }

  function ternary(host, spec, opts) {
    const o = opts || {};
    clear(host);
    const items = (spec.items || []).filter(function (d) {
      return (d.a + d.b + d.c) > 0 && d.value > 0;
    });
    const dropped = (spec.items || []).length - items.length;
    if (!items.length) {
      host.appendChild(el("div", { class: "empty", text: o.emptyText || "No data" }));
      return { drawn: 0, dropped: dropped };
    }

    const height = o.height || 340;
    const pad = { top: 18, right: 74, bottom: 34, left: 44 };
    const width = o.width || host.clientWidth || 520;
    const side = Math.max(80, Math.min(width - pad.left - pad.right,
                                       (height - pad.top - pad.bottom) / (Math.sqrt(3) / 2)));
    const triH = side * Math.sqrt(3) / 2;
    const svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height, height: height,
      preserveAspectRatio: "xMidYMid meet", role: "img",
    });
    const ox = pad.left + Math.max(0, (width - pad.left - pad.right - side) / 2);
    const oy = pad.top;
    const g = svgEl("g", { transform: "translate(" + ox + "," + oy + ")" });
    svg.appendChild(g);

    const A = [side / 2, 0], B = [0, triH], C = [side, triH];
    const at = function (pa, pb, pc) {
      return [pa * A[0] + pb * B[0] + pc * C[0],
              pa * A[1] + pb * B[1] + pc * C[1]];
    };

    for (let k = 1; k < 5; k++) {
      const f = k / 5;
      const lines = [
        [at(f, 1 - f, 0), at(f, 0, 1 - f)],
        [at(0, f, 1 - f), at(1 - f, f, 0)],
        [at(1 - f, 0, f), at(0, 1 - f, f)],
      ];
      for (const ln of lines) {
        g.appendChild(svgEl("line", {
          x1: ln[0][0], y1: ln[0][1], x2: ln[1][0], y2: ln[1][1],
          stroke: token("--grid"), "stroke-width": 1, opacity: 0.7,
        }));
      }
    }
    g.appendChild(svgEl("path", {
      d: "M" + A[0] + "," + A[1] + "L" + B[0] + "," + B[1]
         + "L" + C[0] + "," + C[1] + "Z",
      fill: "none", stroke: token("--border-strong"), "stroke-width": 1.2,
    }));

    const names = spec.corners || ["A", "B", "C"];
    const lab = function (xy, text, anchor, dy) {
      const t = svgEl("text", { class: "axis-title", x: xy[0], y: xy[1] + (dy || 0),
        "text-anchor": anchor });
      t.textContent = text;
      g.appendChild(t);
    };
    lab(A, names[0], "middle", -7);
    lab(B, names[1], "end", 15);
    lab(C, names[2], "start", 15);

    items.sort(function (x, y) { return x.value - y.value; });
    let maxV = 1;
    for (const d of items) if (d.value > maxV) maxV = d.value;
    const lg = Math.log(maxV + 1);
    for (const d of items) {
      const tot = d.a + d.b + d.c;
      const xy = at(d.a / tot, d.b / tot, d.c / tot);
      const t = lg > 0 ? Math.log(d.value + 1) / lg : 0;
      const node = svgEl("circle", {
        cx: xy[0], cy: xy[1], r: 1.6 + 4.4 * t,
        fill: (o.colorAt || IV.pal.sequential)(0.15 + 0.85 * t),
        opacity: 0.85, cursor: o.onPick ? "pointer" : "default",
      });
      if (d.hover) {
        bindHover(node, (function (h) { return function () { return h; }; })(d.hover));
      }
      if (o.onPick) {
        node.addEventListener("click", (function (dd) {
          return function () { o.onPick(dd); };
        })(d));
      }
      g.appendChild(node);
    }
    host.appendChild(svg);
    return { drawn: items.length, dropped: dropped };
  }

  IV.chart = {
    colorBar,
    frame, linear, ticks, fmtTick, xAxis, yAxis, barPath,
    histogram, barsH, stackBar, stackGroups, legend,
    scatter, heatmap, ranked, track, sparkBars, ternary,
    showTip, hideTip, moveTip, tipHTML, bindHover, GAP, R,
  };
})(window.IV);
