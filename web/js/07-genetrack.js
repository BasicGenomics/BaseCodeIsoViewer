(function (IV) {
  "use strict";

  const { el, svgEl, token } = IV.dom;

  const CHEV_STEP = 30;

  function openExternal(url) {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) w.opener = null;
  }

  const DOMAIN_DB = {
    Pfam: "pfam", SMART: "smart", PROSITE: "profile", PROSITE_profiles: "profile",
    Prosite_profiles: "profile", Gene3D: "cathgene3d", CDD: "cdd",
    PANTHER: "panther", SUPERFAMILY: "ssf", TIGRFAM: "tigrfam",
    PIRSF: "pirsf", Hamap: "hamap", PRINTS: "prints", SFLD: "sfld",
  };
  function domainUrl(f) {
    if (!f || !f.id) return null;
    const acc = String(f.id);
    if (/^IPR\d+$/i.test(acc)) {
      return "https://www.ebi.ac.uk/interpro/entry/InterPro/" + acc + "/";
    }
    const db = DOMAIN_DB[f.type];
    if (db) return "https://www.ebi.ac.uk/interpro/entry/" + db + "/" + acc + "/";
    return "https://www.ebi.ac.uk/interpro/search/text/" + encodeURIComponent(acc) + "/";
  }
  function ensemblUrl(id) {
    return id ? "https://www.ensembl.org/id/" + encodeURIComponent(id) : null;
  }

  function linkOut(node, url) {
    if (!url) return;
    node.style.cursor = "pointer";
    node.addEventListener("click", function (ev) {
      ev.stopPropagation();
      openExternal(url);
    });
  }

  const F = IV.fmt;

  const L = 196;
  const R = 124;
  const AXIS_H = 22;
  const ROW_H = 20;
  const LANE_H = 7;
  const GAP = 3;
  const GNOMAD_H = 34;
  const CLINVAR_H = 14;
  const REG_H = 13;
  const TRACK_MIN_W = 520;
  const TRACK_FALLBACK_W = 1180;

  const hasD3 = function () { return typeof d3 !== "undefined" && d3 && d3.zoom; };

  function fmtCoord(pos, span) {
    if (span < 2000) return F.int(Math.round(pos));
    if (span < 200000) return (pos / 1000).toFixed(1) + " kb";
    return (pos / 1e6).toFixed(2) + " Mb";
  }

  function cdsFill() { return IV.pal.brandRamp(0); }
  function utrFill() { return IV.pal.brandRamp(0.5); }

  function exonSegments(ex, cds, cdsKnown) {
    const s = ex[0], e = ex[1];
    if (!cds) return [{ s: s, e: e, coding: !cdsKnown }];
    const cs = cds[0], ce = cds[1];
    if (e < cs || s > ce) return [{ s: s, e: e, coding: false }];
    const out = [];
    if (s < cs) out.push({ s: s, e: cs - 1, coding: false });
    out.push({ s: Math.max(s, cs), e: Math.min(e, ce), coding: true });
    if (e > ce) out.push({ s: ce + 1, e: e, coding: false });
    return out;
  }

  function packLanes(features) {
    const items = [];
    const laneEnd = [];
    const flat = [];
    for (let fi = 0; fi < features.length; fi++) {
      for (const seg of (features[fi].segs || [])) {
        flat.push({ fi: fi, gs: seg[0], ge: seg[1] });
      }
    }
    flat.sort(function (a, b) { return a.gs - b.gs; });
    for (const it of flat) {
      let lane = 0;
      while (lane < laneEnd.length && laneEnd[lane] >= it.gs) lane++;
      laneEnd[lane] = it.ge;
      items.push({ fi: it.fi, gs: it.gs, ge: it.ge, lane: lane });
    }
    return { items: items, lanes: Math.max(1, laneEnd.length) };
  }

  function parsePosition(text, chr) {
    if (!text) return null;
    const t = String(text).trim().replace(/,/g, "");
    let m = /^(?:chr)?([\w.]+)\s*[:\s]\s*(\d+)$/i.exec(t);
    if (m) {
      const want = m[1].replace(/^chr/i, "").toLowerCase();
      const have = String(chr || "").replace(/^chr/i, "").toLowerCase();
      if (want !== have) {
        return { error: "That position is on " + m[1] + "; this gene is on " + chr + "." };
      }
      return { pos: +m[2] };
    }
    m = /^(\d+)$/.exec(t);
    if (m) return { pos: +m[1] };
    return { error: "Use chr:position, or a plain coordinate inside this gene." };
  }

  function draw(host, spec) {
    const rows = spec.rows || [];
    const st = spec.state || (spec.state = {});
    const ov = spec.overlays || {};
    const width = Math.max(TRACK_MIN_W,
      spec.width || host.clientWidth || TRACK_FALLBACK_W);
    const plotW = width - L - R;
    const g0 = spec.gStart, g1 = spec.gEnd;
    const span = (g1 - g0) || 1;

    const showDom = !!(ov.domains && Object.keys(ov.domains).length);
    const topTracks = [];
    if (ov.gnomad && ov.gnomad.length) topTracks.push({ k: "gnomad", h: GNOMAD_H });
    if (ov.clinvar && ov.clinvar.length) topTracks.push({ k: "clinvar", h: CLINVAR_H });
    if (ov.reg && ov.reg.length) topTracks.push({ k: "reg", h: REG_H });

    let y = AXIS_H;
    const topY = {};
    for (const t of topTracks) { topY[t.k] = y; y += t.h + GAP; }

    const laneOf = {};
    const rowY = [];
    for (const r of rows) {
      const packed = showDom && ov.domains[r.id]
        ? packLanes(ov.domains[r.id].features || [])
        : null;
      laneOf[r.id] = packed;
      rowY.push(y);
      y += ROW_H + (packed ? packed.lanes * LANE_H + 2 : 0) + GAP;
    }
    const height = y + 4;

    const svg = svgEl("svg", { class: "gt-svg", width: "100%", height: height,
      viewBox: "0 0 " + width + " " + height, preserveAspectRatio: "xMinYMin meet",
      role: "img", "aria-label": "Gene model" });

    const clipId = "gt-clip-" + Math.abs(hashStr(spec.chr + ":" + g0 + "-" + g1 + ":" + rows.length));
    const defs = svgEl("defs");
    const clip = svgEl("clipPath", { id: clipId });
    clip.appendChild(svgEl("rect", { x: 0, y: 0, width: plotW, height: height }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    const staticG = svgEl("g", {});
    svg.appendChild(staticG);

    const plotG = svgEl("g", { transform: "translate(" + L + ",0)",
      "clip-path": "url(#" + clipId + ")" });
    svg.appendChild(plotG);
    const zoomG = svgEl("g", {});
    plotG.appendChild(zoomG);

    const axisG = svgEl("g", { transform: "translate(" + L + ",0)" });
    svg.appendChild(axisG);

    const baseScale = hasD3()
      ? d3.scaleLinear().domain([g0, g1]).range([0, plotW])
      : linearScale(g0, g1, plotW);
    let scale = baseScale;
    const xFull = function (p) { return baseScale(p); };

    function paintAxis() {
      clearNode(axisG);
      const dom = scale.domain();
      const vis = dom[1] - dom[0];
      axisG.appendChild(svgEl("line", { x1: 0, x2: plotW, y1: AXIS_H - 5,
        y2: AXIS_H - 5, stroke: token("--border"), "stroke-width": 1 }));
      const ticks = hasD3() ? scale.ticks(7) : IV.chart.ticks(dom[0], dom[1], 7);
      for (const tv of ticks) {
        const x = scale(tv);
        if (x < -2 || x > plotW + 2) continue;
        axisG.appendChild(svgEl("line", { x1: x, x2: x, y1: AXIS_H - 9,
          y2: AXIS_H - 5, stroke: token("--border-strong"), "stroke-width": 1 }));
        const tk = svgEl("text", { class: "tick-text", x: x, y: AXIS_H - 12,
          "text-anchor": x < 22 ? "start" : x > plotW - 22 ? "end" : "middle" });
        tk.textContent = fmtCoord(tv, vis);
        axisG.appendChild(tk);
      }
      const lab = svgEl("text", { class: "tick-text", x: -8, y: AXIS_H - 12,
        "text-anchor": "end", fill: token("--ink-muted") });
      lab.textContent = spec.chr;
      axisG.appendChild(lab);
    }

    function paintPlot() {
      clearNode(zoomG);
      const sx = function (p) { return scale(p); };
      const dom = scale.domain();

      if (st.posMark != null) {
        const x = sx(st.posMark);
        if (x >= -1 && x <= plotW + 1) {
          zoomG.appendChild(svgEl("line", { x1: x, x2: x, y1: AXIS_H - 4,
            y2: height, stroke: token("--accent"), "stroke-width": 1,
            "stroke-dasharray": "3 2", opacity: 0.85 }));
        }
      }

      for (const t of topTracks) {
        if (t.k === "gnomad") paintGnomad(sx, topY.gnomad, dom);
        else if (t.k === "clinvar") paintClinvar(sx, topY.clinvar, dom);
        else paintRegulatory(sx, topY.reg, dom);
      }

      for (let ri = 0; ri < rows.length; ri++) {
        paintRow(rows[ri], rowY[ri], sx, dom);
      }
    }

    function paintRow(r, top, sx, dom) {
      const exons = r.exons || [];
      if (st.selVariant === r.id) {
        zoomG.appendChild(svgEl("rect", { x: -4, y: top - 2, width: plotW + 8,
          height: ROW_H + 4, rx: 3, fill: token("--accent"), opacity: 0.09,
          "pointer-events": "none" }));
      }
      const midY = top + ROW_H / 2;
      const utrH = 7, cdsH = 14;
      const dim = !r.kept;

      if (exons.length) {
        const a = Math.max(-4, sx(exons[0][0]));
        const b = Math.min(plotW + 4, sx(exons[exons.length - 1][1]));
        if (b > a) {
          zoomG.appendChild(svgEl("line", { x1: a, x2: b, y1: midY, y2: midY,
            stroke: dim ? token("--border-strong") : r.color,
            "stroke-width": 1.4, opacity: dim ? 0.7 : 0.85 }));
          if (r.strand !== 2 && b - a > 44) {
            const dir = r.strand === 1 ? -1 : 1;
            const first = Math.ceil((a + 16) / CHEV_STEP) * CHEV_STEP;
            for (let px = first; px < b - 8; px += CHEV_STEP) {
              let inExon = false;
              for (const ex of exons) {
                if (px >= sx(ex[0]) - 1 && px <= sx(ex[1]) + 1) { inExon = true; break; }
              }
              if (inExon) continue;
              zoomG.appendChild(svgEl("path", {
                d: "M" + (px - 2.6 * dir) + "," + (midY - 3)
                   + "L" + (px + 2.6 * dir) + "," + midY
                   + "L" + (px - 2.6 * dir) + "," + (midY + 3),
                fill: "none", stroke: token("--ink-faint"), "stroke-width": 1.1,
                "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.75,
              }));
            }
          }
        }
      }

      if (r.tipRow && exons.length) {
        const ba = Math.max(-4, sx(exons[0][0]));
        const bb = Math.min(plotW + 4, sx(exons[exons.length - 1][1]));
        if (bb > ba) {
          const bhit = svgEl("rect", { x: ba, y: midY - 5, width: bb - ba,
            height: 10, fill: "transparent",
            cursor: r.onClick ? "pointer" : "default" });
          IV.chart.bindHover(bhit, (function (rr) {
            return function () { return rr.tipRow(); };
          })(r));
          if (r.onClick) {
            bhit.addEventListener("click", (function (rr) {
              return function (evt) { evt.stopPropagation(); rr.onClick(); };
            })(r));
          }
          zoomG.appendChild(bhit);
        }
      }

      const rowSel = st.selVariant && st.selVariant === r.id;
      for (const ex of exons) {
        if (ex[1] < dom[0] || ex[0] > dom[1]) continue;
        const exKey = ex[0] + "-" + ex[1];
        const exSel = st.selExon === exKey;
        let fill = r.color;
        if (!dim && spec.colorBy === "usage" && spec.nDetected) {
          const used = (spec.usage || {})[exKey] || 0;
          fill = IV.pal.geneModelShade(0.18 + 0.82 * (used / spec.nDetected));
        }
        for (const seg of exonSegments(ex, r.cds, r.cdsKnown)) {
          const x0 = sx(seg.s), x1 = sx(seg.e);
          const bw = Math.max(1.2, x1 - x0);
          const eh = seg.coding ? cdsH : utrH;
          const segFill = dim ? token("--gm-300")
            : (spec.colorBy === "cds"
                ? (seg.coding ? cdsFill() : utrFill())
                : (seg.coding ? fill : token("--gm-200")));
          zoomG.appendChild(svgEl("rect", {
            x: x0, y: midY - eh / 2, width: bw, height: eh, rx: 1.4,
            fill: segFill,
            stroke: exSel ? token("--brand") : "none",
            "stroke-width": exSel ? 2 : 0,
            opacity: dim ? 0.55 : (seg.coding ? 1 : 0.85),
            "pointer-events": "none",
          }));
        }
        const hx0 = sx(ex[0]), hx1 = sx(ex[1]);
        const hit = svgEl("rect", { x: hx0, y: midY - cdsH / 2 - 1,
          width: Math.max(3, hx1 - hx0), height: cdsH + 2, fill: "transparent",
          cursor: r.onClick ? "pointer" : "default" });
        if (r.tipFor) {
          IV.chart.bindHover(hit, (function (e) {
            return function () { return r.tipFor(e); };
          })(ex));
        }
        hit.addEventListener("click", (function (rr, e, key) {
          return function (evt) {
            evt.stopPropagation();
            st.selExon = st.selExon === key ? null : key;
            st.selVariant = rr.id;
            if (spec.onSelect) spec.onSelect({ exon: e, exonKey: st.selExon, row: rr });
            paintStatic();
            paintPlot();
          };
        })(r, ex, exKey));
        zoomG.appendChild(hit);
      }

      const packed = laneOf[r.id];
      if (packed) {
        const feats = (ov.domains[r.id] || {}).features || [];
        const laneTop = top + ROW_H - 1;
        for (const it of packed.items) {
          if (it.ge < dom[0] || it.gs > dom[1]) continue;
          const f = feats[it.fi];
          if (!f) continue;
          const x0 = sx(it.gs), x1 = sx(it.ge);
          const rect = svgEl("rect", {
            x: x0, y: laneTop + it.lane * LANE_H, width: Math.max(1.2, x1 - x0),
            height: LANE_H - 1.5, rx: 1,
            fill: IV.pal.domainColor ? IV.pal.domainColor(f.type) : token("--cat-3"),
            opacity: 0.9, cursor: "pointer",
          });
          linkOut(rect, domainUrl(f));
          IV.chart.bindHover(rect, (function (ff) {
            return function () {
              return IV.chart.tipHTML(ff.description || ff.type, [
                ["Source", ff.type || "–"],
                ["Accession", ff.id || "–"],
                ["Protein range", ff.prot_start != null
                  ? ff.prot_start + "–" + ff.prot_end + " aa" : "–"],
                ["Translation", ff.ensp || "–"],
                domainUrl(ff) ? ["", "Click to open in InterPro"] : null,
              ].filter(Boolean));
            };
          })(f));
          zoomG.appendChild(rect);
        }
      }
    }

    function paintGnomad(sx, top, dom) {
      const vs = ov.gnomad;
      zoomG.appendChild(svgEl("line", { x1: 0, x2: plotW, y1: top + GNOMAD_H,
        y2: top + GNOMAD_H, stroke: token("--border"), "stroke-width": 1 }));
      const FLOOR = 1e-6, lf = Math.log10(FLOOR);
      for (const v of vs) {
        if (v.pos < dom[0] || v.pos > dom[1]) continue;
        const af = Math.max(FLOOR, v.af || FLOOR);
        const frac = Math.min(1, (Math.log10(af) - lf) / (0 - lf));
        const h = Math.max(2, frac * GNOMAD_H);
        const x = sx(v.pos);
        const tick = svgEl("rect", { x: x - 0.9, y: top + GNOMAD_H - h,
          width: 1.8, height: h, fill: IV.pal.csqColor ? IV.pal.csqColor(v.consequence)
            : token("--cat-8"), opacity: 0.9, cursor: "pointer" });
        IV.chart.bindHover(tick, (function (vv) {
          return function () {
            return IV.chart.tipHTML(vv.variant_id || "variant", [
              ["Position", F.int(vv.pos)],
              ["Change", (vv.ref || "?") + " → " + (vv.alt || "?")],
              ["Consequence", vv.consequence || "–"],
              ["Allele frequency", vv.af == null ? "–" : vv.af.toExponential(2)],
              ["Allele count", vv.ac == null ? "–" : F.int(vv.ac)],
              vv.variant_id ? ["", "Click to open in gnomAD"] : null,
            ].filter(Boolean));
          };
        })(v));
        linkOut(tick, v.variant_id
          ? "https://gnomad.broadinstitute.org/variant/"
            + encodeURIComponent(v.variant_id) + "?dataset=gnomad_r4"
          : null);
        zoomG.appendChild(tick);
      }
    }

    function paintClinvar(sx, top, dom) {
      for (const v of ov.clinvar) {
        if (v.pos < dom[0] || v.pos > dom[1]) continue;
        const x = sx(v.pos);
        const tick = svgEl("rect", { x: x - 1.1, y: top, width: 2.2,
          height: CLINVAR_H - 2, rx: 1,
          fill: IV.pal.clinsigColor ? IV.pal.clinsigColor(v.sig) : token("--st-critical"),
          opacity: 0.92, cursor: "pointer" });
        IV.chart.bindHover(tick, (function (vv) {
          return function () {
            return IV.chart.tipHTML(vv.title || "ClinVar variant", [
              ["Position", F.int(vv.pos)],
              ["Significance", vv.sig || "–"],
              ["Condition", vv.condition || "–"],
              ["", "Click to open in ClinVar"],
            ]);
          };
        })(v));
        linkOut(tick, v.clinvar_id
          ? "https://www.ncbi.nlm.nih.gov/clinvar/variation/"
            + encodeURIComponent(v.clinvar_id) + "/"
          : null);
        zoomG.appendChild(tick);
      }
    }

    function paintRegulatory(sx, top, dom) {
      for (const f of ov.reg) {
        if (f.end < dom[0] || f.start > dom[1]) continue;
        const x0 = sx(f.start), x1 = sx(f.end);
        const rect = svgEl("rect", { x: x0, y: top, width: Math.max(1.5, x1 - x0),
          height: REG_H - 2, rx: 1.5,
          fill: IV.pal.regColor ? IV.pal.regColor(f.feature_type) : token("--cat-7"),
          opacity: 0.8, cursor: "pointer" });
        linkOut(rect, ensemblUrl(f.id));
        IV.chart.bindHover(rect, (function (ff) {
          return function () {
            return IV.chart.tipHTML(ff.feature_type || "Regulatory feature", [
              ["Region", F.int(ff.start) + "–" + F.int(ff.end)],
              ["Length", F.bp(ff.end - ff.start + 1)],
              ["Ensembl id", ff.id || "–"],
              ff.id ? ["", "Click to open in Ensembl"] : null,
            ].filter(Boolean));
          };
        })(f));
        zoomG.appendChild(rect);
      }
    }

    function paintStatic() {
      clearNode(staticG);
      for (const t of topTracks) {
        const label = t.k === "gnomad" ? "gnomAD" : t.k === "clinvar" ? "ClinVar"
          : "Regulatory";
        const tx = svgEl("text", { class: "gt-track-label", x: L - 10,
          y: topY[t.k] + t.h - 3, "text-anchor": "end" });
        tx.textContent = label;
        staticG.appendChild(tx);
      }
      for (let ri = 0; ri < rows.length; ri++) {
        const r = rows[ri];
        const midY = rowY[ri] + ROW_H / 2 + 3.5;
        const nm = r.name.length > 26 ? r.name.slice(0, 24) + "…" : r.name;
        const tx = svgEl("text", { class: "gt-label" + (r.kept ? "" : " dim"),
          x: L - 10, y: midY, "text-anchor": "end", cursor: "pointer" });
        tx.textContent = nm;
        const ttl = svgEl("title");
        ttl.textContent = r.id;
        tx.appendChild(ttl);
        tx.addEventListener("click", (function (rr) {
          return function () {
            st.selVariant = st.selVariant === rr.id ? null : rr.id;
            st.selExon = null;
            if (rr.onClick) rr.onClick(null);
            if (spec.onSelect) spec.onSelect({ exon: null, exonKey: null, row: rr });
            paintStatic();
            paintPlot();
          };
        })(r));
        if (st.selVariant === r.id) tx.setAttribute("font-weight", "700");
        staticG.appendChild(tx);
        if (r.right) {
          const rt = svgEl("text", { class: "gt-num", x: L + plotW + 10, y: midY });
          rt.textContent = r.right;
          staticG.appendChild(rt);
        }
      }
    }

    let zoomBehaviour = null;
    if (hasD3()) {
      zoomBehaviour = d3.zoom()
        .scaleExtent([1, Math.max(2, span / 60)])
        .translateExtent([[0, 0], [plotW, height]])
        .extent([[0, 0], [plotW, height]])
        .filter(function (ev) {
          if (ev.type === "wheel") return ev.ctrlKey || ev.metaKey || ev.shiftKey;
          return !ev.button;
        })
        .on("zoom", function (ev) {
          st.transform = ev.transform;
          scale = ev.transform.rescaleX(baseScale);
          paintAxis();
          paintPlot();
        });
      const sel = d3.select(svg);
      sel.call(zoomBehaviour);
      if (st.transform) {
        scale = st.transform.rescaleX(baseScale);
        sel.call(zoomBehaviour.transform, st.transform);
      }
    }

    paintAxis();
    paintStatic();
    paintPlot();

    const dl = el("div", { style: { display: "flex", justifyContent: "flex-end",
      marginBottom: "2px" } });
    dl.appendChild(el("button", { class: "btn btn-sm",
      title: "Download the gene model as it is currently framed",
      text: "Download SVG",
      onclick: function () {
        const clone = svg.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        const bg = svgEl("rect", { x: 0, y: 0, width: width, height: height,
          fill: token("--surface") || "#fff" });
        clone.insertBefore(bg, clone.firstChild);
        const txt = new XMLSerializer().serializeToString(clone);
        IV.dom.download((spec.exportName || "gene-model") + ".svg", txt,
          "image/svg+xml;charset=utf-8");
      } }));
    host.appendChild(dl);
    host.appendChild(svg);

    function goTo(pos, flank) {
      st.posMark = pos;
      if (!hasD3()) { paintPlot(); return true; }
      const f = flank || 100;
      const k = Math.min(zoomBehaviour.scaleExtent()[1],
        Math.max(1, span / (2 * f)));
      const cx = baseScale(pos) * k;
      const tx = Math.min(0, Math.max(plotW - plotW * k, plotW / 2 - cx));
      const t = d3.zoomIdentity.translate(tx, 0).scale(k);
      st.transform = t;
      d3.select(svg).call(zoomBehaviour.transform, t);
      return true;
    }

    function reset() {
      st.posMark = null;
      if (!hasD3()) { paintPlot(); return; }
      st.transform = d3.zoomIdentity;
      d3.select(svg).call(zoomBehaviour.transform, d3.zoomIdentity);
    }

    function zoomBy(factor) {
      if (!hasD3()) return;
      d3.select(svg).call(zoomBehaviour.scaleBy, factor);
    }

    function selectExon(key) {
      st.selExon = (key && st.selExon !== key) ? key : null;
      paintStatic();
      paintPlot();
      return st.selExon;
    }

    return { svg: svg, goTo: goTo, reset: reset, zoomBy: zoomBy,
             selectExon: selectExon,
             selectedExon: function () { return st.selExon || null; },
             height: height, plotW: plotW, xFull: xFull, hasZoom: hasD3() };
  }

  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }

  function linearScale(a, b, w) {
    const f = function (p) { return (p - a) / ((b - a) || 1) * w; };
    f.domain = function () { return [a, b]; };
    f.ticks = function (n) { return IV.chart.ticks(a, b, n || 7); };
    return f;
  }

  IV.geneTrack = { cdsFill: cdsFill, utrFill: utrFill,
                   draw: draw, parsePosition: parsePosition,
                   exonSegments: exonSegments, packLanes: packLanes,
                   fmtCoord: fmtCoord };
})(window.IV);
