(function (IV) {
  "use strict";

  const { el, clear } = IV.dom;
  const F = IV.fmt;
  const U = IV.ui;

  async function render(host) {
    clear(host);
    const core = IV.state.core;
    const r = core.run;

    host.appendChild(paramsCard(core, r));
  }

  function paramsCard(core, r) {
    const c = U.card("Run configuration");

    const p = {};
    for (const x of r.params) p[x.key] = x.value;

    const notes = [];
    if (r.annotation.collapsed) {
      notes.push("The annotation was collapsed before quantification.");
    }
    for (const n of notes) c.appendChild(U.callout(n));

    const grid = el("div", { class: "grid grid-2" });
    const left = el("dl", { class: "kv" });
    const facts = [
      ["Run name", r.name],
      ["IsoQuant version", r.isoquant_version],
      ["Pipeline version", r.pipeline_version ? "v" + r.pipeline_version : "–"],
      ["Pipeline run at", (r.pipeline_timestamp || "").replace("T", " ").slice(0, 19)],
      ["Reference genome", ((r.annotation || {}).reference_name
        || (r.annotation || {}).reference || "–").replace(/_/g, " ")],
      ["Annotation", (function () {
        const a = r.annotation || {};
        if (!a.label && !a.assembly) return a.genedb || "–";
        const bits = [];
        if (a.label) bits.push(a.label);
        if (a.assembly) bits.push(a.assembly);
        if (a.ensembl) bits.push("Ensembl " + a.ensembl);
        return bits.join(" · ");
      })()],
      ["Annotation released", (r.annotation || {}).date || "–"],

      ["IsoViewer version", core.isoviewer.version],
      ["IsoViewer run at", (core.isoviewer.built || "").replace("T", " ").slice(0, 19)],
    ];
    for (const [k, v] of facts) {
      left.appendChild(el("dt", { text: k }));
      left.appendChild(el("dd", { text: v == null ? "–" : String(v) }));
    }
    grid.appendChild(el("div", {}, left));

    c.appendChild(grid);

    if (r.command_line) {
      const d = el("details", { class: "disclose", style: { marginTop: "var(--sp-3)" } });
      d.appendChild(el("summary", { text: "Show the IsoQuant command line" }));
      d.appendChild(el("div", {}, el("pre", { class: "raw", text: r.command_line })));
      c.appendChild(d);
    }
    return c;
  }

  IV.views = IV.views || {};
  IV.views.run = { render: render, title: "Run" };
})(window.IV);
