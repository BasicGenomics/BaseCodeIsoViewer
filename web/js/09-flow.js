(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;

  function stage(host, spec) {
    const segs = (spec.segments || []).filter(function (s) { return s && s.value > 0; });
    const total = spec.total != null
      ? spec.total
      : segs.reduce(function (a, s) { return a + s.value; }, 0);

    const row = el("div", { class: "fl-stage" });

    const head = el("div", { class: "fl-head" });
    head.appendChild(el("span", { class: "fl-title", text: spec.label }));
    if (spec.total != null) {
      head.appendChild(el("span", { class: "fl-total",
        text: F.compact(total, 2) + (spec.unit ? " " + spec.unit : "") }));
    }
    row.appendChild(head);

    const track = el("div", { class: "fl-track" });
    let drawn = 0;
    for (const s of segs) {
      const frac = total > 0 ? s.value / total : 0;
      drawn += s.value;
      const seg = el("div", { class: "fl-seg",
        style: { flex: String(Math.max(frac, 0)) + " 0 0",
                 background: s.color || IV.dom.token("--brand") } });
      if (frac >= 0.11) {
        seg.appendChild(el("span", { class: "fl-seg-label",
          text: F.pct(frac, frac < 0.02 ? 1 : 0) }));
      }
      IV.chart.bindHover(seg, (function (sg, fr) {
        return function () {
          let h = '<div class="t-title">' + F.escapeHtml(sg.label) + "</div>";
          if (sg.help) h += '<div class="t-note">' + F.escapeHtml(sg.help) + "</div>";
          h += '<div class="t-row"><span class="tk">Molecules</span>'
            + '<span class="tv">' + F.int(sg.value) + "</span></div>";
          h += '<div class="t-row"><span class="tk">Share of '
            + F.escapeHtml(spec.ofLabel || "total") + '</span><span class="tv">'
            + F.pct(fr, 2) + "</span></div>";
          return h;
        };
      })(s, frac));
      if (s.onClick) {
        seg.style.cursor = "pointer";
        seg.addEventListener("click", s.onClick);
      }
      track.appendChild(seg);
    }
    const rest = total - drawn;
    if (rest > 0.5) {
      const frac = total > 0 ? rest / total : 0;
      const seg = el("div", { class: "fl-seg fl-seg-rest",
        style: { flex: String(frac) + " 0 0" } });
      IV.chart.bindHover(seg, function () {
        return '<div class="t-title">Unaccounted</div>'
          + '<div class="t-note">These molecules are in the total but in none of '
          + 'the named branches. If you can see this, the diagram is missing a '
          + 'branch - it is drawn rather than absorbed so it cannot hide.</div>'
          + '<div class="t-row"><span class="tk">Molecules</span><span class="tv">'
          + F.int(rest) + "</span></div>";
      });
      track.appendChild(seg);
    }
    row.appendChild(track);

    const leg = el("div", { class: "fl-legend" });
    for (const s of segs) {
      const item = el("span", { class: "fl-leg-item" });
      item.appendChild(el("span", { class: "fl-swatch",
        style: { background: s.color || IV.dom.token("--brand") } }));
      item.appendChild(el("span", { text: s.label }));
      item.appendChild(el("span", { class: "fl-leg-num",
        text: F.compact(s.value, 2) }));
      leg.appendChild(item);
    }
    row.appendChild(leg);
    host.appendChild(row);
    return row;
  }

  function unitBreak(host, spec) {
    const b = el("div", { class: "fl-break" });
    b.appendChild(el("span", { class: "fl-break-rule" }));
    const body = el("div", { class: "fl-break-body" });
    body.appendChild(el("div", { class: "fl-break-title", text: spec.label }));
    if (spec.note) {
      body.appendChild(el("div", { class: "fl-break-note", html: spec.note }));
    }
    b.appendChild(body);
    host.appendChild(b);
    return b;
  }

  function lane(host, label, unit) {
    const h = el("div", { class: "fl-lane" });
    h.appendChild(el("span", { class: "fl-lane-label", text: label }));
    h.appendChild(el("span", { class: "fl-lane-unit", text: "counted in " + unit }));
    host.appendChild(h);
    return h;
  }

  function crosscut(host, spec) {
    const row = el("div", { class: "fl-cross" });
    row.appendChild(el("div", { class: "fl-cross-label", text: spec.label }));
    const track = el("div", { class: "fl-track fl-track-thin" });
    const frac = spec.total > 0 ? spec.value / spec.total : 0;
    track.appendChild(el("div", { class: "fl-seg",
      style: { flex: String(frac) + " 0 0",
               background: spec.color || IV.dom.token("--brand") } }));
    track.appendChild(el("div", { class: "fl-seg fl-seg-rest",
      style: { flex: String(Math.max(0, 1 - frac)) + " 0 0" } }));
    IV.chart.bindHover(track, function () {
      return '<div class="t-title">' + F.escapeHtml(spec.label) + "</div>"
        + (spec.help ? '<div class="t-note">' + F.escapeHtml(spec.help) + "</div>" : "")
        + '<div class="t-row"><span class="tk">Molecules</span><span class="tv">'
        + F.int(spec.value) + "</span></div>"
        + '<div class="t-row"><span class="tk">Share</span><span class="tv">'
        + F.pct(frac, 1) + "</span></div>";
    });
    row.appendChild(track);
    row.appendChild(el("div", { class: "fl-cross-num",
      html: F.compact(spec.value, 2)
        + ' <span class="faint xsmall">' + F.pct(frac, 1) + "</span>" }));
    host.appendChild(row);
    return row;
  }

  function deriveLost(total, noGene, ambiguous, counted) {
    if (total == null || noGene == null || ambiguous == null || counted == null) return null;
    const v = total - noGene - ambiguous - counted;
    return v > 0 ? v : 0;
  }

  function moleculesWithGene(a, uni) {
    let n = 0;
    a.assign_values.forEach(function (t, i) {
      if ((a.outcome_of[t] || "no_gene") !== "no_gene") n += uni.assign_mol[i];
    });
    return n;
  }

  function residual(universe, level, key) {
    const r = universe && universe[level + "_residual"];
    const e = r && r[key];
    return e && e.count != null ? e.count : null;
  }

  IV.flow = {
    stage, unitBreak, lane, crosscut,
    deriveLost, moleculesWithGene, residual,
  };
})(window.IV);
