(function (IV) {
  "use strict";

  const { el, clear, byId } = IV.dom;
  const F = IV.fmt;

  function tiles(host, items, opts) {
    const o = opts || {};
    clear(host);
    host.className = "tiles" + (o.row ? " tiles-row" : "");
    for (const t of items) {
      if (!t) continue;
      const card = el("div", { class: "tile" + (t.tone ? " " + t.tone : "")
        + (t.mark ? " tile-marked" : "") });
      const lab = el("div", { class: "tile-label" }, t.label);
      if (t.help) {
        const info = el("span", { class: "faint", text: "ⓘ", style: { cursor: "help" } });
        IV.chart.bindHover(info, function () {
          return '<div class="t-title">' + F.escapeHtml(t.label) + '</div>'
            + '<div class="t-note">' + F.escapeHtml(t.help) + '</div>';
        });
        lab.appendChild(info);
      }
      card.appendChild(lab);
      card.appendChild(el("div", { class: "tile-value",
        html: (typeof t.value === "string" ? t.value : F.int(t.value))
          + (t.unit ? '<span class="unit">' + F.escapeHtml(t.unit) + "</span>" : "") }));
      if (t.sub) card.appendChild(el("div", { class: "tile-sub", html: t.sub }));
      if (t.meter && t.meter.length) {
        const total = t.meter.reduce(function (a, b) { return a + (b.value || 0); }, 0) || 1;
        const m = el("div", { class: "meter" });
        for (const s of t.meter) {
          if (!(s.value > 0)) continue;
          const seg = el("span", { style: { flex: (s.value / total) + " 1 0",
            background: s.color } });
          IV.chart.bindHover(seg, function () {
            return IV.chart.tipHTML(s.label, [["Value", F.int(s.value)],
              ["Share", F.pctOf(s.value, total)]], s.color);
          });
          m.appendChild(seg);
        }
        card.appendChild(m);
      }
      host.appendChild(card);
    }
  }

  function Table(host, opts) {
    this.host = host;
    this.cols = opts.cols;
    this.rows = opts.rows || new Int32Array(0);
    this.page = 0;
    this.pageSize = opts.pageSize || 50;
    this.sortKey = opts.sortKey || null;
    this.sortDir = opts.sortDir || -1;
    this.onRow = opts.onRow || null;
    this.rowId = opts.rowId || null;
    this.hidden = opts.hidden instanceof Set ? opts.hidden
      : new Set((this.cols || []).filter(function (c) { return c.optional; })
          .map(function (c) { return c.label; }));
    this.emptyText = opts.emptyText || "Nothing matches the current filters";
    this.name = opts.name || "table";
    this.total = opts.total;
    this._order = null;
  }

  Table.prototype.setRows = function (rows, opts) {
    this.rows = rows;
    this.page = 0;
    this._order = null;
    if (opts && opts.total != null) this.total = opts.total;
    this.render();
  };

  Table.prototype.colByKey = function (k) {
    for (const c of this.cols) if (c.key === k) return c;
    return null;
  };

  Table.prototype.sortedRows = function () {
    if (this._order) return this._order;
    const col = this.sortKey ? this.colByKey(this.sortKey) : null;
    if (!col) { this._order = this.rows; return this._order; }
    const get = col.sort || col.value;
    if (!get) { this._order = this.rows; return this._order; }
    const arr = Array.prototype.slice.call(this.rows);
    const dir = this.sortDir;
    arr.sort(function (a, b) {
      const va = get(a), vb = get(b);
      if (typeof va === "string" || typeof vb === "string") {
        return dir * String(va == null ? "" : va).localeCompare(String(vb == null ? "" : vb));
      }
      const na = va == null || !isFinite(va) ? -Infinity : va;
      const nb = vb == null || !isFinite(vb) ? -Infinity : vb;
      return dir * (na - nb);
    });
    this._order = arr;
    return arr;
  };

  Table.prototype.sortBy = function (key) {
    if (this.sortKey === key) this.sortDir = -this.sortDir;
    else { this.sortKey = key; this.sortDir = -1; }
    this._order = null;
    this.page = 0;
    this.render();
  };

  Table.prototype.render = function () {
    const self = this;
    clear(this.host);
    const n = this.rows.length;
    if (!n) {
      this.host.appendChild(el("div", { class: "empty", text: this.emptyText }));
      return;
    }
    const order = this.sortedRows();
    const pages = Math.max(1, Math.ceil(n / this.pageSize));
    if (this.page >= pages) this.page = pages - 1;
    const start = this.page * this.pageSize;
    const end = Math.min(n, start + this.pageSize);

    const wrap = el("div", { class: "tbl-wrap" });
    const tbl = el("table", { class: "dt" });
    const thead = el("thead");
    const hr = el("tr");
    for (const c of this.cols) {
      if (this.hidden.has(c.label)) continue;
      const th = el("th", {
        class: c.noSort ? "no-sort" : null,
        style: c.width ? { width: c.width } : null,
      });
      th.appendChild(document.createTextNode(c.label));
      if (c.help) {
        IV.chart.bindHover(th, (function (col) {
          return function () {
            return '<div class="t-title">' + F.escapeHtml(col.label) + '</div>'
              + '<div class="t-note">' + F.escapeHtml(col.help) + '</div>';
          };
        })(c));
      }
      if (this.sortKey === c.key) {
        th.appendChild(el("span", { class: "arrow", text: this.sortDir < 0 ? "▼" : "▲" }));
      }
      if (c.align === "right") th.style.textAlign = "right";
      if (!c.noSort) {
        th.addEventListener("click", function (key) {
          return function () { self.sortBy(key); };
        }(c.key));
      }
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    tbl.appendChild(thead);

    const tb = el("tbody");
    for (let r = start; r < end; r++) {
      const i = order[r];
      const tr = el("tr");
      if (this.rowId) tr.setAttribute("data-row-id", this.rowId(i));
      for (const c of this.cols) {
        if (this.hidden.has(c.label)) continue;
        const td = el("td", { class: c.align === "right" ? "n" : (c.cls || null) });
        const v = c.render ? c.render(i) : (c.value ? c.value(i) : "");
        if (v instanceof Node) td.appendChild(v);
        else if (c.html) td.innerHTML = v == null ? "" : v;
        else td.textContent = v == null ? "" : (typeof v === "number" ? F.int(v) : v);
        tr.appendChild(td);
      }
      if (this.onRow) {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", function (row) {
          return function (e) {
            if (e.target.closest(".no-row-click")) return;
            self.onRow(row);
          };
        }(i));
      }
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    this.host.appendChild(wrap);

    const pager = el("div", { class: "pager" });
    pager.appendChild(el("span", {
      html: "<strong>" + F.int(n) + "</strong> rows"
        + (this.total != null && this.total !== n
          ? ' <span class="faint">of ' + F.int(this.total) + "</span>" : "")
        + ' <span class="faint">· showing ' + F.int(start + 1) + "–" + F.int(end) + "</span>",
    }));
    pager.appendChild(el("span", { class: "grow" }));
    if (pages > 1) {
      pager.appendChild(el("button", {
        class: "btn btn-sm", text: "‹ Prev", disabled: this.page === 0,
        onclick: function () { self.page--; self.render(); },
      }));
      pager.appendChild(el("span", { class: "xsmall faint",
        text: "page " + (this.page + 1) + " / " + pages }));
      pager.appendChild(el("button", {
        class: "btn btn-sm", text: "Next ›", disabled: this.page >= pages - 1,
        onclick: function () { self.page++; self.render(); },
      }));
    }
    const sizeSel = el("select", { class: "btn btn-sm", "aria-label": "Rows per page" });
    for (const s of [50, 100, 250, 1000]) {
      sizeSel.appendChild(el("option", { value: s, selected: s === this.pageSize, text: s }));
    }
    sizeSel.addEventListener("change", function () {
      self.pageSize = parseInt(sizeSel.value, 10);
      self.page = 0;
      self.render();
    });
    pager.appendChild(sizeSel);
    this.host.appendChild(pager);
  };

  Table.prototype.exportCSV = function (filename) {
    const cols = this.cols.filter(function (c) { return c.value; });
    const header = cols.map(function (c) { return c.label; });
    const rows = [];
    const order = this.sortedRows();
    for (let r = 0; r < order.length; r++) {
      const i = order[r];
      rows.push(cols.map(function (c) { return c.value(i); }));
    }
    IV.dom.download(filename || (this.name + ".csv"), IV.dom.toCSV(header, rows));
  };

  function csvButton(onclick, label) {
    const b = el("button", { class: "btn btn-sm" });
    b.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" '
      + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '
      + 'stroke-linejoin="round" aria-hidden="true" '
      + 'style="vertical-align:-1px;margin-right:.35em">'
      + '<path d="M8 2v8"/><path d="M4.5 7 8 10.5 11.5 7"/>'
      + '<path d="M2.5 13.5h11"/></svg>'
      + (label || "CSV");
    b.addEventListener("click", onclick);
    return b;
  }

  function termsPanel(host, opts) {
    const o = opts || {};
    const d = el("details", { class: "terms" });
    if (o.open) d.setAttribute("open", "open");
    const sum = el("summary");
    sum.appendChild(el("span", { class: "terms-q", text: "?" }));
    sum.appendChild(document.createTextNode(
      o.title || "Detected and counted molecules are different populations"));
    d.appendChild(sum);
    const body = el("div", { class: "terms-body" });
    for (const t of (o.terms || IV.stateApi.TERMS)) {
      const row = el("div", { class: "terms-row" });
      row.appendChild(el("div", { class: "terms-term", text: t.term }));
      row.appendChild(el("div", { class: "terms-def", text: t.body }));
      body.appendChild(row);
    }
    d.appendChild(body);
    host.appendChild(d);
    return d;
  }

  function numbersPanel(host, opts) {
    const o = opts || {};
    const d = el("details", { class: "terms terms-numbers" });
    if (o.open) d.setAttribute("open", "open");
    const sum = el("summary");
    sum.appendChild(el("span", { class: "terms-q", text: "#" }));
    sum.appendChild(document.createTextNode(o.title || "Show the numbers"));
    d.appendChild(sum);
    const body = el("div", { class: "terms-body" });
    if (o.content) body.appendChild(o.content);
    d.appendChild(body);
    host.appendChild(d);
    return body;
  }

  const FILTER_FIELDS = [
    { grp: "support", label: "Detected molecules", min: "molMin", max: "molMax",
      help: "Distinct reconstructed molecules assigned to the feature. Exact " +
            "count from the per-molecule layer, independent of quantification." },
    { grp: "support", label: "Sequencing reads", min: "readMin", max: "readMax",
      help: "Raw sequencing reads behind those molecules: 3′, 5′, and internal reads combined." },
    { grp: "support", label: "Full-length molecules", min: "flMin",
      help: "Molecules with at least one 3′ and one 5′ read observed." },
    { grp: "support", label: "Full-length fraction", min: "flFracMin", step: 0.05,
      max0to1: true,
      help: "Full-length molecules divided by all supporting molecules." },
    { grp: "expr", label: "Mean TPM", min: "tpmMin", max: "tpmMax", step: 0.1 },
    { grp: "expr", label: "Quantified count", min: "countMin", max: "countMax",
      help: "IsoQuant's count. Transcript counts are unique_only in this run, so " +
            "they are a lower bound and can be 0 while molecules are not." },
    { grp: "expr", label: "Samples detected in", min: "samplesMin", step: 1 },
    { grp: "usage", label: "Transcript variants", min: "varMin", max: "varMax", step: 1,
      genesOnly: true },
    { grp: "usage", label: "Novel transcript models", min: "novelMin", step: 1,
      genesOnly: true, discOnly: true },
    { grp: "usage", label: "Normalised entropy", min: "entMin", max: "entMax",
      step: 0.05, genesOnly: true, max0to1: true,
      help: "0 = one dominant transcript variant, 1 = perfectly even usage." },
    { grp: "usage", label: "Mean pairwise JSD", min: "jsdMin", max: "jsdMax",
      step: 0.05, genesOnly: true, max0to1: true,
      help: "Divergence of transcript-variant usage between samples. Needs ≥2 "
            + "samples." },
  ];

  const GRP_LABEL = { support: "Read & molecule support", expr: "Expression",
                      usage: "Transcript variant usage" };

  Table.prototype.columnPicker = function () {
    const self = this;
    const wrap = el("details", { class: "col-picker" });
    wrap.appendChild(el("summary", { class: "btn btn-sm",
      text: "Columns", title: "Show or hide columns" }));
    const body = el("div", { class: "col-picker-body" });
    for (const c of this.cols) {
      const cb = el("input", { type: "checkbox", checked: !this.hidden.has(c.label) });
      cb.addEventListener("change", function (label) {
        return function () {
          if (cb.checked) self.hidden.delete(label);
          else self.hidden.add(label);
          self.render();
        };
      }(c.label));
      body.appendChild(el("label", { class: "small", title: c.help || null },
        [cb, c.label]));
    }
    wrap.appendChild(body);
    return wrap;
  };

  function FilterPanel(host, opts) {
    this.host = host;
    this.level = opts.level || "gene";
    this.onApply = opts.onApply;
    this.filter = IV.stateApi.newFilter();
    this.inputs = {};
    this.biotypeOptions = opts.biotypeOptions || [];
    this.classOptions = opts.classOptions || [];
    this.render();
  }

  FilterPanel.prototype.render = function () {
    const self = this;
    clear(this.host);
    const nSamples = IV.state.samples.length;
    const isDisc = IV.state.mode === "disc";

    const groups = {};
    for (const f of FILTER_FIELDS) {
      if (f.genesOnly && this.level !== "gene") continue;
      if (f.discOnly && !isDisc) continue;
      const nSel = IV.stateApi.nActive();
      if (f.min === "jsdMin" && nSel < 2) continue;
      if (f.min === "samplesMin" && nSel < 2) continue;
      (groups[f.grp] = groups[f.grp] || []).push(f);
    }

    const wrap = el("div");

    if (nSamples > 1 && IV.sampleSelect) {
      IV.sampleSelect.chips(wrap, function () { self.render(); });
    }

    for (const gk of ["support", "expr", "usage"]) {
      const fields = groups[gk];
      if (!fields || !fields.length) continue;
      wrap.appendChild(el("div", { class: "xsmall strong",
        style: { color: "var(--ink-faint)", textTransform: "uppercase",
                 letterSpacing: ".05em", margin: "10px 0 4px" },
        text: GRP_LABEL[gk] }));
      const grid = el("div", { class: "filter-grid" });
      for (const f of fields) grid.appendChild(this.rowFor(f));
      wrap.appendChild(grid);
    }

    const cats = el("div", { class: "filter-grid", style: { marginTop: "10px" } });
    const bioUni = IV.state.loaded && IV.state.loaded[IV.state.mode];
    const bioFrame = bioUni && (this.level === "gene" ? bioUni.genes : bioUni.tx);
    if (this.biotypeOptions.length > 1
        && (!bioFrame || IV.stateApi.hasBiotypes(bioFrame))) {
      cats.appendChild(this.multiSelect("biotypes", "Biotype", this.biotypeOptions));
    }
    if (isDisc && this.classOptions.length > 1) {
      cats.appendChild(this.multiSelect("classes", "Novelty class", this.classOptions,
        IV.pal.NOVEL_SHORT));
    }
    const nameRow = el("div", { class: "frow wide" }, [
      el("span", { class: "fl", text: this.level === "gene"
        ? "Gene names or IDs"
        : F.pretty(IV.stateApi.modeInfo().featureWord) + " names or IDs" }),
      el("div", { class: "fi" }, [
        el("input", { type: "text", id: "f-names-" + this.level, style: { flex: "1" },
          placeholder: (function () {
            const uni = IV.state.loaded && IV.state.loaded[IV.state.mode];
            const fr = uni && (self.level === "gene" ? uni.genes : uni.tx);
            return fr ? IV.stateApi.searchPlaceholder(fr)
                      : "comma, space or newline separated";
          })() }),
      ]),
    ]);
    cats.appendChild(nameRow);
    this.inputs.names = nameRow.querySelector("input");
    wrap.appendChild(cats);

    const toggles = el("div", { style: { display: "flex", gap: "16px",
      flexWrap: "wrap", marginTop: "10px", alignItems: "center" } });
    this.inputs.detectedOnly = el("input", { type: "checkbox" });
    toggles.appendChild(el("label", { class: "small",
      style: { display: "flex", gap: "6px", alignItems: "center", cursor: "pointer" } }, [
      this.inputs.detectedOnly, "Quantified only (count > 0)",
    ]));
    if (isDisc) {
      this.inputs.novelOnly = el("input", { type: "checkbox" });
      toggles.appendChild(el("label", { class: "small",
        style: { display: "flex", gap: "6px", alignItems: "center", cursor: "pointer" } }, [
        this.inputs.novelOnly, "Novel only",
      ]));
    }
    toggles.appendChild(el("span", { class: "grow", style: { flex: "1" } }));
    toggles.appendChild(el("button", { class: "btn btn-primary", text: "Apply filters",
      onclick: function () { self.apply(); } }));
    toggles.appendChild(el("button", { class: "btn", text: "Reset",
      onclick: function () { self.reset(); } }));
    wrap.appendChild(toggles);

    this.host.appendChild(wrap);

    this.host.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); self.apply(); }
    });
  };

  FilterPanel.prototype.rowFor = function (f) {
    const row = el("div", { class: "frow" });
    const lab = el("span", { class: "fl", text: f.label });
    if (f.help) { lab.title = f.help; lab.style.cursor = "help"; }
    row.appendChild(lab);
    const fi = el("div", { class: "fi" });
    const mkInput = function (key, ph) {
      const inp = el("input", { type: "number", placeholder: ph,
        step: f.step != null ? f.step : 1, min: 0 });
      if (f.max0to1) inp.max = 1;
      return inp;
    };
    const lo = mkInput(f.min, "min");
    this.inputs[f.min] = lo;
    fi.appendChild(lo);
    if (f.max) {
      fi.appendChild(el("span", { class: "sep", text: "–" }));
      const hi = mkInput(f.max, "max");
      this.inputs[f.max] = hi;
      fi.appendChild(hi);
    }
    row.appendChild(fi);
    return row;
  };

  FilterPanel.prototype.multiSelect = function (key, label, options, labelMap) {
    const self = this;
    const row = el("div", { class: "frow" });
    row.appendChild(el("span", { class: "fl", text: label }));
    const btn = el("button", { class: "btn", style: { textAlign: "left", width: "100%" },
      text: "All" });
    const menu = el("div", {
      style: {
        display: "none", position: "absolute", zIndex: "60", marginTop: "3px",
        background: "var(--surface)", border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-sm)", boxShadow: "var(--shadow-lg)",
        maxHeight: "300px", overflowY: "auto", padding: "6px", minWidth: "220px",
      },
    });
    const boxes = [];
    const head = el("div", { style: { display: "flex", gap: "6px", padding: "2px 4px 6px" } }, [
      el("button", { class: "btn btn-sm", text: "All", onclick: function () {
        boxes.forEach(function (b) { b.checked = true; }); update();
      } }),
      el("button", { class: "btn btn-sm", text: "None", onclick: function () {
        boxes.forEach(function (b) { b.checked = false; }); update();
      } }),
    ]);
    menu.appendChild(head);
    for (const o of options) {
      const cb = el("input", { type: "checkbox", checked: true, value: o.value });
      boxes.push(cb);
      cb.addEventListener("change", update);
      const line = el("label", { class: "small",
        style: { display: "flex", gap: "6px", alignItems: "center", padding: "2px 4px",
                 cursor: "pointer" } }, [
        cb,
        el("span", { text: (labelMap && labelMap[o.value]) || o.label || o.value }),
        el("span", { class: "faint xsmall", style: { marginLeft: "auto" },
          text: o.count != null ? F.int(o.count) : "" }),
      ]);
      menu.appendChild(line);
    }
    function update() {
      const on = boxes.filter(function (b) { return b.checked; });
      btn.textContent = on.length === boxes.length ? "All"
        : on.length === 0 ? "None" : on.length + " selected";
      self.filter[key] = on.length === boxes.length ? null
        : new Set(on.map(function (b) { return b.value; }));
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", function (e) {
      if (!menu.contains(e.target) && e.target !== btn) menu.style.display = "none";
    });
    const holder = el("div", { class: "fi", style: { position: "relative", display: "block" } });
    holder.appendChild(btn);
    holder.appendChild(menu);
    row.appendChild(holder);
    this.inputs["_ms_" + key] = { boxes: boxes, update: update };
    return row;
  };

  FilterPanel.prototype.readValue = function (key) {
    const inp = this.inputs[key];
    if (!inp || inp.value === "") return null;
    const v = parseFloat(inp.value);
    return isFinite(v) ? v : null;
  };

  FilterPanel.prototype.apply = function () {
    const f = this.filter;
    for (const fld of FILTER_FIELDS) {
      if (this.inputs[fld.min] !== undefined) f[fld.min] = this.readValue(fld.min);
      if (fld.max && this.inputs[fld.max] !== undefined) f[fld.max] = this.readValue(fld.max);
    }
    f.names = IV.stateApi.parseNames(this.inputs.names ? this.inputs.names.value : "");
    f.detectedOnly = !!(this.inputs.detectedOnly && this.inputs.detectedOnly.checked);
    f.novelOnly = !!(this.inputs.novelOnly && this.inputs.novelOnly.checked);
    if (this.onApply) this.onApply(f);
  };

  FilterPanel.prototype.reset = function () {
    for (const k in this.inputs) {
      const inp = this.inputs[k];
      if (!inp) continue;
      if (inp.boxes) { inp.boxes.forEach(function (b) { b.checked = true; }); inp.update(); }
      else if (inp.type === "checkbox") inp.checked = false;
      else if ("value" in inp) inp.value = "";
    }
    this.filter = IV.stateApi.newFilter();
    if (this.onApply) this.onApply(this.filter);
  };

  function seg(options, current, onChange, opts) {
    const o = opts || {};
    const box = el("div", { class: "seg" + (o.accent ? " seg-accent" : ""),
      role: "group", "aria-label": o.label || "" });
    for (const op of options) {
      const rich = !!op.help;
      const b = el("button", {
        type: "button", text: op.label,
        title: op.help && !rich ? op.help : null,
        "aria-pressed": String(op.value === current),
        "aria-label": op.help ? op.label + ". " + op.help.replace(/\n+/g, " ") : null,
      });
      if (rich) {
        IV.chart.bindHover(b, function () {
          const paras = op.help.split(/\n{2,}/);
          let h = '<div class="t-title">' + F.escapeHtml(op.label) + "</div>";
          for (const p of paras) {
            h += '<div style="margin-top:4px;white-space:normal">'
              + F.escapeHtml(p) + "</div>";
          }
          return h;
        });
      }
      b.addEventListener("click", function () {
        for (const other of box.querySelectorAll("button")) {
          other.setAttribute("aria-pressed", String(other === b));
        }
        onChange(op.value);
      });
      box.appendChild(b);
    }
    return box;
  }

  function control(label, node, hint) {
    const c = el("div", { class: "control", "data-control": label });
    c.appendChild(el("span", { class: "control-label", text: label }));
    c.appendChild(node);
    if (hint) c.appendChild(el("span", { class: "control-hint", text: hint }));
    return c;
  }

  function sectionHeader(title, note) {
    const wrap = el("div", { class: "section-header" });
    wrap.appendChild(el("h3", { text: title }));
    if (note) wrap.appendChild(el("p", { class: "note small", html: note }));
    return wrap;
  }

  function partHeader(tool, title, note) {
    const wrap = el("div", { class: "part-header" });
    const h = el("h2");
    h.appendChild(el("span", { class: "part-tool", text: tool }));
    if (title) h.appendChild(document.createTextNode(" · " + title));
    wrap.appendChild(h);
    if (note) wrap.appendChild(el("p", { class: "note small", html: note }));
    return wrap;
  }

  function simpleTable(header, rows, alignRight) {
    const wrap = el("div", { class: "tbl-wrap" });
    const t = el("table", { class: "dt compact" });
    const hr = el("tr");
    header.forEach(function (h, i) {
      hr.appendChild(el("th", { class: "no-sort", text: h,
        style: (alignRight ? alignRight[i] : i > 0) ? { textAlign: "right" } : null }));
    });
    t.appendChild(el("thead", {}, hr));
    const tb = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      r.forEach(function (v, i) {
        tr.appendChild(el("td", {
          class: (alignRight ? alignRight[i] : i > 0) ? "n" : null,
          text: v == null ? "–" : String(v),
        }));
      });
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    return wrap;
  }

  function card(title, opts) {
    const o = opts || {};
    const c = el("div", { class: "card" + (o.class ? " " + o.class : "") });
    if (o.tour) c.setAttribute("data-tour", o.tour);
    if (title) {
      const h = el("h2", {}, title);
      if (o.badge) h.appendChild(el("span", { class: "card-badge", text: o.badge }));
      if (o.tools) h.appendChild(el("span", { class: "h2-tools" }, o.tools));
      c.appendChild(h);
    }
    if (o.note != null) {
      c.noteEl = el("p", { class: "note", html: o.note });
      c.appendChild(c.noteEl);
    }
    return c;
  }

  function setNote(c, html) {
    if (c && c.noteEl) c.noteEl.innerHTML = html;
  }

  function tileGroups(host, groups, opts) {
    const o = opts || {};
    clear(host);
    for (const grp of groups || []) {
      const items = (grp.items || []).filter(Boolean);
      if (!items.length) continue;
      const box = el("div", { class: "tile-group" });
      if (grp.label) {
        box.appendChild(el("div", { class: "tile-group-label", text: grp.label }));
      }
      const grid = el("div");
      tiles(grid, items, o);
      box.appendChild(grid);
      host.appendChild(box);
    }
    return host;
  }

  function callout(html, tone) {
    return el("div", { class: "callout" + (tone ? " " + tone : "") }, [
      el("span", { class: "c-icon", text: tone === "warn" ? "⚠"
        : tone === "crit" ? "✕" : tone === "good" ? "✓" : "ⓘ" }),
      el("div", { html: html }),
    ]);
  }

  function tableBehind(header, rows, label, o) {
    const d = el("details", { class: "terms terms-numbers" });
    const sum = el("summary");
    sum.appendChild(el("span", { class: "terms-q", text: "#" }));
    sum.appendChild(document.createTextNode(label || "Show the numbers"));
    d.appendChild(sum);
    const body = el("div", { class: "terms-body" });
    const wrap = el("div", { class: "tbl-wrap" });
    const t = el("table", { class: "dt compact" });
    const th = el("thead");
    const hr = el("tr");
    header.forEach(function (h, i) {
      hr.appendChild(el("th", { class: "no-sort", text: h,
        style: i ? { textAlign: "right" } : null }));
    });
    th.appendChild(hr);
    t.appendChild(th);
    const tb = el("tbody");
    rows.forEach(function (r, ri) {
      const tr = el("tr");
      if (o && o.rowKey) tr.setAttribute(o.rowKey.attr, o.rowKey.of(r, ri));
      r.forEach(function (v, i) {
        tr.appendChild(el("td", { class: i ? "n" : null,
          html: v instanceof Node ? "" : String(v == null ? "" : v) },
          v instanceof Node ? v : null));
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    body.appendChild(wrap);
    d.appendChild(body);
    return d;
  }

  function universeSeg() {
    const a = ((IV.state.core || {}).assignment) || {};
    const flHelp = (a.fl_definitions && a.fl_definitions.fl)
      || "At least one 3′ and one 5′ read observed";
    return control("Molecules", seg([
      { label: "All", value: "all", help: "Every reconstructed molecule." },
      { label: "Full-length", value: "fl", help: flHelp + "." },
    ], IV.state.universe, function (v) { IV.stateApi.setUniverse(v); },
      { label: "Molecules" }));
  }

  IV.ui = { tiles, tileGroups, Table, FilterPanel, seg, control, card, setNote,
    universeSeg,
    callout, tableBehind,
    csvButton, termsPanel, numbersPanel,
            sectionHeader, partHeader, simpleTable, FILTER_FIELDS };
})(window.IV);
