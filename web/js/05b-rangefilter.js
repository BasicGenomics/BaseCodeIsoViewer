(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;

  function RangeRow(spec) {
    this.spec = spec;
    this.lo = spec.lo;
    this.hi = spec.hi;
    this.min = spec.lo;
    this.max = spec.hi;
    this.onChange = spec.onChange;
    this.node = this.build();
  }

  RangeRow.prototype.toSlider = function (v) {
    const s = this.spec;
    if (s.scale === "log") {
      const a = Math.log10(this.min + 1), b = Math.log10(this.max + 1);
      return b > a ? (Math.log10(Math.max(this.min, v) + 1) - a) / (b - a) * 1000 : 0;
    }
    return this.max > this.min ? (v - this.min) / (this.max - this.min) * 1000 : 0;
  };

  RangeRow.prototype.fromSlider = function (p) {
    const s = this.spec;
    const t = Math.max(0, Math.min(1000, p)) / 1000;
    if (s.scale === "log") {
      const a = Math.log10(this.min + 1), b = Math.log10(this.max + 1);
      return Math.pow(10, a + t * (b - a)) - 1;
    }
    return this.min + t * (this.max - this.min);
  };

  RangeRow.prototype.quantise = function (v) {
    const s = this.spec;
    if (s.step === 1) return Math.round(v);
    if (s.decimals != null) {
      const f = Math.pow(10, s.decimals);
      return Math.round(v * f) / f;
    }
    return Math.round(v * 1000) / 1000;
  };

  RangeRow.prototype.build = function () {
    const self = this;
    const s = this.spec;
    const row = el("div", { class: "range-row" });

    const nameSpan = el("span", { class: "rr-name", text: s.label,
      style: s.help ? { cursor: "help" } : null });
    if (s.help) {
      const dot = el("span", { class: "faint", text: " ⓘ",
        style: { cursor: "help" } });
      IV.chart.bindHover(dot, function () {
        return '<div class="t-title">' + IV.fmt.escapeHtml(s.label) + '</div>'
          + '<div class="t-note">' + IV.fmt.escapeHtml(s.help) + '</div>';
      });
      nameSpan.appendChild(dot);
    }
    const head = el("div", { class: "rr-head" }, [nameSpan]);
    this.spanLbl = el("span", { class: "rr-span" });
    head.appendChild(this.spanLbl);
    row.appendChild(head);

    const sl = el("div", { class: "rr-sliders" });
    sl.appendChild(el("div", { class: "rr-track" }));
    this.fill = el("div", { class: "rr-fill" });
    sl.appendChild(this.fill);
    this.sLo = el("input", { type: "range", min: 0, max: 1000, step: 1,
      value: 0, "aria-label": s.label + " minimum" });
    this.sHi = el("input", { type: "range", min: 0, max: 1000, step: 1,
      value: 1000, "aria-label": s.label + " maximum" });
    sl.appendChild(this.sLo);
    sl.appendChild(this.sHi);
    row.appendChild(sl);

    const nums = el("div", { class: "rr-nums" });
    this.nLo = el("input", { type: "text", inputmode: "decimal",
      autocomplete: "off", spellcheck: "false",
      "aria-label": s.label + " minimum value" });
    this.nHi = el("input", { type: "text", inputmode: "decimal",
      autocomplete: "off", spellcheck: "false",
      "aria-label": s.label + " maximum value" });
    nums.appendChild(this.nLo);
    nums.appendChild(el("span", { class: "sep", text: "–" }));
    nums.appendChild(this.nHi);
    row.appendChild(nums);

    const onSlide = function () {
      let a = self.fromSlider(+self.sLo.value);
      let b = self.fromSlider(+self.sHi.value);
      if (a > b) { const t = a; a = b; b = t; }
      self.lo = self.quantise(a);
      self.hi = self.quantise(b);
      self.syncNums();
      self.syncFill();
      self.emit();
    };
    this.sLo.addEventListener("input", onSlide);
    this.sHi.addEventListener("input", onSlide);

    const onNum = function () {
      const a = self.nLo.value.trim() === "" ? self.min : parseNum(self.nLo.value);
      const b = self.nHi.value.trim() === "" ? self.max : parseNum(self.nHi.value);
      self.lo = Math.max(self.min, Math.min(isFinite(a) ? a : self.min, self.max));
      self.hi = Math.max(self.lo, Math.min(isFinite(b) ? b : self.max, self.max));
      self.syncSliders();
      self.syncFill();
      self.emit();
    };
    this.nLo.addEventListener("change", onNum);
    this.nHi.addEventListener("change", onNum);

    return row;
  };

  RangeRow.prototype.setBounds = function (min, max) {
    this.min = min;
    this.max = max > min ? max : min + (this.spec.step === 1 ? 1 : 1e-6);
    this.lo = this.min;
    this.hi = this.max;
    this.nLo.min = this.min;
    this.nLo.max = this.max;
    this.nHi.min = this.min;
    this.nHi.max = this.max;
    this.syncNums();
    this.syncSliders();
    this.syncFill();
  };

  RangeRow.prototype.syncNums = function () {
    this.nLo.value = this.fmt(this.lo);
    this.nHi.value = this.fmt(this.hi);
  };
  function parseNum(str) {
    if (str == null) return NaN;
    let t = String(str).trim().replace(/\s|\u00a0|_/g, "");
    if (!t) return NaN;
    const dots = (t.match(/\./g) || []).length;
    const commas = (t.match(/,/g) || []).length;
    if (dots && commas) t = t.replace(/,/g, "");
    else if (commas > 1) t = t.replace(/,/g, "");
    else if (commas === 1) t = t.replace(/,/g, ".");
    else if (dots > 1) t = t.replace(/\./g, "");
    const v = parseFloat(t);
    return isFinite(v) ? v : NaN;
  }

  RangeRow.prototype.fmt = function (v) {
    if (this.spec.step === 1) return F.int(Math.round(v));
    const q = this.quantise(v);
    return Number.isInteger(q) ? F.int(q) : F.dec(q, this.spec.decimals || 2);
  };
  RangeRow.prototype.syncSliders = function () {
    this.sLo.value = Math.round(this.toSlider(this.lo));
    this.sHi.value = Math.round(this.toSlider(this.hi));
  };
  RangeRow.prototype.syncFill = function () {
    const a = this.toSlider(this.lo) / 10, b = this.toSlider(this.hi) / 10;
    this.fill.style.left = a + "%";
    this.fill.style.width = Math.max(0, b - a) + "%";
    const full = this.isFull();
    this.spanLbl.textContent = full
      ? "all · " + this.fmtRange(this.min, this.max)
      : this.fmtRange(this.lo, this.hi);
    this.spanLbl.style.color = full ? "var(--ink-faint)" : "var(--brand)";
  };
  function fullNum(v) {
    if (v == null || !isFinite(v)) return "–";
    return Number.isInteger(v) ? F.int(v) : F.dec(v, 1);
  }
  RangeRow.prototype.fmtRange = function (a, b) {
    const f = this.spec.display || fullNum;
    return f(a) + " – " + f(b);
  };
  RangeRow.prototype.isFull = function () {
    const eps = (this.max - this.min) * 1e-9;
    return this.lo <= this.min + eps && this.hi >= this.max - eps;
  };
  RangeRow.prototype.emit = function () {
    if (this._t) clearTimeout(this._t);
    const self = this;
    this._t = setTimeout(function () { self.onChange(); }, 130);
  };
  RangeRow.prototype.value = function () {
    if (this.isFull()) return [null, null];
    const eps = (this.max - this.min) * 1e-9;
    return [this.lo <= this.min + eps ? null : this.lo,
            this.hi >= this.max - eps ? null : this.hi];
  };
  RangeRow.prototype.reset = function () {
    this.lo = this.min;
    this.hi = this.max;
    this.syncNums();
    this.syncSliders();
    this.syncFill();
  };

  function RangePanel(host, opts) {
    this.host = host;
    this.level = opts.level;
    this.onApply = opts.onApply;
    this.u = opts.universe;
    this.rows = {};
    this.cats = {};
    this.text = null;
    this.checks = {};
    this.filter = IV.stateApi.newFilter();
    this.build(opts);
  }

  RangePanel.prototype.build = function (opts) {
    const self = this;
    clear(this.host);
    const S = IV.stateApi;
    const nS = S.nActive();
    const isGene = this.level === "gene";
    const isDisc = IV.state.mode === "disc";
    const mode = IV.stateApi.modeInfo();
    const stats = this.stats();

    const defs = [
      { key: "val", label: "Counted molecules", scale: "log", decimals: 2,
        lo: stats.val[0], hi: stats.val[1],
        display: function (v) { return S.fmtValue(v); },
        help: "Counted molecules, in the active value type.",
        set: function (f, a, b) { f.valMin = a; f.valMax = b; } },
      { key: "tpm", label: "Total TPM", scale: "log", decimals: 2,
        lo: stats.tpm[0], hi: stats.tpm[1],
        display: function (v) { return F.dec(v, 2); },
        help: "Summed across samples, matching the counted-molecules slider.",
        set: function (f, a, b) { f.tpmMin = a; f.tpmMax = b; } },
      { key: "mol", label: "Detected molecules (total)", scale: "log", step: 1,
        lo: stats.mol[0], hi: stats.mol[1],
        display: fullNum,
        help: "Distinct reconstructed molecules assigned to the feature, summed " +
              "over the selected samples - the evidence behind the number, " +
              "independent of the value type. The Stringency floor in the header " +
              "is a different quantity: a per-sample peak of COUNTED molecules, " +
              "at least N in ONE sample.",
        set: function (f, a, b) { f.molMin = a; f.molMax = b; } },
      { key: "fl", label: "Full-length molecules", scale: "log", step: 1,
        lo: stats.fl[0], hi: stats.fl[1],
        display: fullNum,
        help: "Molecules with at least one 3′ and one 5′ read observed.",
        set: function (f, a, b) { f.flMin = a; } },
      { key: "flfrac", label: "Full-length fraction", decimals: 2, lo: 0, hi: 1,
        display: function (v) { return F.pct(v, 0); },
        help: "Full-length molecules divided by all supporting molecules.",
        set: function (f, a, b) { f.flFracMin = a; } },
      { key: "read", label: "Sequencing reads", scale: "log", step: 1,
        lo: stats.read[0], hi: stats.read[1],
        display: fullNum,
        help: "Raw sequencing reads behind those molecules.",
        set: function (f, a, b) { f.readMin = a; f.readMax = b; } },
    ];
    if (isGene) {
      defs.push({ key: "var", label: "Detected " + mode.variantWordPlural, step: 1,
        lo: stats.nvar[0], hi: stats.nvar[1],
        help: F.pretty(mode.variantWordPlural)
          + " surviving the stringency floor.",
        set: function (f, a, b) { f.varMin = a; f.varMax = b; } });
      if (isDisc) {
        defs.push({ key: "novel", label: "Novel " + mode.variantWordPlural, step: 1,
          lo: stats.novel[0], hi: stats.novel[1],
          set: function (f, a, b) { f.novelMin = a; } });
      }
      defs.push({ key: "ent", label: "Normalised entropy", decimals: 2, lo: 0, hi: 1,
        help: "0 = one dominant " + mode.variantWord + ", 1 = perfectly even "
              + "usage. Recomputed from the " + mode.variantWordPlural
              + " that survive stringency.",
        set: function (f, a, b) { f.entMin = a; f.entMax = b; } });
      if (nS > 1) {
        defs.push({ key: "jsd", label: "Mean pairwise JSD", decimals: 2, lo: 0, hi: 1,
          help: "Divergence of " + mode.variantWord
            + " usage between samples.",
          set: function (f, a, b) { f.jsdMin = a; f.jsdMax = b; } });
      }
    }
    if (nS > 1) {
      defs.push({ key: "ns", label: "Samples detected in", step: 1, lo: 1, hi: nS,
        set: function (f, a, b) { f.samplesMin = a; } });
    }

    if (IV.state.samples.length > 1 && IV.sampleSelect) {
      const self2 = this;
      IV.sampleSelect.chips(this.host, function () { self2.render(); });
    }

    const grid = el("div", { class: "filter-grid" });
    for (const dspec of defs) {
      const r = new RangeRow(Object.assign({}, dspec, {
        onChange: function () { self.apply(); },
      }));
      r.setBounds(dspec.lo, dspec.hi);
      this.rows[dspec.key] = { row: r, set: dspec.set };
      grid.appendChild(r.node);
    }
    this.host.appendChild(grid);

    const cats = el("div", { class: "filter-grid", style: { marginTop: "12px" } });
    const bioOpts = this.categoryOptions("biotype");
    if (bioOpts.length > 1) {
      if (IV.stateApi.hasBiotypes(isGene ? this.u.genes : this.u.tx)) {
        cats.appendChild(this.multiSelect("biotypes", "Biotype", bioOpts));
      }
    }
    if (isDisc) {
      const clsOpts = this.categoryOptions("class");
      if (clsOpts.length > 1) {
        cats.appendChild(this.multiSelect("classes", "Novelty class", clsOpts,
          IV.pal.NOVEL_SHORT, true));
      }
    }
    const nameRow = el("div", { class: "frow wide" }, [
      el("span", { class: "fl", text: isGene ? "Gene names or IDs"
        : F.pretty(mode.featureWord) + " / gene names or IDs" }),
      el("div", { class: "fi" }),
    ]);
    this.text = el("input", { type: "text", style: { flex: "1" },
      placeholder: this.level === "gene"
        ? IV.stateApi.searchPlaceholder(this.u.genes)
        : IV.stateApi.searchPlaceholder(this.u.genes,
            "comma, space or newline separated; a gene matches all its transcripts")
      });
    this.text.addEventListener("change", function () { self.apply(); });
    nameRow.lastChild.appendChild(this.text);
    cats.appendChild(nameRow);
    this.host.appendChild(cats);

    const toggles = el("div", { style: { display: "flex", gap: "16px",
      flexWrap: "wrap", marginTop: "12px", alignItems: "center" } });
    const addCheck = function (key, label, help, checked) {
      const cb = el("input", { type: "checkbox" });
      if (checked) cb.checked = true;
      cb.addEventListener("change", function () { self.apply(); });
      self.checks[key] = cb;
      const lb = el("label", { class: "small",
        style: { display: "flex", gap: "6px", alignItems: "center", cursor: "pointer" } },
        [cb, label]);
      if (help) {
        IV.chart.bindHover(lb, function () {
          return '<div class="t-title">' + IV.fmt.escapeHtml(label) + '</div>'
            + '<div class="t-note">' + IV.fmt.escapeHtml(help) + '</div>';
        });
      }
      toggles.appendChild(lb);
    };
    {
      const mode = IV.stateApi.modeInfo();
      const word = isGene ? mode.geneWordPlural : mode.featureWordPlural;
      addCheck("quantifiedOnly",
        "Quantified " + word + " only",
        "Hide " + word + " that carry molecule evidence but no counted value.",
        true);
    }
    if (isDisc) addCheck("novelOnly", "Novel only");
    toggles.appendChild(el("span", { style: { flex: "1" } }));
    this.countLbl = el("span", { class: "control-hint" });
    toggles.appendChild(this.countLbl);
    toggles.appendChild(el("button", { class: "btn", text: "Reset filters",
      onclick: function () { self.reset(); } }));
    this.host.appendChild(toggles);
  };

  RangePanel.prototype.stats = function () {
    const S = IV.stateApi;
    const u = this.u;
    const d = S.derive(u);
    const isGene = this.level === "gene";
    const frame = isGene ? u.genes : u.tx;
    const rows = isGene ? d.geneRows : d.txRows;
    const mol = frame.col("mol"), read = frame.col("read"), fl = frame.col("mol_fl");
    const nNic = u.genes.has("n_nic") ? u.genes.col("n_nic") : null;
    const nNnic = u.genes.has("n_nnic") ? u.genes.col("n_nnic") : null;

    const acc = { val: [Infinity, 0], mol: [Infinity, 0], read: [Infinity, 0],
                  fl: [0, 0], nvar: [Infinity, 0], novel: [0, 0],
                  tpm: [Infinity, 0] };
    const tf = isGene ? u.genes : u.tx;
    const hasTpm = tf.has("tpm");
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      const v = isGene ? d.value[i] : S.txValue(u.tx, i);
      if (v < acc.val[0]) acc.val[0] = v;
      if (v > acc.val[1]) acc.val[1] = v;
      if (mol[i] < acc.mol[0]) acc.mol[0] = mol[i];
      if (mol[i] > acc.mol[1]) acc.mol[1] = mol[i];
      if (read[i] < acc.read[0]) acc.read[0] = read[i];
      if (read[i] > acc.read[1]) acc.read[1] = read[i];
      if (fl[i] > acc.fl[1]) acc.fl[1] = fl[i];
      if (hasTpm) {
        const tv = S.totalTpm(tf, i) || 0;
        if (tv < acc.tpm[0]) acc.tpm[0] = tv;
        if (tv > acc.tpm[1]) acc.tpm[1] = tv;
      }
      if (isGene) {
        if (d.nVarDet[i] < acc.nvar[0]) acc.nvar[0] = d.nVarDet[i];
        if (d.nVarDet[i] > acc.nvar[1]) acc.nvar[1] = d.nVarDet[i];
        if (nNnic) {
          const nv = (nNic ? nNic[i] : 0) + nNnic[i];
          if (nv > acc.novel[1]) acc.novel[1] = nv;
        }
      }
    }
    for (const k in acc) {
      if (!isFinite(acc[k][0])) acc[k][0] = 0;
      if (!isFinite(acc[k][1]) || acc[k][1] <= acc[k][0]) acc[k][1] = acc[k][0] + 1;
    }
    if (isGene) acc.nvar[0] = Math.max(0, acc.nvar[0]);
    return acc;
  };

  RangePanel.prototype.categoryOptions = function (col) {
    const S = IV.stateApi;
    const u = this.u;
    const d = S.derive(u);
    const isGene = this.level === "gene";
    const frame = isGene ? u.genes : u.tx;
    if (!frame.has(col)) return [];
    const c = frame.col(col);
    const rows = isGene ? d.geneRows : d.txRows;
    const counts = {};
    for (let r = 0; r < rows.length; r++) {
      const v = IV.blocks.cell(c, rows[r]);
      counts[v] = (counts[v] || 0) + 1;
    }
    const fmt = col === "biotype" ? F.prettyBiotype : F.pretty;
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .map(function (v) { return { value: v, label: fmt(v), count: counts[v] }; });
  };

  RangePanel.prototype.multiSelect = function (key, label, options, labelMap,
                                              sortAlpha) {
    const self = this;
    if (sortAlpha) {
      options = options.slice().sort(function (a, b) {
        const la = (labelMap && labelMap[a.value]) || a.label;
        const lb = (labelMap && labelMap[b.value]) || b.label;
        return String(la).localeCompare(String(lb));
      });
    }
    const row = el("div", { class: "frow" });
    row.appendChild(el("span", { class: "fl", text: label }));
    const btn = el("button", { class: "btn", style: { textAlign: "left", width: "100%" },
      text: "All" });
    const menu = el("div", {
      style: { display: "none", position: "absolute", zIndex: "60", marginTop: "3px",
        background: "var(--surface)", border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-sm)", boxShadow: "var(--shadow-lg)",
        maxHeight: "300px", overflowY: "auto", padding: "6px", minWidth: "240px" },
    });
    const boxes = [];
    menu.appendChild(el("div", { style: { display: "flex", gap: "6px",
      padding: "2px 4px 6px" } }, [
      el("button", { class: "btn btn-sm", text: "All", onclick: function () {
        boxes.forEach(function (b) { b.checked = true; }); update(); } }),
      el("button", { class: "btn btn-sm", text: "None", onclick: function () {
        boxes.forEach(function (b) { b.checked = false; }); update(); } }),
    ]));
    for (const o of options) {
      const cb = el("input", { type: "checkbox", checked: true, value: o.value });
      boxes.push(cb);
      cb.addEventListener("change", update);
      menu.appendChild(el("label", { class: "small",
        style: { display: "flex", gap: "6px", alignItems: "center", padding: "2px 4px",
          cursor: "pointer" } }, [
        cb, el("span", { text: (labelMap && labelMap[o.value]) || o.label }),
        el("span", { class: "faint xsmall", style: { marginLeft: "auto" },
          text: F.int(o.count) }),
      ]));
    }
    function update() {
      const on = boxes.filter(function (b) { return b.checked; });
      btn.textContent = on.length === boxes.length ? "All"
        : on.length === 0 ? "None" : on.length + " of " + boxes.length;
      self.filter[key] = on.length === boxes.length ? null
        : new Set(on.map(function (b) { return b.value; }));
      self.apply();
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
    this.cats[key] = { boxes: boxes, update: update, btn: btn };
    return row;
  };

  RangePanel.prototype.apply = function () {
    const f = this.filter;
    f.valMin = f.valMax = f.molMin = f.molMax = null;
    f.readMin = f.readMax = f.flMin = f.flFracMin = null;
    f.varMin = f.varMax = f.novelMin = null;
    f.entMin = f.entMax = f.jsdMin = f.jsdMax = f.samplesMin = null;
    for (const k in this.rows) {
      const [a, b] = this.rows[k].row.value();
      this.rows[k].set(f, a, b);
    }
    f.names = IV.stateApi.parseNames(this.text ? this.text.value : "");
    f.quantifiedOnly = !!(this.checks.quantifiedOnly && this.checks.quantifiedOnly.checked);
    f.novelOnly = !!(this.checks.novelOnly && this.checks.novelOnly.checked);
    if (this.onApply) this.onApply(f);
  };

  RangePanel.prototype.reset = function () {
    for (const k in this.rows) this.rows[k].row.reset();
    for (const k in this.cats) {
      this.cats[k].boxes.forEach(function (b) { b.checked = true; });
      this.cats[k].update();
    }
    for (const k in this.checks) this.checks[k].checked = false;
    if (this.text) this.text.value = "";
    this.filter = IV.stateApi.newFilter();
    this.apply();
  };

  RangePanel.prototype.snapshot = function () {
    const rows = {};
    for (const k in this.rows) {
      rows[k] = { lo: this.rows[k].row.lo, hi: this.rows[k].row.hi };
    }
    const cats = {};
    for (const k in this.cats) {
      cats[k] = this.cats[k].boxes.map(function (b) { return b.checked; });
    }
    const checks = {};
    for (const k in this.checks) checks[k] = this.checks[k].checked;
    return { rows: rows, cats: cats, checks: checks,
             text: this.text ? this.text.value : "" };
  };

  RangePanel.prototype.restore = function (snap) {
    if (!snap) return false;
    for (const k in snap.rows) {
      const r = this.rows[k];
      if (!r) continue;
      r.row.lo = Math.max(r.row.min, Math.min(snap.rows[k].lo, r.row.max));
      r.row.hi = Math.max(r.row.lo, Math.min(snap.rows[k].hi, r.row.max));
      r.row.syncNums();
      r.row.syncSliders();
      r.row.syncFill();
    }
    for (const k in snap.cats) {
      const cat = this.cats[k];
      if (!cat || cat.boxes.length !== snap.cats[k].length) continue;
      snap.cats[k].forEach(function (v, i) { cat.boxes[i].checked = v; });
      cat.update();
    }
    for (const k in snap.checks) {
      if (this.checks[k]) this.checks[k].checked = snap.checks[k];
    }
    if (this.text) this.text.value = snap.text || "";
    return true;
  };

  RangePanel.prototype.setCount = function (text) {
    if (this.countLbl) this.countLbl.textContent = text;
  };

  IV.RangePanel = RangePanel;
  IV.RangeRow = RangeRow;
})(window.IV);
