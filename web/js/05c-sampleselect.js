(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;

  function headerControl() {
    const S = IV.stateApi;
    S.ensureSampleOn();

    const wrap = el("div", { class: "pick-wrap ss-wrap" });
    const btn = el("button", { class: "btn btn-sm", type: "button" });
    const menu = el("div", { class: "pick-menu ss-menu", style: { display: "none" } });

    function label() {
      const n = S.nActive(), tot = IV.state.samples.length;
      btn.textContent = (n === tot ? "Samples · all " + tot
                                   : "Samples · " + n + " of " + tot) + " ▾";
      btn.classList.toggle("btn-accent", n !== tot);
    }

    function buildMenu() {
      clear(menu);
      menu.appendChild(el("div", { class: "pick-head",
        text: "Include in every statistic" }));

      const list = el("div", { class: "ss-list" });
      IV.state.samples.forEach(function (name, i) {
        const on = IV.state.sampleOn[i];
        const row = el("label", { class: "ss-row" + (on ? "" : " ss-off") });
        const cb = el("input", { type: "checkbox" });
        cb.checked = !!on;
        cb.addEventListener("change", function () {
          S.setSampleOn(i, cb.checked);
          cb.checked = !!IV.state.sampleOn[i];
          buildMenu();
          label();
        });
        row.appendChild(cb);
        row.appendChild(el("span", { class: "ss-dot",
          style: { background: S.sampleColor(i) } }));
        row.appendChild(el("span", { class: "ss-name", text: name }));
        list.appendChild(row);
      });
      menu.appendChild(list);

      const foot = el("div", { class: "ss-foot" });
      foot.appendChild(el("button", { class: "btn btn-xs", type: "button",
        text: "All", onclick: function () {
          S.setAllSamples(true); buildMenu(); label();
        } }));
      foot.appendChild(el("span", { style: { flex: "1" } }));
      foot.appendChild(el("button", { class: "btn btn-xs", type: "button",
        text: "More about samples →",
        onclick: function () {
          open(false);
          IV.app.go("samples");
        } }));
      menu.appendChild(foot);

      menu.appendChild(el("div", { class: "pick-note",
        html: "The selection is applied consistently across every section of "
          + "the report." }));
    }

    function open(v) {
      menu.style.display = v ? "block" : "none";
      if (v) buildMenu();
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      open(menu.style.display === "none");
    });
    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) open(false);
    });

    label();
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    IV.stateApi.on(function (what) { if (what === "samples") label(); });
    return wrap;
  }

  function chips(host, onChange) {
    const S = IV.stateApi;
    S.ensureSampleOn();
    const c = el("div", { class: "ss-chips" });

    function build() {
      clear(c);
      const tot = IV.state.samples.length;
      const n = S.nActive();
      c.appendChild(el("div", { class: "ss-chips-head",
        html: "<strong>Samples</strong> "
          + (n === tot ? "all " + tot
                       : '<span class="ss-partial">' + n + " of " + tot + "</span>") }));
      const row = el("div", { class: "ss-chip-row" });
      IV.state.samples.forEach(function (name, i) {
        const on = !!IV.state.sampleOn[i];
        const chip = el("button", { class: "ss-chip" + (on ? " ss-chip-on" : ""),
          type: "button", text: name,
          title: on ? "Click to exclude " + name : "Click to include " + name });
        if (on) chip.style.borderColor = S.sampleColor(i);
        chip.addEventListener("click", function () {
          S.setSampleOn(i, !on);
          build();
          if (onChange) onChange();
        });
        row.appendChild(chip);
      });
      c.appendChild(row);
      if (n < tot) {
        c.appendChild(el("button", { class: "btn btn-xs", type: "button",
          text: "Include all", onclick: function () {
            S.setAllSamples(true); build(); if (onChange) onChange();
          } }));
      }
    }
    build();
    host.appendChild(c);
    return c;
  }

  IV.sampleSelect = { headerControl, chips };
})(window.IV);
