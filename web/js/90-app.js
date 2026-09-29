(function (IV) {
  "use strict";

  const { el, clear, byId } = IV.dom;
  const F = IV.fmt;

  const NAV = [
    { group: "Overview" },
    { id: "overview", label: "Overview", icon: "grid" },
    { group: "QC" },
    { id: "qcBaseCode", label: "BaseCode", icon: "pulse" },
    { id: "assignment", label: "IsoQuant", icon: "layers" },
    { group: "Explore" },
    { id: "genes", label: "Genes", icon: "dna" },
    { id: "transcripts", labelFrom: "featureWordPlural", icon: "list" },
    { group: "Explore samples" },
    { id: "samples", label: "Samples", icon: "bars" },
    { id: "compare", label: "Compare groups", icon: "compare" },
    { group: "About this run" },
    { id: "run", label: "Run & provenance", icon: "info" },
  ];

  const ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    layers: '<polygon points="12 3 21 8 12 13 3 8 12 3"/><polyline points="3 13 12 18 21 13"/>',
    star: '<polygon points="12 3 14.9 9 21 9.8 16.5 14 17.8 20 12 17 6.2 20 7.5 14 3 9.8 9.1 9 12 3"/>',
    dna: '<path d="M7 3c0 6 10 6 10 12M17 3c0 6-10 6-10 12"/><path d="M7 21c0-2 10-2 10 0"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    bars: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    compare: '<path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-8.5 8.5"/><path d="M3 21l8.5-8.5"/>',
  };

  let history = [];
  let renderToken = 0;

  function buildNav() {
    const nav = byId("nav");
    clear(nav);
    for (const item of NAV) {
      if (item.group) {
        nav.appendChild(el("div", { class: "nav-group", text: item.group }));
        continue;
      }
      if (item.modeOnly && item.modeOnly !== IV.state.mode) continue;
      const label = item.labelFrom
        ? F.pretty(IV.stateApi.modeInfo()[item.labelFrom])
        : item.label;
      const btn = el("button", {
        class: "nav-item", "data-view": item.id, type: "button",
        "aria-current": IV.state.view === item.id ? "page" : null,
      });
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + ICONS[item.icon] + "</svg>";
      btn.appendChild(document.createTextNode(label));
      const count = navCount(item.id);
      if (count) btn.appendChild(el("span", { class: "nav-count", text: count }));
      btn.addEventListener("click", function () { go(item.id); });
      nav.appendChild(btn);
    }
    if (IV.tour) {
      const t = el("button", { class: "nav-tour", type: "button",
        title: "Walk through what this report shows" });
      t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.3'
        + 'c-.7.4-1.1 1-1.1 1.8"/><line x1="12" y1="17" x2="12" y2="17"/></svg>';
      t.appendChild(document.createTextNode("Quick start"));
      t.addEventListener("click", function () { IV.tour.start(); });
      nav.appendChild(t);
    }
  }

  function navCount(id) {
    const core = IV.state.core;
    const uni = core.universe[IV.state.mode];
    if (id === "genes") {
      return F.compact(IV.state.mode === "ref" ? uni.detected_genes : uni.model_genes, 1);
    }
    if (id === "transcripts") {
      return F.compact(IV.state.mode === "ref"
        ? (uni.detected_transcripts != null
            ? uni.detected_transcripts
            : core.modes.ref.n_transcripts_detected)
        : uni.models, 1);
    }
    if (id === "samples") return String(core.samples.length);
    return null;
  }

  const scrollPos = Object.create(null);
  let ownEntries = 0;

  let writingHash = false;

  const canRoute = (function () {
    try {
      return typeof location === "object" && location !== null
        && typeof location.hash === "string"
        && typeof window !== "undefined"
        && typeof window.addEventListener === "function";
    } catch (e) { return false; }
  })();

  function routeKey(mode, id, arg) {
    if (id === "gene" && arg && arg.index != null) {
      return "#" + mode + "/gene=" + arg.index;
    }
    return "#" + mode + "/" + id;
  }

  function parseRoute(h) {
    const raw = String(h || "").replace(/^#/, "");
    if (!raw) return null;
    const parts = raw.split("/");
    const mode = parts.length > 1 ? parts[0] : null;
    const tail = parts.length > 1 ? parts[1] : parts[0];
    if (tail.indexOf("gene=") === 0) {
      const idx = parseInt(tail.slice(5), 10);
      if (!isFinite(idx)) return null;
      return { mode: mode, id: "gene", arg: { index: idx } };
    }
    return { mode: mode, id: tail, arg: null };
  }

  function saveScroll() {
    if (!canRoute) return;
    const c = byId("content");
    if (c) scrollPos[location.hash || ""] = c.scrollTop || 0;
  }

  function restoreScroll() {
    if (!canRoute) return;
    const c = byId("content");
    if (!c) return;
    if (typeof requestAnimationFrame !== "function") { c.scrollTop = 0; return; }
    const y = scrollPos[location.hash || ""] || 0;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { c.scrollTop = y; });
    });
  }

  async function applyRoute() {
    if (!canRoute) return false;
    const r = parseRoute(location.hash);
    if (!r) return false;
    const view = IV.views[r.id];
    if (!view) return false;
    if (r.mode && r.mode !== IV.state.mode
        && IV.stateApi.MODES[r.mode]) {
      IV.state.mode = r.mode;
    }
    if (view.modeOnly && view.modeOnly !== IV.state.mode) {
      IV.state.mode = view.modeOnly;
    }
    IV.state.view = r.id;
    IV.state.viewArg = r.arg;
    if (r.id === "gene" && r.arg && r.arg.index != null) {
      IV.state.openGene = { mode: IV.state.mode, index: r.arg.index };
    }
    buildHeader();
    buildNav();
    await renderView();
    restoreScroll();
    return true;
  }

  function installRouting() {
    if (!canRoute) return;
    const c = byId("content");
    if (c) {
      let t = null;
      c.addEventListener("scroll", function () {
        if (t) clearTimeout(t);
        t = setTimeout(saveScroll, 120);
      }, { passive: true });
    }
    window.addEventListener("hashchange", function () {
      if (writingHash) return;
      if (ownEntries > 0) ownEntries--;
      applyRoute();
    });
  }

  async function go(id, arg) {
    const view = IV.views[id];
    if (!view) return;
    if (view.modeOnly && view.modeOnly !== IV.state.mode) {
      IV.stateApi.setMode(view.modeOnly);
    }
    if (IV.state.view !== id) history.push(IV.state.view);
    IV.state.view = id;
    IV.state.viewArg = arg || null;
    buildNav();
    buildHeader();
    await renderView();
    byId("content").scrollTop = 0;
    if (!canRoute) return;
    const key = routeKey(IV.state.mode, id, arg);
    if (location.hash !== key) {
      writingHash = true;
      location.hash = key;
      writingHash = false;
      ownEntries++;
    }
  }

  async function back() {
    if (canRoute && window.history && ownEntries > 0 && location.hash) {
      ownEntries--;
      window.history.back();
      return;
    }
    let prev = history.pop();
    while (prev === "gene" && history.length) prev = history.pop();
    IV.state.view = prev && IV.views[prev] && prev !== "gene" ? prev : "genes";
    IV.state.viewArg = null;
    buildNav();
    await renderView();
  }

  async function openGene(index, opts) {
    const o = opts || {};
    if (o.mode && o.mode !== IV.state.mode) {
      IV.state.mode = o.mode;
      buildHeader();
      buildNav();
    }
    const mode = IV.state.mode;
    try {
      const u = await IV.stateApi.universe(mode);
      const id = IV.blocks.cell(u.genes.col("id"), index);
      const name = IV.blocks.cell(u.genes.col("name"), index) || id;
      IV.stateApi.pushGeneTab(mode, index, id, name);
    } catch (e) { }
    IV.state.openGene = { mode: mode, index: index };
    if (o.noPush && IV.state.view === "gene") {
      IV.state.viewArg = { index: index, focusTx: o.focusTx };
      await renderView();
      byId("content").scrollTop = 0;
      return;
    }
    await go("gene", { index: index, focusTx: o.focusTx });
  }

  async function renderView() {
    const token = ++renderToken;
    const id = IV.state.view;
    const view = IV.views[id];
    if (!view) return;
    const host = byId("content");
    const titleEl = byId("page-title");
    const vTitle = typeof view.title === "function" ? view.title() : view.title;
    titleEl.textContent = vTitle || "";
    titleEl.style.display = vTitle ? "" : "none";
    const shell = el("div", { class: "view active" });
    try {
      await view.render(shell, IV.state.viewArg);
    } catch (err) {
      console.error(err);
      clear(shell);
      shell.appendChild(el("div", { class: "card" }, [
        el("h2", { text: "This view could not be rendered" }),
        el("p", { class: "note", text: String(err && err.message || err) }),
        el("pre", { class: "raw", text: String(err && err.stack || "") }),
      ]));
    }
    if (token !== renderToken) return;
    if (IV.px) IV.px.purge(host);
    clear(host);
    host.appendChild(shell);
  }

  function rerender() { renderView(); }

  function buildHeader() {
    const S = IV.stateApi;
    const hdr = byId("header-controls");
    clear(hdr);

    const modeSeg = IV.ui.seg([
      { label: S.MODES.ref.label, value: "ref",
        help: S.MODES.ref.blurb + "\n\n" + S.MODES.ref.detail },
      { label: S.MODES.disc.label, value: "disc",
        help: S.MODES.disc.blurb },
    ], IV.state.mode, function (v) { S.setMode(v); }, { label: "Mode" });
    hdr.appendChild(IV.ui.control("Mode", modeSeg));

    hdr.appendChild(IV.ui.control("Stringency", IV.ui.seg(
      ["exploratory", "standard", "strict"].map(function (k) {
        const s = S.STRINGENCY[k];
        return {
          label: s.label, value: k,
          help: s.help() + (s.min > 0
            ? "\n\nThe threshold is applied consistently across every section "
              + "of the report."
            : ""),
        };
      }), IV.state.stringency, function (v) { S.setStringency(v); },
      { label: "Stringency" })));

    if (IV.state.samples.length > 1) {
      hdr.appendChild(IV.ui.control("Samples", IV.sampleSelect.headerControl()));
    }

    hdr.appendChild(el("span", { class: "header-spacer" }));
    hdr.appendChild(searchBox());
    hdr.appendChild(themeButton());
  }

  function themeButton() {
    const b = el("button", { class: "btn btn-sm", type: "button",
      title: "Switch between automatic, light and dark" });
    function label() {
      b.textContent = IV.state.theme === "auto" ? "◐ Auto"
        : IV.state.theme === "light" ? "☀ Light" : "☾ Dark";
    }
    label();
    b.addEventListener("click", function () {
      IV.stateApi.cycleTheme();
      label();
      renderView();
    });
    return b;
  }

  function searchBox() {
    const wrap = el("div", { id: "search-wrap" });
    wrap.innerHTML = '<svg class="s-icon" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/>'
      + '<line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const input = el("input", { type: "search", id: "search-input",
      placeholder: "Search genes and "
        + IV.stateApi.modeInfo().featureWordPlural + "…",
      autocomplete: "off",
      "aria-label": "Search genes and "
        + IV.stateApi.modeInfo().featureWordPlural });
    const results = el("div", { id: "search-results" });
    wrap.appendChild(input);
    wrap.appendChild(results);

    let index = null;
    async function buildIndex() {
      const u = await IV.stateApi.universe();
      const g = u.genes, t = u.tx;
      const gid = g.col("id"), gname = g.col("name");
      const tid = t.col("id"), tname = t.col("name"), tg = t.col("gene_idx");
      const entries = [];
      for (let i = 0; i < g.n; i++) {
        entries.push({ kind: "g", i: i, name: IV.blocks.cell(gname, i),
          id: IV.blocks.cell(gid, i) });
      }
      for (let i = 0; i < t.n; i++) {
        entries.push({ kind: "t", i: i, gi: tg[i], name: IV.blocks.cell(tname, i),
          id: IV.blocks.cell(tid, i) });
      }
      index = entries;
      return entries;
    }

    const run = IV.dom.debounce(async function () {
      const q = input.value.trim().toUpperCase();
      clear(results);
      if (q.length < 2) { results.classList.remove("open"); return; }
      const entries = index || await buildIndex();
      const hits = [];
      for (const e of entries) {
        const nm = e.name.toUpperCase(), id = e.id.toUpperCase();
        let score = -1;
        if (nm === q || id === q || F.stripVersion(id).toUpperCase() === q) score = 0;
        else if (nm.indexOf(q) === 0) score = 1;
        else if (id.indexOf(q) === 0) score = 2;
        else if (nm.indexOf(q) > 0) score = 3;
        else if (id.indexOf(q) > 0) score = 4;
        if (score >= 0) { hits.push([score, e]); if (hits.length > 400) break; }
      }
      hits.sort(function (a, b) {
        return a[0] - b[0] || (a[1].kind === "g" ? -1 : 1);
      });
      if (!hits.length) {
        results.appendChild(el("div", { class: "sr-empty",
          text: "Nothing matches in " + IV.stateApi.modeInfo().long }));
      }
      for (const [, e] of hits.slice(0, 30)) {
        const item = el("div", { class: "sr-item" }, [
          el("span", { text: e.name }),
          el("span", { class: "sr-id", text: F.stripVersion(e.id) }),
          el("span", { class: "sr-meta", text: e.kind === "g" ? "gene" : "transcript" }),
        ]);
        item.addEventListener("mousedown", function () {
          input.value = "";
          results.classList.remove("open");
          openGene(e.kind === "g" ? e.i : e.gi,
            e.kind === "t" ? { focusTx: e.i } : {});
        });
        results.appendChild(item);
      }
      results.classList.add("open");
    }, 130);

    input.addEventListener("input", run);
    input.addEventListener("focus", run);
    input.addEventListener("blur", function () {
      setTimeout(function () { results.classList.remove("open"); }, 160);
    });
    IV.stateApi.on(function (what) { if (what === "mode") index = null; });
    return wrap;
  }

  const ISO_W = 300;
  const GENE_EXONS = [[2, 11], [20, 7], [34, 9], [50, 6], [62, 13], [82, 8]];
  const ISOFORMS = [
    { exons: [0, 1, 2, 3, 4, 5], step: 420, hold: 1400 },
    { exons: [0, 1, 3, 4, 5], step: 480, hold: 1100 },
    { exons: [0, 2, 3, 4], step: 540, hold: 1700 },
  ];

  function px(pct) { return pct / 100 * ISO_W; }

  function buildIsoAnimation() {
    const rowsHost = byId("boot-iso-rows");
    if (!rowsHost || rowsHost.childNodes.length) return;

    const reduced = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const rows = ISOFORMS.map(function (iso) {
      const row = el("div", { class: "iso-row" });
      const cursor = el("div", { class: "iso-cursor" });
      const exonEls = iso.exons.map(function (gi) {
        const [x, w] = GENE_EXONS[gi];
        const node = el("div", { class: "iso-ex",
          style: { left: px(x) + "px", width: Math.max(3, px(w)) + "px" } });
        row.appendChild(node);
        return { node: node, x: x, w: w };
      });
      row.appendChild(cursor);
      rowsHost.appendChild(row);
      return { exonEls: exonEls, cursor: cursor, step: iso.step, hold: iso.hold };
    });

    if (reduced) {
      for (const r of rows) {
        for (const e of r.exonEls) e.node.classList.add("confirmed");
      }
      return;
    }

    function runRow(r) {
      let i = 0;
      function confirmNext() {
        if (i >= r.exonEls.length) {
          bootTimers.push(setTimeout(function () {
            for (const e of r.exonEls) e.node.classList.remove("confirmed");
            r.cursor.style.opacity = "0";
            i = 0;
            bootTimers.push(setTimeout(confirmNext, r.step));
          }, r.hold));
          return;
        }
        const e = r.exonEls[i];
        r.cursor.style.left = (px(e.x) + Math.max(3, px(e.w)) / 2 - 1.5) + "px";
        r.cursor.style.opacity = "1";
        e.node.classList.add("confirmed");
        i += 1;
        bootTimers.push(setTimeout(confirmNext, r.step));
      }
      confirmNext();
    }
    rows.forEach(function (r, i) {
      bootTimers.push(setTimeout(function () { runRow(r); }, i * 260));
    });
  }

  const bootTimers = [];
  function stopIsoAnimation() {
    for (const t of bootTimers.splice(0)) clearTimeout(t);
  }

  function bootStage(text) {
    const s = byId("boot-status");
    if (s) s.textContent = text;
  }

  const MIN_BOOT_MS = 5000;

  const WAITING_MSGS = [
    "Constructing gene maps…",
    "Calculating expression…",
    "Calculating transcript usage…",
    "Preparing gene summaries…",
    "Loading gene models…",
    "Computing sample-level metrics…",
    "Calculating entropy…",
    "Calculating divergence…",
  ];
  let waitTimer = null;

  function bootWaiting(everyMs) {
    let i = -1;
    stopWaiting();
    const step = everyMs || 1400;
    bootStage(WAITING_MSGS[0]);
    i = 0;
    waitTimer = setInterval(function () {
      i += 1;
      bootStage(i < WAITING_MSGS.length ? WAITING_MSGS[i] : "Almost there…");
    }, step);
  }
  function stopWaiting() {
    if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
  }

  async function boot() {
    IV.stateApi.initTheme();
    const boot = byId("boot");
    const status = byId("boot-status");
    const t0 = Date.now();
    buildIsoAnimation();

    try {
      const core = await IV.blocks.load("core");
      IV.state.core = core;
      IV.state.samples = core.samples || [];
      IV.state.sampleOn = IV.state.samples.map(function () { return true; });
      IV.state.group = IV.state.samples.map(function (_, i) {
        return IV.state.samples.length === 2 ? (i === 0 ? 1 : 2) : 0;
      });

      document.title = "IsoViewer · " + core.run.name;
      byId("foot-version").textContent = "IsoViewer v" + core.isoviewer.version;

      status.textContent = "Loading " + IV.stateApi.modeInfo().long + " …";
      bootWaiting();
      await IV.stateApi.universe("ref");
      stopWaiting();

      bootStage("Building views…");
      buildHeader();
      buildNav();
      IV.stateApi.on(function (what) {
        if (what === "mode") {
          history = [];
          if (IV.views[IV.state.view] && IV.views[IV.state.view].modeOnly
              && IV.views[IV.state.view].modeOnly !== IV.state.mode) {
            IV.state.view = "overview";
          }
          if (IV.views.compare.reset) IV.views.compare.reset();
        }
        if (what !== "samples") {
          buildHeader();
          buildNav();
        }
        renderView();
        if (what === "mode" && canRoute) {
          const k = routeKey(IV.state.mode, IV.state.view, IV.state.viewArg);
          if (location.hash !== k) {
            writingHash = true;
            location.hash = k;
            writingHash = false;
            ownEntries++;
          }
        }
      });

      installRouting();
      const routed = await applyRoute();
      if (!routed) {
        await renderView();
        if (canRoute) {
          writingHash = true;
          location.hash = routeKey(IV.state.mode, IV.state.view, IV.state.viewArg);
          writingHash = false;
        }
      }

      const held = Date.now() - t0;
      if (held < MIN_BOOT_MS) {
        bootWaiting(Math.max(400, Math.floor((MIN_BOOT_MS - held) / 4)));
        await new Promise(function (r) { setTimeout(r, MIN_BOOT_MS - held); });
        stopWaiting();
      }
      bootStage("Ready");

      boot.classList.add("done");
      setTimeout(function () {
        boot.style.display = "none";
        stopIsoAnimation();
        if (IV.tour) IV.tour.maybeStart();
      }, 600);
    } catch (err) {
      console.error(err);
      stopWaiting();
      stopIsoAnimation();
      clear(boot);
      boot.appendChild(el("div", { class: "card", style: { maxWidth: "620px" } }, [
        el("h2", { text: "IsoViewer could not open this report" }),
        el("p", { class: "note", text: String(err && err.message || err) }),
      ]));
    }
  }

  IV.app = { boot, go, back, openGene, rerender, renderView, buildNav, buildHeader };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window.IV);
