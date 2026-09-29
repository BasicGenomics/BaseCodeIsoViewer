(function (IV) {
  "use strict";

  const { el, byId } = IV.dom;

  const SEEN_KEY = "isoviewer.tour.seen.3";

  const STEPS = [
    {
      title: "Welcome to IsoViewer",
      body: "To help you find your way around, follow this short walk through "
          + "the report.",
    },
    {
      view: "overview", anchor: "[data-control=\"Mode\"]",
      title: "Choose the mode",
      body: "Reference mode quantifies the existing annotation. Discovery mode "
          + "quantifies transcript models built from these reads. Most figures "
          + "change with it.",
    },
    {
      view: "overview", anchor: "[data-control=\"Samples\"]",
      title: "Choose the samples",
      body: "Pick the samples of interest. The selection applies to the whole "
          + "report.",
    },
    {
      view: "overview", anchor: "[data-control=\"Stringency\"]",
      title: "Set the support floor",
      body: "Stringency is a minimum number of counted molecules per gene. It "
          + "is applied consistently across the report.",
    },
    {
      view: "overview", anchor: "[data-tour=\"overview-headline\"]",
      title: "The headline figures",
      body: "How much the run produced and how much of it reached a count. "
          + "Detected and counted are different populations; hover any ⓘ for "
          + "the definition.",
    },
    {
      view: "overview", anchor: "[data-tour=\"overview-flow\"]",
      title: "Where the molecules went",
      body: "Every reconstructed molecule, followed to the point where it was "
          + "counted or dropped, with the run's totals beside each stage.",
    },
    {
      view: "genes", anchor: ".nav-item[data-view=\"genes\"]",
      title: "Gene explorer",
      body: "Everything about the genes: filter and sort them here, and open "
          + "any one of them in detail.",
      then: "openFirstGene",
    },
    {
      view: "gene", anchor: "[data-tour=\"gene-tiles\"]", mark: "genes",
      title: "One gene, in detail",
      body: "The headline figures for this gene: molecules, TPM, transcript "
          + "variants detected and how they vary between samples.",
    },
    {
      view: "gene", anchor: "[data-tour=\"gene-funnel\"]", mark: "genes",
      title: "Where its molecules went",
      body: "The same detected-to-counted path as the Overview, for this gene "
          + "alone.",
    },
    {
      view: "gene", anchor: "[data-tour=\"gene-model\"]", mark: "genes",
      title: "The gene model",
      body: "Every transcript variant drawn to scale, exon by exon, with its "
          + "molecules and TPM.",
    },
    {
      view: "transcripts", anchor: ".nav-item[data-view=\"transcripts\"]",
      title: "Transcript explorer",
      body: "The same table at transcript level.",
    },
    {
      view: "samples", anchor: ".nav-item[data-view=\"samples\"]",
      title: "Samples",
      body: "Per-sample totals, variance and correlation.",
    },
    {
      view: "compare", anchor: ".nav-item[data-view=\"compare\"]",
      title: "Compare groups",
      body: "Split the samples into two groups and compare them.",
    },
  ];

  function place(card, rect) {
    const pad = 14;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!rect) {
      card.style.top = Math.round((vh - ch) / 2) + "px";
      card.style.left = Math.round((vw - cw) / 2) + "px";
      return;
    }
    let top = rect.bottom + pad;
    if (top + ch > vh - pad) {
      const above = rect.top - pad - ch;
      top = above >= pad ? above : Math.max(pad, vh - ch - pad);
    }
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.min(Math.max(pad, left), vw - cw - pad);
    card.style.top = Math.round(top) + "px";
    card.style.left = Math.round(left) + "px";
  }

  function markIdFor(step) {
    return step.mark || null;
  }

  function markTo(mark, rect) {
    if (dead(rect)) { mark.style.display = "none"; return; }
    const m = 4;
    mark.style.display = "";
    mark.style.top = (rect.top - m) + "px";
    mark.style.left = (rect.left - m) + "px";
    mark.style.width = (rect.width + 2 * m) + "px";
    mark.style.height = (rect.height + 2 * m) + "px";
  }

  function bringIntoView(node) {
    const content = byId("content");
    if (!content || !node || !node.getBoundingClientRect) return;
    const cr = content.getBoundingClientRect();
    const nr = node.getBoundingClientRect();
    const delta = nr.height > cr.height
      ? nr.top - cr.top - 16
      : (nr.top + nr.height / 2) - (cr.top + cr.height / 2);
    content.scrollTop = content.scrollTop + delta;
  }

  function dead(rect) {
    return !rect || (!rect.width && !rect.height && !rect.top && !rect.left);
  }

  function spotTo(spot, rect) {
    if (dead(rect)) {
      spot.classList.add("no-target");
      spot.style.top = "50%"; spot.style.left = "50%";
      spot.style.width = "0px"; spot.style.height = "0px";
      return;
    }
    const m = 8;
    spot.classList.remove("no-target");
    spot.style.top = (rect.top - m) + "px";
    spot.style.left = (rect.left - m) + "px";
    spot.style.width = (rect.width + 2 * m) + "px";
    spot.style.height = (rect.height + 2 * m) + "px";
  }

  let state = null;

  function stop(keepView) {
    if (!state) return;
    const tabsBefore = state.tabsAtStart;
    window.removeEventListener("resize", state.onMove);
    window.removeEventListener("keydown", state.onKey, true);
    const content = byId("content");
    if (content) content.removeEventListener("scroll", state.onMove);
    state.spot.remove();
    state.mark.remove();
    state.card.remove();
    state = null;
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) { }
    if (!keepView) {
      IV.state.openGene = null;
      const before = tabsBefore || [];
      for (const t of (IV.state.geneTabs || []).slice()) {
        if (before.indexOf(t.mode + ":" + t.index) < 0) {
          IV.stateApi.closeGeneTab(t.mode, t.index);
        }
      }
      if (IV.state.view !== "overview") IV.app.go("overview");
    }
  }

  const ANCHOR_WAIT_MS = 2000;

  async function target(step) {
    if (step.view && step.view !== "gene" && IV.state.view !== step.view) {
      await IV.app.go(step.view);
    }
    if (!step.anchor) return null;
    const deadline = ANCHOR_WAIT_MS / 25;
    for (let i = 0; i < deadline; i++) {
      const node = document.querySelector(step.anchor);
      if (node) return node;
      if (!state) return null;
      await new Promise(function (r) { setTimeout(r, 25); });
    }
    return document.querySelector(step.anchor);
  }

  async function openFirstGene() {
    const row = document.querySelector("[data-tour=\"genes-table\"] tbody tr");
    if (row) row.click();
  }

  const AFTER = { openFirstGene: openFirstGene };

  async function show(i) {
    if (!state) return;
    if (i < 0) i = 0;
    if (i >= STEPS.length) return stop();

    const step = STEPS[i];
    let node = await target(step);
    if (!state) return;

    if (step.anchor && !node) {
      const next = i + (state.dir < 0 ? -1 : 1);
      if (next < 0 || next >= STEPS.length) return stop();
      return show(next);
    }

    state.i = i;
    if (node) bringIntoView(node);

    draw(step, node);

    if (node) {
      const token = ++state.scrollToken;
      setTimeout(function () {
        if (!state || state.scrollToken !== token || state.node !== node) return;
        bringIntoView(node);
        state.onMove();
      }, 260);
    }
    if (step.then && AFTER[step.then]) {
      state.pending = AFTER[step.then];
    } else {
      state.pending = null;
    }
  }

  function draw(step, node) {
    const rect = node ? node.getBoundingClientRect() : null;
    state.node = node;
    spotTo(state.spot, rect);

    const markId = markIdFor(step);
    const navNode = markId
      ? document.querySelector('.nav-item[data-view="' + markId + '"]')
      : null;
    state.navNode = navNode === node ? null : navNode;
    markTo(state.mark, state.navNode ? state.navNode.getBoundingClientRect() : null);

    const c = state.card;
    c.innerHTML = "";
    if (step.title) c.appendChild(el("h3", { text: step.title }));
    c.appendChild(el("p", { text: step.body }));

    const foot = el("div", { class: "tour-foot" });
    const dots = el("div", { class: "tour-dots" });
    for (let k = 0; k < STEPS.length; k++) {
      dots.appendChild(el("div", { class: "tour-dot" + (k === state.i ? " on" : "") }));
    }
    foot.appendChild(dots);
    foot.appendChild(el("span", { class: "tour-count",
      text: (state.i + 1) + " / " + STEPS.length }));
    if (state.i > 0) {
      const b = el("button", { class: "btn btn-sm", type: "button", text: "Back" });
      b.addEventListener("click", function () { state.dir = -1; show(state.i - 1); });
      foot.appendChild(b);
    }
    const nextLabel = state.i === STEPS.length - 1 ? "Done" : "Next";
    const nx = el("button", { class: "btn btn-sm btn-primary", type: "button",
      text: nextLabel });
    nx.addEventListener("click", advance);
    foot.appendChild(nx);
    const skip = el("button", { class: "tour-skip", type: "button", text: "Skip" });
    skip.addEventListener("click", function () { stop(); });
    foot.appendChild(skip);
    c.appendChild(foot);

    place(c, rect);
  }

  async function advance() {
    if (!state) return;
    state.dir = 1;
    const after = state.pending;
    state.pending = null;
    if (after) await after();
    if (!state) return;
    show(state.i + 1);
  }

  function start() {
    if (state) stop(true);
    const spot = el("div", { class: "tour-spot no-target" });
    const mark = el("div", { class: "tour-mark", style: { display: "none" } });
    const card = el("div", { class: "tour-card", role: "dialog",
      "aria-label": "IsoViewer quick start" });
    document.body.appendChild(spot);
    document.body.appendChild(mark);
    document.body.appendChild(card);

    const tabKey = function (t) { return t.mode + ":" + t.index; };
    state = { i: 0, dir: 1, spot: spot, mark: mark, card: card, node: null,
              navNode: null, pending: null, scrollToken: 0,
              tabsAtStart: (IV.state.geneTabs || []).map(tabKey) };

    state.onMove = function () {
      if (!state) return;
      const step = STEPS[state.i] || {};
      const live = step.anchor ? document.querySelector(step.anchor) : null;
      if (live) state.node = live;
      const rect = state.node ? state.node.getBoundingClientRect() : null;
      if (state.node && dead(rect)) return;
      spotTo(state.spot, rect);

      const markId = markIdFor(step);
      const liveMark = markId
        ? document.querySelector('.nav-item[data-view="' + markId + '"]')
        : null;
      if (liveMark) state.navNode = liveMark;
      markTo(state.mark, state.navNode
        ? state.navNode.getBoundingClientRect() : null);
      place(state.card, rect);
    };
    state.onKey = function (ev) {
      if (!state) return;
      if (ev.key === "Escape") { ev.stopPropagation(); stop(); }
      else if (ev.key === "ArrowRight") { ev.stopPropagation(); advance(); }
      else if (ev.key === "ArrowLeft" && state.i > 0) {
        ev.stopPropagation(); state.dir = -1; show(state.i - 1);
      }
    };
    window.addEventListener("resize", state.onMove);
    window.addEventListener("keydown", state.onKey, true);
    const content = byId("content");
    if (content) content.addEventListener("scroll", state.onMove, { passive: true });

    show(0);
  }

  function suppressed() {
    try {
      return /[?&]tour=0\b/.test(String(location.search || ""));
    } catch (e) { return false; }
  }

  function maybeStart() {
    if (suppressed()) return;
    setTimeout(function () {
      if (state) return;
      start();
    }, 400);
  }

  IV.tour = { start: start, stop: stop, maybeStart: maybeStart, STEPS: STEPS };
})(window.IV);
