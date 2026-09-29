(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;
  const P = IV.plots;

  function shownSampleNames() {
    const names = IV.state.core.samples || [];
    return IV.stateApi.activeIdx()
      .map(function (i) { return names[i]; })
      .sort(F.cmpNatural);
  }

  function sampleColorFor(name) {
    const all = IV.state.core.samples || [];
    const i = all.indexOf(name);
    return IV.pal.sampleColor(i < 0 ? 0 : i, Math.max(all.length, 1));
  }

  const cubeQ = { mode: "atleast", tc: 0, ic: 0, fc: 0, form: "ternary" };

  async function renderBaseCode(host) {
    clear(host);
    const core = IV.state.core;
    const a = core.assignment;
    if (!a) {
      host.appendChild(el("div", { class: "empty",
        text: "No read-assignment data in this report." }));
      return;
    }

    host.appendChild(U.partHeader("BaseCode", "Reads and molecules",
      "How the reads were collapsed into molecules, and what those molecules "
      + "carry."));

    if (core.library) {
      host.appendChild(U.sectionHeader("Sequencing"));
      host.appendChild(sequencingCard(core));

      host.appendChild(U.sectionHeader("Reconstruction"));
      host.appendChild(baseCodeCard(core));
      host.appendChild(endSupportCard(core));
      const lenCard = moleculeLengthCard(core);
      if (lenCard) host.appendChild(lenCard);
    } else if (core.sample_stats) {
      host.appendChild(U.sectionHeader("Reconstruction"));
      host.appendChild(overviewTable(core));
    }

    const adv = el("details", { class: "disclose adv-group" });
    adv.appendChild(el("summary", {},
      [el("span", { text: "Read-level detail" }),
       el("span", { class: "card-badge", text: "advanced" })]));
    const advBody = el("div");
    advBody.appendChild(cubeCard(core, a));
    advBody.appendChild(el("div", { class: "grid grid-2" }, [
      readsPerMoleculeCard(core, a),
      adaptationCard(core, a),
    ]));
    adv.appendChild(advBody);
    host.appendChild(adv);

  }

  async function renderIsoQuant(host) {
    clear(host);
    const core = IV.state.core;
    const a = core.assignment;
    if (!a) {
      host.appendChild(el("div", { class: "empty",
        text: "No read-assignment data in this report." }));
      return;
    }

    host.appendChild(U.partHeader("IsoQuant", "Assignment and quantification",
      "What IsoQuant made of those molecules: which feature each one was matched "
      + "to, and which ones quantification counted."));

    host.appendChild(U.sectionHeader("Assignment"));
    host.appendChild(weightBar(core, a));
    host.appendChild(contextTiles(core, a));

    const cls = el("details", { class: "disclose adv-group" });
    cls.appendChild(el("summary", {},
      [el("span", { text: "Structural classification" }),
       el("span", { class: "card-badge", text: "advanced" })]));
    const clsBody = el("div");

    if (IV.state.mode === "ref") {
      host.appendChild(outcomeCard(core, a));
      host.appendChild(perSampleCard(core, a));
      const gpm = genesPerMoleculeCard(a);
      if (gpm) host.appendChild(gpm);
      host.appendChild(typeReference(a));
      clsBody.appendChild(classificationCard(core, a));
    } else {
      if (core.discovery_assignment) {
        let geneMatches = 0;
        try {
          const du = await IV.stateApi.universe();
          const gcol = (IV.state.weight === "read" ? "read" : "mol")
            + (IV.state.universe === "fl" ? "_fl" : "");
          if (du && du.genes && du.genes.has(gcol)) {
            const gm = du.genes.col(gcol);
            for (let i = 0; i < du.genes.n; i++) geneMatches += gm[i];
          }
        } catch (e) { geneMatches = 0; }
        host.appendChild(discoveryCard(core, geneMatches));
      }
      const nmc = novelModelCards(core);
      if (nmc) clsBody.appendChild(nmc);
    }
    if (clsBody.childNodes.length) {
      cls.appendChild(clsBody);
      host.appendChild(cls);
    }

    const sup = el("details", { class: "disclose adv-group" });
    sup.appendChild(el("summary", {},
      [el("span", { text: F.pretty(IV.stateApi.modeInfo().geneWord) + " / "
         + IV.stateApi.modeInfo().featureWord + " support" }),
       el("span", { class: "card-badge", text: "advanced" })]));
    const supBody = el("div");
    supBody.appendChild(supportCard(core, a));
    sup.appendChild(supBody);
    host.appendChild(sup);
  }

  function weightBar(core, a) {
    const c = U.card(null);
    const row = el("div", { class: "control-row", style: { marginBottom: "0" } });
    row.appendChild(U.control("Weighting", U.seg([
      { label: "Per molecule", value: "mol",
        help: "One count per molecule - the biological unit, and how the rest of "
          + "the report counts." },
      { label: "Per read", value: "read",
        help: "One count per sequencing read, so deeply covered molecules weigh "
          + "more." },
    ], IV.state.weight, function (v) { IV.stateApi.setWeight(v); },
      { label: "Weighting" })));
    row.appendChild(U.universeSeg());
    row.appendChild(el("span", { class: "control-hint",
      html: "Currently counting <strong>" + IV.stateApi.weightLabel()
        + "</strong> over <strong>" + IV.stateApi.universeLabel()
        + "</strong>." }));
    c.appendChild(row);
    return c;
  }

  function contextTiles(core, a) {
    const box = el("div");
    const S = IV.stateApi;
    const slice = S.assignTotals();
    const all = S.assignTotals("all");
    const fl = S.assignTotals("fl");
    const flOnly = IV.state.universe === "fl";

    const weightIsRead = IV.state.weight === "read";
    U.tiles(box, [
      { label: "Sequencing reads", value: F.compact(slice.total_reads, 2),
        tone: weightIsRead ? "brand" : null, mark: weightIsRead,
        sub: "carried by these molecules" },
      { label: "Sequencing reads per molecule", value: F.dec(
          slice.total_molecules ? slice.total_reads / slice.total_molecules : 0, 2),
        sub: "median " + F.int(flOnly && a.reads_per_molecule.median_fl != null
              ? a.reads_per_molecule.median_fl : a.reads_per_molecule.median)
          + " · max " + F.int(flOnly && a.reads_per_molecule.max_fl != null
              ? a.reads_per_molecule.max_fl : a.reads_per_molecule.max) },
      { label: "Molecules", value: F.compact(slice.total_molecules, 2),
        tone: weightIsRead ? null : "brand", mark: !weightIsRead,
        sub: IV.state.universe === "all" ? "all reconstructed"
          : F.pctOf(slice.total_molecules, all.total_molecules)
            + " of all reconstructed molecules" },
      flOnly ? null
        : { label: "Full-length",
            value: F.pctOf(fl.total_molecules, all.total_molecules),
            sub: F.compact(fl.total_molecules) + " molecules · "
              + F.pctOf(fl.total_reads, all.total_reads) + " of reads",
            help: a.fl_definitions.fl },
    ].filter(Boolean));
    return box;
  }

  function typeReference(a) {
    const c = U.card("What each assignment type means");
    const wrap = el("div", { class: "tbl-wrap" });
    const t = el("table", { class: "dt compact" });
    t.appendChild(el("thead", {}, el("tr", {}, [
      el("th", { class: "no-sort", text: "Type" }),
      el("th", { class: "no-sort", text: "Family" }),
      el("th", { class: "no-sort", text: "Meaning" }),
    ])));
    const tb = el("tbody");
    for (const type of IV.pal.orderAssign(a.assign_values)) {
      const tr = el("tr");
      tr.appendChild(el("td", {}, [
        el("span", { style: { display: "inline-block", width: "9px", height: "9px",
          borderRadius: "2px", marginRight: "6px",
          background: IV.pal.assignColor(type) } }),
        el("span", { text: IV.pal.ASSIGN_LABEL[type] || F.pretty(type) }),
      ]));
      tr.appendChild(el("td", { class: "small muted",
        text: IV.pal.FAMILY_LABEL[IV.pal.assignFamily(type)] }));
      tr.appendChild(el("td", { class: "small", style: { whiteSpace: "normal" },
        text: IV.pal.ASSIGN_HELP[type] || "" }));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    c.appendChild(wrap);
    return c;
  }

  function geneLevelSplit(arr, a) {
    let resolved = 0, none = 0;
    a.assign_values.forEach(function (t, i) {
      if ((a.outcome_of[t] || "no_gene") === "no_gene") none += arr[i] || 0;
      else resolved += arr[i] || 0;
    });
    return { resolved: resolved, none: none };
  }

  const GENE_SEG_HELP = {
    resolved: "Counted and assigned-but-not-counted molecules together. IsoQuant "
      + "quantifies once, per molecule and over all molecules, so the two cannot "
      + "be separated here.",
  };

  function summaryTile(label, value, total, help) {
    const box = el("div");
    U.tiles(box, [{ label: label, value: F.pctOf(value, total),
      sub: F.compact(value) + " of " + F.compact(total), help: help }]);
    return box;
  }

  function outcomeCard(core, a) {
    const wKey = IV.state.weight === "read" ? "read" : "mol";
    const arr = IV.stateApi.assignTotals().assign;
    const order = IV.pal.orderAssign(a.assign_values);

    const c = U.card("Assignment outcome", {
      tools: [el("span", { class: "xsmall faint",
        text: IV.stateApi.weightLabelCap() + " · " + IV.stateApi.universeLabel() })],
    });

    const items = order.map(function (t) {
      const i = a.assign_values.indexOf(t);
      return {
        key: t, label: IV.pal.ASSIGN_LABEL[t] || F.pretty(t),
        value: arr[i] || 0, color: IV.pal.assignColor(t),
        help: IV.pal.ASSIGN_HELP[t], family: IV.pal.assignFamily(t),
      };
    });
    const total = items.reduce(function (s, x) { return s + x.value; }, 0);

    const fam = {};
    for (const it of items) fam[it.family] = (fam[it.family] || 0) + it.value;
    const gl = geneLevelSplit(arr, a);
    const glTotal = gl.resolved + gl.none;

    const mode = IV.stateApi.modeInfo();
    const counted = ((core.universe || {})[mode.key] || {}).counted_molecules_gene;
    const countedComparable = counted != null
      && IV.state.weight === "mol" && IV.state.universe === "all";

    const topTiles = [
      summaryTile("Assigned to a gene", gl.resolved, glTotal,
        F.pretty(IV.stateApi.weightLabel()) + " overlapping a gene in the "
        + "assignment table. Not the same as being counted."),
    ];
    if (countedComparable) {
      topTiles.push(summaryTile("Counted toward a gene", counted, glTotal,
        "Molecules included in gene quantification. This excludes molecules that "
        + "contradict the annotation or that are ambiguously assigned to multiple "
        + "genes."));
    }
    topTiles.push(summaryTile("Resolved to one transcript variant", fam.resolved || 0, total,
      "Molecules assigned to a single transcript variant."));
    c.appendChild(el("div", { class: "grid grid-2" }, topTiles));
    const levelGrid = el("div", { class: "grid grid-2" });

    const genePanel = el("div");
    genePanel.appendChild(el("h3", { text: "By gene" }));
    const notCounted = countedComparable
      ? Math.max(0, gl.resolved - counted) : 0;
    const geneSegs = countedComparable
      ? [
          { label: "Counted toward a gene", value: counted,
            color: IV.pal.familyColor("resolved") },
          { label: "Assigned but not counted", value: notCounted,
            color: IV.pal.familyColor("ambiguous") },
          { label: "Not assigned to a gene", value: gl.none,
            color: IV.pal.familyColor("none") },
        ]
      : [
          { label: "Assigned to a gene", value: gl.resolved,
            color: IV.dom.token("--brand-blue"),
            help: GENE_SEG_HELP.resolved },
          { label: "Not assigned to a gene", value: gl.none,
            color: IV.pal.familyColor("none") },
        ];
    const geneBar = el("div");
    IV.chart.stackBar(geneBar, geneSegs.filter(function (x) { return x.value; }),
      { height: 30, valueLabel: IV.stateApi.weightLabelCap() });
    genePanel.appendChild(geneBar);
    genePanel.appendChild(U.tableBehind(
      ["Outcome", IV.stateApi.weightLabelCap(), "Share"],
      geneSegs.map(function (x) {
        return [x.label, F.int(x.value), F.pctOf(x.value, glTotal, 2)];
      })));
    levelGrid.appendChild(genePanel);

    const txPanel = el("div");
    txPanel.appendChild(el("h3", { text: "By transcript variant" }));
    const famBar = el("div");
    IV.chart.stackBar(famBar, IV.pal.FAMILY_ORDER.filter(function (k) {
      return fam[k];
    }).map(function (k) {
      return { label: IV.pal.FAMILY_LABEL[k], value: fam[k], color: IV.pal.familyColor(k) };
    }), { height: 30, valueLabel: IV.stateApi.weightLabelCap() });
    txPanel.appendChild(famBar);
    txPanel.appendChild(U.tableBehind(
      ["Family", IV.stateApi.weightLabelCap(), "Share"],
      IV.pal.FAMILY_ORDER.filter(function (k) { return fam[k]; }).map(function (k) {
        return [IV.pal.FAMILY_LABEL[k], F.int(fam[k]), F.pctOf(fam[k], total, 2)];
      })));
    levelGrid.appendChild(txPanel);
    c.appendChild(levelGrid);

    c.appendChild(el("h3", { text: "By transcript variant, split by assignment type" }));
    const bars = el("div");
    IV.chart.stackBar(bars, items.filter(function (x) { return x.value > 0; })
      .map(function (x) {
        return { label: x.label, value: x.value, color: x.color,
                 help: x.help };
      }), { height: 30, valueLabel: IV.stateApi.weightLabelCap() });
    c.appendChild(bars);

    c.appendChild(U.tableBehind(
      ["Assignment type", "Family", IV.stateApi.weightLabelCap(), "Share"],
      items.map(function (x) {
        return [x.label, IV.pal.FAMILY_LABEL[x.family], F.int(x.value),
                F.pctOf(x.value, total, 2)];
      })));

    return c;
  }

  function perSampleCard(core, a) {
    if (core.samples.length < 2) return el("div");
    const wKey = IV.state.weight === "read" ? "read" : "mol";
    const slice = IV.stateApi.qcSlice().uni;
    const mat = slice["sample_assign_" + wKey];
    const shownSamples = shownSampleNames();
    const order = IV.pal.orderAssign(a.assign_values);
    const colors = {}, labels = {}, help = {};
    for (const t of order) {
      colors[t] = IV.pal.assignColor(t);
      labels[t] = IV.pal.ASSIGN_LABEL[t] || F.pretty(t);
      help[t] = IV.pal.ASSIGN_HELP[t];
    }

    const c = U.card("Assignment outcome by sample");

    const uniAll = (core.universe || {})[IV.stateApi.modeInfo().key] || {};
    const countedS = uniAll.counted_molecules_gene_s || null;
    const countedSamples = uniAll.counted_samples || null;
    const threeWay = countedS && IV.state.weight === "mol"
      && IV.state.universe === "all";

    const geneOrder = threeWay
      ? ["counted", "assignedNotCounted", "none"]
      : ["resolved", "none"];
    const geneColors = {
      counted: IV.pal.familyColor("resolved"),
      assignedNotCounted: IV.pal.familyColor("ambiguous"),
      resolved: IV.dom.token("--brand-blue"),
      none: IV.pal.familyColor("none"),
    };
    const geneLabels = {
      counted: "Counted toward a gene",
      assignedNotCounted: "Assigned but not counted",
      resolved: "Assigned to a gene",
      none: "Not assigned to a gene",
    };
    const geneGroups = shownSamples.map(function (s) {
      const si = a.sample_values.indexOf(s);
      const row = si >= 0 ? mat[si] : null;
      let resolved = 0, none = 0;
      a.assign_values.forEach(function (t, ti) {
        const v = row ? (row[ti] || 0) : 0;
        if ((a.outcome_of[t] || "no_gene") === "no_gene") none += v; else resolved += v;
      });
      if (!threeWay) {
        return { label: s, values: { resolved: resolved, none: none } };
      }
      let ci = countedSamples ? countedSamples.indexOf(s) : si;
      if (ci < 0) ci = si;
      const cnt = Math.min(countedS[ci] || 0, resolved);
      return { label: s, values: {
        counted: cnt,
        assignedNotCounted: Math.max(0, resolved - cnt),
        none: none,
      } };
    });
    c.appendChild(el("h3", { text: "By gene" }));
    const geneHolder = el("div");
    IV.chart.stackGroups(geneHolder, geneGroups, geneOrder, {
      colors: geneColors, labels: geneLabels, help: GENE_SEG_HELP,
      valueLabel: IV.stateApi.weightLabelCap(), labelW: 118, height: 20,
    });
    c.appendChild(geneHolder);

    c.appendChild(el("h3", { text: "By transcript variant, split by assignment type" }));
    const groups = shownSamples.map(function (s) {
      const si = a.sample_values.indexOf(s);
      const values = {};
      order.forEach(function (t) {
        const ti = a.assign_values.indexOf(t);
        values[t] = si >= 0 ? mat[si][ti] : 0;
      });
      return { label: s, values: values };
    });
    const holder = el("div");
    IV.chart.stackGroups(holder, groups, order, {
      colors: colors, labels: labels, help: help,
      valueLabel: IV.stateApi.weightLabelCap(), labelW: 118, height: 20,
    });
    c.appendChild(holder);

    return c;
  }

  function sequencingCard(core) {
    const lib = core.library;
    const ss = lib && lib.summary_stats;
    if (!ss || !ss.per_sample) return el("div");
    const have = core.samples.some(function (sn) {
      const r = ss.per_sample[sn];
      return r && (r.reads_total || 0) > 0;
    });
    if (!have) return el("div");

    const c = U.card("Sequencing", {
      note: "Read pairs, by which end of the molecule they came from.",
    });

    const holder = el("div");
    IV.chart.stackGroups(holder, shownSampleNames().map(function (sname) {
      const r = ss.per_sample[sname] || {};
      return { label: sname, values: { p3: r.reads_3p || 0,
                                       pi: r.reads_internal || 0,
                                       p5: r.reads_5p || 0 } };
    }), ["p3", "pi", "p5"], {
      colors: { p3: IV.dom.token("--brand"), pi: IV.dom.token("--brand-blue"),
                p5: IV.dom.token("--accent") },
      labels: { p3: "3′", pi: "Internal", p5: "5′" },
      labelW: 118, height: 20, valueLabel: "Read pairs",
    });
    c.appendChild(holder);

    const rows = shownSampleNames().map(function (sname) {
      const r = ss.per_sample[sname] || {};
      const tot = r.reads_total || 0;
      return [sname, F.int(tot),
        F.int(r.reads_3p || 0) + " (" + F.pctOf(r.reads_3p || 0, tot, 0) + ")",
        F.int(r.reads_internal || 0) + " (" + F.pctOf(r.reads_internal || 0, tot, 0) + ")",
        F.int(r.reads_5p || 0) + " (" + F.pctOf(r.reads_5p || 0, tot, 0) + ")"];
    });
    U.numbersPanel(c, {
      content: U.simpleTable(["Sample", "Read pairs", "3′", "Internal", "5′"],
        rows, [false, true, true, true, true]),
    });
    return c;
  }

  function baseCodeCard(core) {
    const lib = core.library;
    const c = U.card("Molecule reconstruction");

    const ss = lib.summary_stats;
    const psm = lib.per_sample_molecules || {};
    const perSample = ss && ss.per_sample ? ss.per_sample : null;

    const rowsData = shownSampleNames().map(function (sname) {
      const r = (perSample && perSample[sname]) || {};
      const m = psm[sname] || {};
      const nMol = m.n_molecules || 0;
      return {
        sample: sname,
        reads: r.reads_total || 0,
        molecules: nMol,
        fl: m.n_fl_loose != null ? m.n_fl_loose : null,
        gap: m.n_with_gap != null ? m.n_with_gap : null,
      };
    });
    const haveAny = rowsData.some(function (r) {
      return r.reads > 0 || r.molecules > 0;
    });
    if (!haveAny) return c;

    const grid = el("div", { class: "grid grid-3" });
    const specs = [
      { key: "reads", title: "Sequencing read pairs", unit: "Read pairs" },
      { key: "molecules", title: "Molecules reconstructed", unit: "Molecules" },
      { key: "fl", title: "Full-length molecules", unit: "Molecules" },
    ];
    for (const sp of specs) {
      if (!rowsData.some(function (r) { return r[sp.key] != null && r[sp.key] > 0; })) {
        continue;
      }
      const box = el("div");
      box.appendChild(el("div", { class: "xsmall strong faint", text: sp.title }));
      const h = el("div");
      IV.chart.barsH(h, rowsData.map(function (r, si) {
        return {
          label: r.sample, value: r[sp.key] || 0,
          color: sampleColorFor(r.sample),
          of: sp.key === "fl" ? (r.molecules || 0) : null,
        };
      }), { valueLabel: sp.unit, labelW: 110, rowH: 18,
            shareLabel: sp.key === "fl" ? "Of this sample's molecules" : "Share" });
      box.appendChild(h);
      grid.appendChild(box);
    }
    c.appendChild(grid);

    const head = ["Sample", "Read pairs", "Molecules", "Full-length molecules"];
    const tblRows = rowsData.map(function (r) {
      return [r.sample, F.int(r.reads), F.int(r.molecules),
        r.fl != null
          ? F.int(r.fl) + " (" + F.pctOf(r.fl, r.molecules, 0) + ")" : "–"];
    });
    U.numbersPanel(c, {
      content: U.simpleTable(head, tblRows,
        head.map(function (_, i) { return i > 0; })),
    });

    c.appendChild(el("p", { class: "note small",
      html: "<strong>Full-length</strong>: at least one 3′ and one 5′ read on the "
        + "same molecule." }));
    return c;
  }

  function overviewTable(core) {
    const a = core.assignment;
    const c = U.card("Per-sample summary", {
      note: "Molecule and read totals come from the assignment layer, so the read "
        + "count is reads that reached an assigned molecule - fewer than the "
        + "library delivered.",
    });

    const rows = core.sample_stats;
    const cols = [
      ["Sample", function (r) { return r.sample; }, false],
      ["Reads in assigned molecules",
        function (r) { return F.int(r.reads); }, true],
      ["Molecules", function (r) { return F.int(r.molecules); }, true],
      ["Reads per molecule", function (r) { return F.dec(r.reads_per_molecule, 2); }, true],
      ["Full-length molecules", function (r) {
        return F.int(r.molecules_fl) + " (" + F.pctOf(r.molecules_fl, r.molecules, 0) + ")";
      }, true],
    ];
    U.numbersPanel(c, {
      content: U.simpleTable(cols.map(function (x) { return x[0]; }),
        rows.map(function (r) { return cols.map(function (x) { return x[1](r); }); }),
        cols.map(function (x) { return x[2]; })),
    });

    if (rows.length >= 2) {
      c.appendChild(el("h3", { text: "Sequencing depth and molecule yield" }));
      const grid = el("div", { class: "grid grid-2" });
      const a1 = el("div"), a2 = el("div");
      a1.appendChild(el("div", { class: "xsmall strong faint", text: "Sequencing reads" }));
      const h1 = el("div");
      IV.chart.barsH(h1, rows.map(function (r, i) {
        return { label: r.sample, value: r.reads, color: IV.stateApi.sampleColor(i),
                 help: F.mols(r.molecules, 0) };
      }), { valueLabel: "Sequencing reads", labelW: 118 });
      a1.appendChild(h1);
      a2.appendChild(el("div", { class: "xsmall strong faint", text: "Molecules" }));
      const h2 = el("div");
      IV.chart.barsH(h2, rows.map(function (r, i) {
        return { label: r.sample, value: r.molecules, color: IV.stateApi.sampleColor(i),
                 help: F.dec(r.reads_per_molecule, 2) + " reads per molecule" };
      }), { valueLabel: "Molecules", labelW: 118 });
      a2.appendChild(h2);
      grid.appendChild(a1);
      grid.appendChild(a2);
      c.appendChild(grid);
    }
    return c;
  }

  function classificationCard(core, a) {
    const arr = IV.stateApi.assignTotals().cls || [];
    const items = a.class_values.map(function (v, i) {
      return { label: v === "(none)" ? "No classification" : F.pretty(v),
               raw: v, value: arr[i] || 0 };
    }).filter(function (x) { return x.value > 0; })
      .sort(function (x, y) { return x.label.localeCompare(y.label); });
    if (!items.length) return el("div");
    const total = items.reduce(function (s, x) { return s + x.value; }, 0);

    const c = U.card("Structural classification of molecules", {
      note: "IsoQuant's verdict on how each molecule's structure relates to the "
        + "annotation, in SQANTI's categories.",
    });
    const holder = el("div");
    IV.chart.barsH(holder, items.map(function (x, i) {
      const def = IV.sqanti.categoryDef(x.raw);
      const subs = IV.sqanti.categorySubcats(x.raw);
      return { label: x.label, value: x.value,
               help: def
                 ? def + (subs.length
                     ? " Subcategories: " + subs.join(", ") + "."
                     : " SQANTI does not subtype this category.")
                 : null,
               color: IV.sqanti.categoryColor(x.raw,
                 IV.pal.sequential(0.60 - 0.45 * i / Math.max(6, items.length))) };
    }), { valueLabel: IV.stateApi.weightLabelCap(), total: total, labelW: 200 });
    c.appendChild(holder);
    c.appendChild(U.tableBehind(
      ["Classification", IV.stateApi.weightLabelCap(), "Share"],
      items.map(function (x) {
        return [x.label, F.int(x.value), F.pctOf(x.value, total, 2)];
      })));
    return c;
  }

  function genesPerMoleculeCard(a) {
    const g = a.genes_per_molecule;
    if (!g || !g.counts || !g.counts.length) return null;
    const flOnly = IV.state.universe === "fl" && g.counts_fl;
    const counts = flOnly ? g.counts_fl : g.counts;
    const withGene = (flOnly ? g.with_gene_fl : g.with_gene) || 0;
    const multi = (flOnly ? g.multi_gene_fl : g.multi_gene) || 0;
    const c = U.card("Genes per molecule", {
      note: "How often a molecule is assigned to one gene, and how often to "
        + "several.",
    });
    const box = el("div");
    U.tiles(box, [
      { label: "On exactly one gene", value: F.compact(counts[1] || 0, 2),
        sub: withGene ? F.pctOf(counts[1] || 0, withGene, 1)
          + " of molecules with a gene" : null },
      { label: "On more than one gene", value: F.compact(multi, 2),
        sub: withGene ? F.pctOf(multi, withGene, 1)
          + " of molecules with a gene" : null },
    ]);
    c.appendChild(box);
    c.appendChild(el("p", { class: "note small",
      text: "Multi-gene and other ambiguous or inconsistent assignments can "
        + "explain why some detected molecules do not contribute to gene "
        + "counts." }));
    return c;
  }

  const lenView = { pop: "all" };

  function moleculeLengthCard(core) {
    const ml = (core.library || {}).molecule_lengths;
    if (!ml || !ml.all || !ml.all.length) return null;

    const c = U.card("Reconstructed molecule length");
    IV.plots.controls(c, { groups: [{
      label: "Molecules", value: lenView.pop,
      options: [
        { label: "All", value: "all",
          help: "Every reconstructed molecule." },
        { label: "Full-length", value: "fl",
          help: "Molecules with at least one 3′ and one 5′ read observed." },
      ],
      onChange: function (v) { lenView.pop = v; draw(); },
    }] });

    const holder = el("div", { class: "chart" });
    c.appendChild(holder);
    const foot = el("p", { class: "note small", style: { marginTop: "8px" } });
    c.appendChild(foot);

    const w = ml.bin_w, nb = ml.n_bins, cap = ml.cap;
    const xs = [];
    for (let i = 0; i <= nb; i++) xs.push(i === nb ? cap : i * w + w / 2);

    function draw() {
      const key = lenView.pop === "fl" ? "fl" : "all";
      const payloadSamples = ml.samples || [];
      const shown = shownSampleNames();
      const use = shown.filter(function (sm) { return payloadSamples.indexOf(sm) >= 0; });
      const perHist = ml["per_sample_" + key];
      const perStats = ml["per_sample_stats_" + key];

      const flHist = ml.per_sample_fl;
      const series = [];
      if (use.length && perHist) {
        use.forEach(function (sm) {
          const i = payloadSamples.indexOf(sm);
          series.push({ name: sm, hist: perHist[i],
                        fl: (key === "all" && flHist) ? flHist[i] : null,
                        stats: perStats ? perStats[i] : null,
                        color: sampleColorFor(sm) });
        });
      } else {
        series.push({ name: "All molecules", hist: ml[key],
                      fl: key === "all" ? ml.fl : null,
                      stats: ml["stats_" + key],
                      color: IV.dom.token("--brand") });
      }

      const usable = series.filter(function (sr) { return sr.hist && sr.hist.length; });
      if (!usable.length) {
        clear(holder);
        holder.appendChild(el("div", { class: "empty",
          text: "No molecule lengths for this selection." }));
        foot.textContent = "";
        return;
      }

      let drew = false;
      if (IV.px && IV.px.available()) {
        const traces = usable.map(function (sr) {
          const tot = sr.hist.reduce(function (x, y) { return x + y; }, 0) || 1;
          return {
            type: "scatter", mode: "lines", name: sr.name,
            x: xs, y: sr.hist.map(function (n) { return 100 * n / tot; }),
            line: { color: sr.color, width: 2, shape: "spline", smoothing: 0.4 },
            hovertext: sr.hist.map(function (n, i) {
              const label = i === nb ? (F.int(cap) + "+ bp")
                : (F.int(i * w) + "–" + F.int(i * w + w - 1) + " bp");
              const fl = sr.fl ? sr.fl[i] : null;
              return "<b>" + F.escapeHtml(sr.name) + "</b><br>" + label
                + "<br>Molecules: " + F.int(n)
                + "<br>Share: " + F.pctOf(n, tot, 2)
                + (fl == null ? ""
                    : "<br>Full-length: " + F.int(fl)
                      + (n ? " (" + F.pctOf(fl, n, 0) + ")" : ""));
            }),
            hoverinfo: "text",
            hovertemplate: "%{hovertext}<extra></extra>",
          };
        });
        drew = IV.px.draw(holder, traces, {
          height: 260,
          xTitle: "Molecule length (bp)",
          yTitle: "% of molecules",
          exportName: "molecule-length",
        });
      }
      if (!drew) {
        const sr = usable[0];
        const tot = sr.hist.reduce(function (x, y) { return x + y; }, 0) || 1;
        IV.chart.barsH(holder, sr.hist.map(function (n, i) {
          return { label: i === nb ? (F.int(cap) + "+")
                     : (F.int(i * w) + "–" + F.int(i * w + w - 1)),
                   value: n,
                   color: IV.pal.sequential(0.25 + 0.6 * i / (nb + 1)) };
        }), { valueLabel: "Molecules", labelW: 96, rowH: 12, total: tot });
      }

      foot.innerHTML = usable.map(function (sr) {
        const st = sr.stats || {};
        return '<span style="color:' + sr.color + '">●</span> '
          + F.escapeHtml(sr.name) + " mean <strong>" + F.int(st.mean || 0)
          + "</strong> bp · " + F.compact(st.n || 0) + " molecules";
      }).join(" &nbsp;·&nbsp; ");
    }
    draw();
    return c;
  }

  const supView = { level: "gene", logY: true };

  function supportCard(core, a) {
    const c = U.card("Support against quantification", { note: "" });
    const holder = el("div", { class: "chart" });
    const legendHost = el("div");
    const footHost = el("div");

    P.controls(c, {
      groups: [{
        label: "Level", value: supView.level,
        options: [{ label: "Gene", value: "gene" },
                  { label: F.pretty(IV.stateApi.modeInfo().featureWord),
                    value: "tx" }],
        onChange: function (v) { supView.level = v; draw(); },
      }],
    });
    c.appendChild(holder);
    c.appendChild(legendHost);
    c.appendChild(footHost);

    async function draw() {
      clear(holder); clear(legendHost); clear(footHost);
      const mode = IV.stateApi.modeInfo();
      const u = await IV.stateApi.universe();
      const d = IV.stateApi.derive(u);
      const isGene = supView.level === "gene";
      const frame = isGene ? u.genes : u.tx;
      const ids = frame.col("id"), names = frame.col("name");
      const gNames = u.genes.col("name");
      const gi = isGene ? null : u.tx.col("gene_idx");

      let ev, cr, xTitle, yTitle, evLabel, what;
      if (isGene) {
        if (!frame.has("mol")) {
          holder.appendChild(el("div", { class: "empty",
            text: "No molecule columns at " + mode.geneWord + " level." }));
          return;
        }
        const mol = frame.col("mol");
        ev = function (i) { return mol[i]; };
        cr = function (i) { return Math.round(d.total[i] || 0); };
        xTitle = "Detected molecules";
        yTitle = "Counted molecules";
        evLabel = "Detected molecules";
        what = mode.geneWordPlural;
      } else {
        if (!frame.has("sup_reads")) {
          holder.appendChild(el("div", { class: "empty",
            text: "No support columns at " + mode.featureWord + " level." }));
          return;
        }
        const sup = frame.col("sup_reads"), cnt = frame.col("count");
        ev = function (i) { return sup[i]; };
        cr = function (i) { return cnt[i]; };
        xTitle = "Molecules this " + mode.featureWord + " could account for";
        yTitle = "Counted molecules";
        evLabel = "Molecules it could account for";
        what = mode.featureWordPlural;
      }
      const frac = frame.has("sup_frac_fl") ? frame.col("sup_frac_fl")
        : (frame.has("mol_fl") && frame.has("mol") ? null : null);
      const molFl = frame.has("mol_fl") ? frame.col("mol_fl") : null;
      const molAll = frame.has("mol") ? frame.col("mol") : null;
      const flShare = function (i) {
        if (frac) return frac[i];
        if (molFl && molAll && molAll[i] > 0) return molFl[i] / molAll[i];
        return null;
      };
      const flRow = function (i) {
        const fs = flShare(i);
        if (fs == null) return null;
        return ["Full-length molecules",
                molFl ? F.int(molFl[i]) + " (" + F.pct(fs, 0) + ")"
                      : F.pct(fs, 1)];
      };

      const rows = [];
      for (let i = 0; i < frame.n; i++) if (ev(i) > 0) rows.push(i);
      if (!rows.length) {
        holder.appendChild(el("div", { class: "empty", text: "Nothing to plot" }));
        return;
      }

      U.setNote(c, "Relationship between detected and counted molecules. "
        + "<em>Each point is one "
        + F.escapeHtml(isGene ? mode.geneWord : mode.featureWord)
        + " - hover for its numbers, click to open it.</em>");

      const xs = [], ys = [], cols = [], hov = [];
      for (const i of rows) {
        xs.push(ev(i));
        ys.push(cr(i));
        const fs = flShare(i);
        cols.push(IV.pal.sequential(fs == null ? 0 : fs));
        const hr = [];
        if (!isGene) hr.push(["Gene", IV.blocks.cell(gNames, gi[i])]);
        hr.push([evLabel, F.int(ev(i))]);
        hr.push(["Counted molecules", F.int(cr(i))]);
        if (flRow(i)) hr.push(flRow(i));
        hov.push(IV.px && IV.px.available()
          ? IV.px.rowsToHover(IV.blocks.cell(names, i) || IV.blocks.cell(ids, i), hr)
          : "");
      }
      const open = function (k) {
        IV.app.openGene(isGene ? rows[k] : gi[rows[k]]);
      };

      let drew = false;
      if (IV.px && IV.px.available()) {
        drew = IV.px.points(holder, { x: xs, y: ys, hover: hov, color: cols }, {
          height: 330,
          xTitle: xTitle, yTitle: yTitle,
          exportName: "support-vs-quantification",
          markerSize: 5,
          xaxis: { type: "log", tickformat: ".2s" },
          yaxis: supView.logY
            ? { type: "log", tickformat: ".2s" }
            : { rangemode: "tozero", tickformat: ".2s" },
          onPick: open,
        });
      }
      if (!drew) {
        IV.chart.scatter(holder, {
          n: rows.length,
          x: function (k) { return Math.log10(xs[k] + 1); },
          y: function (k) { return Math.log10(ys[k] + 1); },
          color: function (k) { return cols[k]; },
          tip: function (k) {
            const i = rows[k];
            const fs = flShare(i);
            const hr = [];
            if (!isGene) hr.push(["Gene", IV.blocks.cell(gNames, gi[i])]);
            hr.push([evLabel, F.int(ev(i))]);
            hr.push(["Counted molecules", F.int(cr(i))]);
            if (flRow(i)) hr.push(flRow(i));
            return IV.chart.tipHTML(
              IV.blocks.cell(names, i) || IV.blocks.cell(ids, i), hr);
          },
        }, {
          height: 330, xTitle: xTitle + " (log₁₀)", yTitle: yTitle + " (log₁₀)",
          xKind: "log1p", yKind: "log1p", onPick: open,
        });
      }
      IV.chart.colorBar(legendHost, {
        title: "Full-length share",
        colorAt: function (t) { return IV.pal.sequential(t); },
        ticks: [{ at: 0, label: "0%" }, { at: 0.5, label: "50%" },
                { at: 1, label: "100%" }],
      });
      let zero = 0;
      for (const i of rows) if (!(cr(i) > 0)) zero++;
      footHost.appendChild(el("p", { class: "note small",
        html: "<strong>" + F.int(zero) + "</strong> of " + F.int(rows.length) + " "
          + F.escapeHtml(what) + " with evidence have a count of zero ("
          + F.pctOf(zero, rows.length, 1) + ")."
          }));
    }
    draw();
    return c;
  }

  function cubeCard(core, a) {
    const cube = a.end_cube;
    if (!cube) return el("div");
    const cap = cube.cap;
    const ps = cube.per_sample;
    const scoped = !IV.stateApi.allSamplesOn();
    const canScope = !!(ps && ps.samples && ps.samples.length);
    const c = U.card("Read support explorer", {
      badge: "advanced",
      note: "How many molecules have a given number of 3′, internal and 5′ "
        + "reads. Set a threshold or an exact combination."
        + (scoped && !canScope
            ? " <strong>Whole run</strong>: this run has too many samples for a "
              + "per-sample breakdown of this distribution, so it does not follow "
              + "the sample selection."
            : ""),
    });

    function slice() {
      const tri = cube.triples;
      if (!tri || !tri.tc) return null;
      const tps = tri.per_sample;
      const canScopeTri = !!(tps && tps.samples && tps.samples.length);
      if (!canScopeTri) {
        return { tri: tri, mol: tri.molecules, read: tri.reads,
                 qs: tri.ql_sum, qn: tri.ql_n, scoped: false };
      }
      const shown = shownSampleNames();
      const idx = tps.samples.map(function (nm, i) {
        return shown.indexOf(nm) >= 0 ? i : -1;
      }).filter(function (i) { return i >= 0; });
      if (idx.length === tps.samples.length) {
        return { tri: tri, mol: tri.molecules, read: tri.reads,
                 qs: tri.ql_sum, qn: tri.ql_n, scoped: false };
      }
      if (!idx.length) {
        return { tri: tri, mol: null, read: null, qs: null, qn: null, scoped: true };
      }
      if (idx.length === 1) {
        const i = idx[0];
        return { tri: tri, mol: tps.molecules[i], read: tps.reads[i],
                 qs: tps.ql_sum ? tps.ql_sum[i] : null,
                 qn: tps.ql_n ? tps.ql_n[i] : null, scoped: true };
      }
      const n = tri.molecules.length;
      const mol = new Float64Array(n), read = new Float64Array(n);
      const qs = tps.ql_sum ? new Float64Array(n) : null;
      const qn = tps.ql_n ? new Float64Array(n) : null;
      for (const i of idx) {
        const m = tps.molecules[i], r = tps.reads[i];
        for (let k = 0; k < n; k++) { mol[k] += m[k]; read[k] += r[k]; }
        if (qs) {
          const a1 = tps.ql_sum[i], a2 = tps.ql_n[i];
          for (let k = 0; k < n; k++) { qs[k] += a1[k]; qn[k] += a2[k]; }
        }
      }
      return { tri: tri, mol: mol, read: read, qs: qs, qn: qn, scoped: true };
    }

    const out = el("div");
    const inputs = {};

    function hitAxis(v, want) {
      return cubeQ.mode === "exact" ? v === want : v >= want;
    }

    function count() {
      const sl = slice();
      if (!sl || !sl.mol) {
        return { m: 0, r: 0, meanLen: null, lenN: 0, total: 0 };
      }
      const tri = sl.tri, mol = sl.mol, read = sl.read;
      const qs = sl.qs, qn = sl.qn;
      let m = 0, r = 0, ql = 0, qln = 0, total = 0;
      for (let k = 0; k < tri.tc.length; k++) {
        const v = mol[k];
        total += v;
        if (!hitAxis(tri.tc[k], cubeQ.tc)) continue;
        if (!hitAxis(tri.ic[k], cubeQ.ic)) continue;
        if (!hitAxis(tri.fc[k], cubeQ.fc)) continue;
        m += v;
        r += read[k];
        if (qs && qn) { ql += qs[k]; qln += qn[k]; }
      }
      return { m: m, r: r, total: total,
               meanLen: qln ? ql / qln : null, lenN: qln };
    }

    function draw() {
      clear(out);
      const res = count();
      const scopedTotal = res.total;
      const box = el("div");
      const lenTile = res.meanLen == null ? null : {
        label: "Mean length", value: F.int(Math.round(res.meanLen)) + " bp",
        sub: res.lenN < res.m
          ? F.compact(res.lenN) + " of these have a length"
          : "over the matching molecules",
        help: "Mean reconstructed length of the molecules matching this filter. "
          + "A mean rather than a median: the explorer sums cells of a joint "
          + "distribution, and a mean is exact over any set of cells while a "
          + "median cannot be recovered from one.",
      };
      U.tiles(box, [
        { label: "Molecules matching", value: F.compact(res.m, 2), tone: "brand",
          sub: F.pctOf(res.m, scopedTotal, 2) + " of all molecules"
            + (IV.stateApi.allSamplesOn() ? "" : " in the selected samples") },
        { label: "Reads in those molecules", value: F.compact(res.r, 2),
          sub: F.dec(res.m ? res.r / res.m : 0, 2) + " per molecule" },
        lenTile,
      ].filter(Boolean));
      out.appendChild(box);

      out.appendChild(ternaryCard());
    }

    const row = el("div", { class: "control-row" });
    row.appendChild(U.control("Match", U.seg([
      { label: "At least", value: "atleast",
        help: "Molecules with at least this many of each read type." },
      { label: "Exactly", value: "exact",
        help: "Molecules with exactly this combination of read counts." },
    ], cubeQ.mode, function (v) { cubeQ.mode = v; rebuild(); }, { label: "Match mode" })));

    const triMax = (cube.triples && cube.triples.max) || {};
    const axMax = Math.max(triMax.tc || 0, triMax.ic || 0, triMax.fc || 0, cap);
    for (const spec of [["tc", "3′"], ["ic", "Internal"], ["fc", "5′"]]) {
      const inp = el("input", { type: "number", min: 0, max: axMax, step: 1,
        value: cubeQ[spec[0]], style: { width: "72px" } });
      inp.addEventListener("change", function () {
        const v = Math.max(0, Math.min(axMax, parseInt(inp.value, 10) || 0));
        cubeQ[spec[0]] = v;
        inp.value = v;
        draw();
      });
      inputs[spec[0]] = inp;
      row.appendChild(U.control(spec[1], inp));
    }
    row.appendChild(el("button", { class: "btn", text: "Reset",
      onclick: function () { cubeQ.tc = cubeQ.ic = cubeQ.fc = 0; rebuild(); } }));

    function ternaryCard() {
      const tri = cube.triples;
      const hit = hitAxis;
      const items = [];
      let shown = 0, noReads = 0, maxV = 1;
      if (tri && tri.tc) {
        for (let k = 0; k < tri.tc.length; k++) {
          const tc = tri.tc[k], ic = tri.ic[k], fc = tri.fc[k];
          const v = tri.molecules[k];
          if (!v) continue;
          if (!hit(tc, cubeQ.tc) || !hit(ic, cubeQ.ic) || !hit(fc, cubeQ.fc)) continue;
          const tot = tc + ic + fc;
          if (!tot) { noReads += v; continue; }
          shown += v;
          if (v > maxV) maxV = v;
          const rd = tri.reads ? tri.reads[k] : 0;
          items.push({
            a: tc, b: ic, c: fc, value: v,
            hover: IV.chart.tipHTML("Read composition", [
              ["3′ reads", F.int(tc) + "  (" + F.pct(tc / tot, 0) + ")"],
              ["Internal reads", F.int(ic) + "  (" + F.pct(ic / tot, 0) + ")"],
              ["5′ reads", F.int(fc) + "  (" + F.pct(fc / tot, 0) + ")"],
              { head: "Molecules with this composition" },
              ["Molecules", F.int(v)],
              ["Reads per molecule", F.int(tot)],
              ["Reads in total", F.int(rd)],
            ]),
          });
        }
      }
      const c2 = U.card("Read composition per molecule", {
        note: "Each point is one combination of 3′, internal and 5′ read counts. "
          + "Position is the mix, area and colour are how many molecules share it.",
      });
      const holder = el("div", { class: "chart" });
      const res2 = IV.chart.ternary(holder, {
        items: items,
        corners: ["3′ only", "Internal only", "5′ only"],
      }, { height: 420, colorAt: IV.pal.sequential });
      c2.appendChild(holder);
      IV.chart.colorBar(c2, {
        title: "Molecules sharing a combination",
        colorAt: function (t) { return IV.pal.sequential(0.15 + 0.85 * t); },
        ticks: [{ at: 0, label: "1" }, { at: 1, label: F.compact(maxV, 0) }],
      });
      const foot = [F.int(shown) + " molecules across " + F.int(res2.drawn)
        + " combinations"];
      if (tri && tri.max) {
        foot.push("up to " + F.int(Math.max(tri.max.tc, tri.max.ic, tri.max.fc))
          + " reads on one axis");
      }
      if (noReads > 0) {
        foot.push(F.int(noReads) + " with no reads on any axis, which have no "
          + "position on the triangle");
      }
      if (tri && tri.dropped_molecules > 0) {
        foot.push(F.int(tri.dropped_molecules) + " in combinations beyond the "
          + F.int(tri.tc.length) + " busiest, which are not shipped");
      }
      c2.appendChild(el("p", { class: "note small", text: foot.join(" · ") + "." }));
      return c2;
    }

    let ctrl = row;
    c.appendChild(ctrl);
    c.appendChild(out);
    function rebuild() {
      for (const k in inputs) inputs[k].value = cubeQ[k];
      draw();
    }
    draw();
    return c;
  }

  const NOVEL_TONE = {
    full_splice_match: "resolved",
    incomplete_splice_match: "resolved",
    mono_exon_match: "resolved",
    novel_in_catalog: "ambiguous",
    novel_not_in_catalog: "ambiguous",
    genic: "inconsistent",
    genic_intron: "inconsistent",
    antisense: "inconsistent",
    fusion: "inconsistent",
    intergenic: "none",
  };
  const NOVEL_HELP = {
    full_splice_match: "Same intron chain as a reference transcript.",
    incomplete_splice_match: "A contiguous subset of a reference intron chain - " +
      "consistent with the annotation but truncated.",
    mono_exon_match: "Single-exon model matching a single-exon reference transcript.",
    novel_in_catalog: "New combination of splice sites that all exist in the " +
      "annotation. The most credible novelty class.",
    novel_not_in_catalog: "Introduces at least one splice site absent from the " +
      "annotation. Genuine discovery or misalignment - check junction canonicity.",
    genic: "Overlaps a gene without matching its splice structure.",
    genic_intron: "Falls entirely inside an intron.",
    antisense: "On the opposite strand to an overlapping gene.",
    fusion: "Spans two annotated genes.",
    intergenic: "No overlap with any annotated gene. Often unannotated " +
      "transcription, but also where intra-priming artefacts collect.",
  };

  function novelModelCards(core) {
    const q = core.sqanti;
    if (!q || !q.n || IV.state.mode !== "disc") return null;
    const wrap = el("div");

    const total = q.categories.counts.reduce(function (a, b) { return a + b; }, 0);
    const cat = U.card("Structural classification of novel transcript models", {
      note: "SQANTI's verdict on how each model's structure relates to the "
        + "annotation, restricted to the " + F.int(q.n)
        + " novel transcript models.",
    });
    const holder = el("div");
    const catOrder = q.categories.values
      .map(function (v, i) { return i; })
      .sort(function (x, y) {
        return String(q.categories.labels[x])
          .localeCompare(String(q.categories.labels[y]));
      });
    IV.chart.barsH(holder, catOrder.map(function (i) {
      const v = q.categories.values[i];
      return {
        label: q.categories.labels[i], value: q.categories.counts[i],
        color: IV.sqanti.categoryColor(v,
          IV.pal.familyColor(NOVEL_TONE[v] || "none")),
        help: NOVEL_HELP[v],
      };
    }), { valueLabel: "Transcript models", total: total, labelW: 208 });
    cat.appendChild(holder);
    cat.appendChild(U.tableBehind(
      ["Category", "Transcript models", "Share"],
      catOrder.map(function (i) {
        return [q.categories.labels[i], F.int(q.categories.counts[i]),
                F.pctOf(q.categories.counts[i], total, 2)];
      })));
    wrap.appendChild(cat);

    const ev = q.events || {};
    const keys = Object.keys(ev);
    if (keys.length) {
      const evc = U.card("Structural events in the novel models", {
        note: "The specific differences from the annotation, across the "
          + F.int(q.n) + " novel transcript models. One model can carry several "
          + "events, so these sum to more than " + F.int(q.n) + ".",
      });
      const evKeys = keys.slice().sort(function (a, b) {
        return F.pretty(a).localeCompare(F.pretty(b));
      });
      const eh = el("div");
      IV.chart.barsH(eh, evKeys.map(function (k, i) {
        return { label: F.pretty(k), value: ev[k],
                 color: IV.pal.sequential(0.85 - 0.55 * i / evKeys.length) };
      }), { valueLabel: "Transcript models mentioning the event",
            labelW: 236, rowH: 17 });
      evc.appendChild(eh);
      evc.appendChild(U.tableBehind(["Event", "Transcript models"],
        evKeys.map(function (k) { return [F.pretty(k), F.int(ev[k])]; })));
      wrap.appendChild(evc);
    }
    return wrap;
  }

  function endSupportCard(core) {
    const a = core.assignment;
    const e = a && a.ends;
    if (!e || !e.values || !e.values.length) return el("div");
    const c = U.card("End-support composition", {
      note: "Which ends of a molecule carry reads: <strong>3′</strong>, "
        + "<strong>5′</strong>, and <strong>Internal</strong>.",
    });

    const wKey = IV.state.weight === "read" ? "reads" : "molecules";
    const keys = [], labels = {}, colors = {};
    e.values.forEach(function (k, x) {
      if (!((e[wKey] || e.molecules || [])[x] > 0)) return;
      keys.push(k);
      labels[k] = e.labels[x];
      colors[k] = IV.pal.endColor(k);
    });
    if (!keys.length) return el("div");
    const at = {};
    e.values.forEach(function (k, x) { at[k] = x; });

    const act = IV.stateApi.activeIdx();
    const ps = e.per_sample || {};
    const groups = [];
    const runVals = {};
    keys.forEach(function (k) { runVals[k] = 0; });
    let anyPerSample = false;
    for (const si of act) {
      const sname = core.samples[si];
      const row = ps[sname];
      if (!row || !row[wKey]) continue;
      anyPerSample = true;
      const vals = {};
      keys.forEach(function (k) {
        vals[k] = row[wKey][at[k]] || 0;
        runVals[k] += vals[k];
      });
      groups.push({ label: sname, values: vals });
    }
    if (!anyPerSample) {
      keys.forEach(function (k) { runVals[k] = (e[wKey] || [])[at[k]] || 0; });
    }
    const all = groups.length ? groups : [{ label: "Run", values: runVals }];

    const holder = el("div");
    IV.chart.stackGroups(holder, all, keys, {
      labels: labels, colors: colors,
      labelW: 130, height: 20,
      valueLabel: wKey === "reads" ? "Reads" : "Molecules",
    });
    c.appendChild(holder);
    c.appendChild(U.tableBehind(
      ["End support"].concat(all.map(function (g) { return g.label; })),
      keys.map(function (k) {
        return [labels[k]].concat(all.map(function (g) {
          return F.int(g.values[k] || 0);
        }));
      })));
    return c;
  }

  const rpmView = { pop: "all" };

  function readsPerMoleculeCard(core, a) {
    const r = a.reads_per_molecule;
    if (!r || !r.counts || !r.counts.length) return el("div");

    const c = U.card("Reads per molecule");
    IV.plots.controls(c, { groups: [{
      label: "Molecules", value: rpmView.pop,
      options: [
        { label: "All", value: "all",
          help: "Every reconstructed molecule." },
        { label: "Full-length", value: "fl",
          help: "Molecules with at least one 3′ and one 5′ read observed." },
      ],
      onChange: function (v) { rpmView.pop = v; draw(); },
    }] });

    const holder = el("div", { class: "chart" });
    c.appendChild(holder);
    const foot = el("p", { class: "note small", style: { marginTop: "8px" } });
    c.appendChild(foot);

    function draw() {
      const key = rpmView.pop === "fl" ? "fl" : "all";
      const payloadSamples = r.samples || [];
      const shown = shownSampleNames();
      const use = shown.filter(function (sm) { return payloadSamples.indexOf(sm) >= 0; });
      const perHist = r["per_sample_" + key];
      const perStats = r["per_sample_stats_" + key];
      const flHist = r.per_sample_fl;

      const series = [];
      if (use.length && perHist) {
        use.forEach(function (sm) {
          const i = payloadSamples.indexOf(sm);
          series.push({ name: sm, counts: perHist[i],
                        fl: (key === "all" && flHist) ? flHist[i] : null,
                        stats: perStats ? perStats[i] : null,
                        color: sampleColorFor(sm) });
        });
      } else {
        series.push({ name: "All molecules",
                      counts: key === "fl" ? r.counts_fl : r.counts,
                      fl: key === "all" ? r.counts_fl : null,
                      stats: { median: key === "fl" ? r.median_fl : r.median,
                               mean: key === "fl" ? r.mean_fl : r.mean,
                               max: key === "fl" ? r.max_fl : r.max,
                               n: null },
                      color: IV.dom.token("--brand") });
      }
      const usable = series.filter(function (sr) { return sr.counts && sr.counts.length; });
      if (!usable.length) {
        clear(holder);
        holder.appendChild(el("div", { class: "empty",
          text: "No read counts for this selection." }));
        foot.textContent = "";
        return;
      }

      const folded = usable.map(function (sr) {
        return IV.plots.logFold(sr.counts, { first: 1, exact: 50 });
      });
      const foldedFl = usable.map(function (sr) {
        return sr.fl ? IV.plots.logFold(sr.fl, { first: 1, exact: 50 }) : null;
      });

      let drew = false;
      if (IV.px && IV.px.available()) {
        const traces = usable.map(function (sr, si) {
          const bins = folded[si];
          const tot = bins.reduce(function (x, b) { return x + b.n; }, 0) || 1;
          const flb = foldedFl[si];
          return {
            type: "scatter", mode: "lines", name: sr.name,
            x: bins.map(function (b) { return b.lo; }),
            y: bins.map(function (b) { return 100 * b.n / tot; }),
            line: { color: sr.color, width: 2 },
            hovertext: bins.map(function (b, bi) {
              const lab = b.lo === b.hi ? String(b.lo) : (b.lo + "–" + b.hi);
              const fl = (flb && flb[bi] && flb[bi].lo === b.lo) ? flb[bi].n : null;
              return "<b>" + F.escapeHtml(sr.name) + "</b><br>" + lab
                + (b.lo === 1 && b.hi === 1 ? " read" : " reads")
                + "<br>Molecules: " + F.int(b.n)
                + "<br>Share: " + F.pctOf(b.n, tot, 2)
                + (fl == null ? ""
                    : "<br>Full-length: " + F.int(fl)
                      + (b.n ? " (" + F.pctOf(fl, b.n, 0) + ")" : ""));
            }),
            hoverinfo: "text",
            hovertemplate: "%{hovertext}<extra></extra>",
          };
        });
        drew = IV.px.draw(holder, traces, {
          height: 260,
          xTitle: "Reads per molecule",
          yTitle: "% of molecules",
          xaxis: { type: "log" },
          exportName: "reads-per-molecule",
        });
      }
      if (!drew) {
        const bins = folded[0];
        const tot = bins.reduce(function (x, b) { return x + b.n; }, 0) || 1;
        IV.chart.barsH(holder, bins.map(function (b, i) {
          return { label: b.lo === b.hi ? String(b.lo) : (b.lo + "–" + b.hi),
                   value: b.n,
                   color: IV.pal.sequential(0.25 + 0.6 * i / bins.length) };
        }), { valueLabel: "Molecules", labelW: 84, rowH: 13, total: tot });
      }

      foot.innerHTML = usable.map(function (sr) {
        const st = sr.stats || {};
        return '<span style="color:' + sr.color + '">●</span> '
          + F.escapeHtml(sr.name) + " median <strong>" + F.int(st.median || 0)
          + "</strong> · mean <strong>" + F.dec(st.mean || 0, 2)
          + "</strong> · max <strong>" + F.int(st.max || 0) + "</strong>"
          + (st.n == null ? "" : " · " + F.compact(st.n) + " molecules");
      }).join(" &nbsp;·&nbsp; ");
    }
    draw();
    return c;
  }

  function adaptationCard(core, a) {
    const ad = a.adaptation;
    const c = U.card("Molecule annotations for IsoQuant", {
      note: "What each molecule carries. <strong>Gap</strong>: the span between "
        + "mates was never sequenced, so it is filled in from the annotation. "
        + "<strong>PolyA</strong>: a 3′ tail is filled in on molecules that have "
        + "3′ read support.",
    });
    const wKey = IV.state.weight === "read" ? "reads" : "molecules";
    const vals = ad[wKey];
    const total = vals.reduce(function (x, y) { return x + y; }, 0);
    const ADCOL = { none: "--as-none", polya: "--seq-400", gap: "--seq-600",
                    "gap+polya": "--seq-800" };
    const holder = el("div");
    const ADLABEL = { none: "Neither", polya: "PolyA", gap: "Gap",
                      "gap+polya": "Gap + PolyA" };
    IV.chart.barsH(holder, ad.values.map(function (v, i) {
      return { label: ADLABEL[v] || F.pretty(v), value: vals[i],
               color: IV.dom.token(ADCOL[v] || "--seq-500") };
    }), { valueLabel: IV.stateApi.weightLabelCap(), total: total, labelW: 120 });
    c.appendChild(holder);

    return c;
  }

  const OUTCOME_LABEL = {
    "Attached to one model": "Matched to one model",
    "Compatible with several models": "Matched to several models",
    "Not attached to any model": "Matched to no model",
  };
  function outcomeLabel(l) { return OUTCOME_LABEL[l] || l; }

  function discoveryCard(core, geneMatches) {
    const da = core.discovery_assignment;
    const wrap = el("div");
    const wKey = IV.state.weight === "read" ? "reads" : "molecules";
    const flSuffix = IV.state.universe === "fl" ? "_fl" : "";
    const vals = da.outcome[wKey + flSuffix] || da.outcome[wKey];
    const attached = (function () {
      const v = da.outcome.values || [];
      let n = 0;
      for (let i = 0; i < v.length; i++) {
        if (v[i] !== "unattached") n += vals[i];
      }
      return n;
    })();

    const c = U.card("Molecules matched to transcript models", {
      note: "Every molecule, against the de-novo transcript models.",
    });
    const colors = [IV.pal.familyColor("resolved"), IV.pal.familyColor("ambiguous"),
                    IV.pal.familyColor("none")];
    const holder = el("div");
    IV.chart.stackBar(holder, da.outcome.values.map(function (v, i) {
      return { label: outcomeLabel(da.outcome.labels[i]), value: vals[i],
               color: colors[i] };
    }), { height: 28, valueLabel: IV.stateApi.weightLabelCap() });
    c.appendChild(holder);
    if (geneMatches) {
      c.appendChild(el("p", { class: "note small",
        text: "At gene-model level the same molecules give "
          + F.compact(geneMatches, 2) + " matches over " + F.compact(attached, 2)
          + " " + IV.stateApi.weightLabel() + ", "
          + F.dec(attached ? geneMatches / attached : 0, 2)
          + " each: a molecule nearly always lands on one gene model even when it "
          + "matches several transcript models inside it." }));
    }
    wrap.appendChild(c);

    const bcBase = wKey === "reads" ? "reads" : "pairs";
    const bcVals = da.by_class[bcBase + flSuffix] || da.by_class[bcBase];
    const pairTot = bcVals.reduce(function (x, y) { return x + y; }, 0);
    const c2 = U.card("Molecule to transcript-model matches, by novelty", {
      note: "Each bar counts matches to transcript models, not molecules.",
    });
    const bars = el("div");
    IV.chart.barsH(bars, da.by_class.values.map(function (k, i) {
      return { label: IV.pal.NOVEL_LABEL[k] || F.pretty(k), value: bcVals[i],
               color: IV.pal.novelColor(k) };
    }).filter(function (x) { return x.value > 0; }),
      { valueLabel: wKey === "reads" ? "Reads" : "Pairs", labelW: 200 });
    c2.appendChild(bars);
    c2.appendChild(el("p", { class: "note small",
      text: "A molecule counts under every transcript model it matches: "
        + F.compact(pairTot, 2) + " matches over " + F.compact(attached, 2)
        + " " + IV.stateApi.weightLabel() + ", "
        + F.dec(attached ? pairTot / attached : 0, 2) + " each." }));
    wrap.appendChild(c2);
    return wrap;
  }

  IV.views = IV.views || {};
  IV.views.assignment = { render: renderIsoQuant, title: "IsoQuant" };
  IV.views.qcBaseCode = { render: renderBaseCode, title: "BaseCode" };
})(window.IV);
