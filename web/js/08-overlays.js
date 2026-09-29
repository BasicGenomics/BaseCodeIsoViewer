(function (IV) {
  "use strict";

  const { el } = IV.dom;
  const F = IV.fmt;

  const ENSEMBL = "https://rest.ensembl.org";
  const GNOMAD = "https://gnomad.broadinstitute.org/api";
  const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

  const CLINVAR_BATCH = 200;
  const CLINVAR_MAX = 600;

  const cache = {};
  const inflight = {};

  function bare(id) { return id ? String(id).split(".")[0] : id; }

  async function getJSON(url, init) {
    if (typeof fetch !== "function") throw new Error("no network in this environment");
    const r = await fetch(url, init);
    if (!r.ok) {
      throw new Error(url.replace(/^https?:\/\/([^/]+).*/, "$1") + " " + r.status);
    }
    return r.json();
  }

  function projectProtein(exons, cds, strand, p1, p2) {
    if (!cds || !exons || !exons.length) return [];
    const isMinus = strand === 1;
    const pieces = [];
    for (const ex of exons) {
      const s = Math.max(ex[0], cds[0]);
      const e = Math.min(ex[1], cds[1]);
      if (e >= s) pieces.push([s, e]);
    }
    if (!pieces.length) return [];
    pieces.sort(function (a, b) { return isMinus ? b[0] - a[0] : a[0] - b[0]; });

    const ntStart = Math.max(1, (p1 - 1) * 3 + 1);
    const ntEnd = Math.max(ntStart, p2 * 3);

    const out = [];
    let cum = 0;
    for (const pc of pieces) {
      const len = pc[1] - pc[0] + 1;
      const segStart = cum + 1, segEnd = cum + len;
      cum += len;
      const oS = Math.max(ntStart, segStart);
      const oE = Math.min(ntEnd, segEnd);
      if (oE < oS) continue;
      const offS = oS - segStart, offE = oE - segStart;
      out.push(isMinus ? [pc[1] - offE, pc[1] - offS] : [pc[0] + offS, pc[0] + offE]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out;
  }

  async function fetchDomains(ctx) {
    const wanted = ctx.rows.filter(function (r) {
      return /^ENST/.test(r.id) && r.cds && (r.exons || []).length;
    });
    if (!wanted.length) {
      return { empty: "No Ensembl (ENST) transcripts with CDS bounds in this view." };
    }
    const out = {};
    let failed = 0;
    for (const r of wanted) {
      try {
        const tx = await getJSON(ENSEMBL + "/lookup/id/" + encodeURIComponent(bare(r.id))
          + "?expand=1;content-type=application/json");
        const ensp = tx.Translation && tx.Translation.id;
        if (!ensp) continue;
        const feats = await getJSON(ENSEMBL + "/overlap/translation/"
          + encodeURIComponent(ensp) + "?feature=protein_feature;content-type=application/json");
        const mapped = [];
        for (const f of (feats || [])) {
          const segs = projectProtein(r.exons, r.cds, r.strand, f.start || 0, f.end || 0);
          if (!segs.length) continue;
          mapped.push({ type: f.type || "Other", description: f.description || "",
                        id: f.id || "", prot_start: f.start, prot_end: f.end,
                        ensp: ensp, segs: segs });
        }
        if (mapped.length) out[r.id] = { ensp: ensp, features: mapped };
      } catch (e) {
        failed++;
      }
    }
    if (!Object.keys(out).length) {
      throw new Error(failed
        ? failed + " of " + wanted.length + " Ensembl lookups failed"
        : "Ensembl returned no protein features for these transcripts");
    }
    return { domains: out, partial: failed
      ? failed + " transcript(s) could not be fetched" : null };
  }

  async function fetchGnomad(ctx) {
    const ensg = bare(ctx.geneId);
    if (!/^ENSG/.test(ensg)) {
      return { empty: "gnomAD is keyed by Ensembl gene id; this entry has none." };
    }
    const query = "query V($gid:String!){gene(gene_id:$gid,reference_genome:GRCh38)"
      + "{variants(dataset:gnomad_r4){variant_id pos ref alt consequence lof flags "
      + "exome{ac an af} genome{ac an af} in_silico_predictors{id value}}}}";
    const d = await getJSON(GNOMAD, { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: { gid: ensg } }) });
    if (d.errors && d.errors.length) {
      throw new Error("gnomAD: " + d.errors.map(function (e) { return e.message; })
        .join(" · "));
    }
    const vs = ((d.data || {}).gene || {}).variants || [];
    const rows = vs.map(function (v) {
      const src = (v.exome && v.exome.an) ? v.exome : v.genome;
      return { variant_id: v.variant_id, pos: v.pos, ref: v.ref, alt: v.alt,
               consequence: v.consequence, af: src ? src.af : null,
               ac: src ? src.ac : null,
               isp: (v.in_silico_predictors || []).reduce(function (a, p) {
                 a[p.id] = p.value; return a;
               }, {}) };
    }).filter(function (v) { return v.pos >= ctx.lo && v.pos <= ctx.hi; });
    if (!rows.length) return { empty: "gnomAD lists no variant inside this locus." };
    return { gnomad: rows };
  }

  async function fetchClinvar(ctx) {
    const sym = ctx.geneName;
    if (!sym || /^(novel_gene|ENSG|transcript)/.test(sym)) {
      return { empty: "ClinVar is searched by gene symbol; this entry has none." };
    }
    const term = sym + "[gene] AND single_gene[gene_property]";
    const search = await getJSON(EUTILS + "/esearch.fcgi?db=clinvar&retmode=json"
      + "&retmax=" + CLINVAR_MAX + "&term=" + encodeURIComponent(term));
    const ids = ((search || {}).esearchresult || {}).idlist || [];
    const total = +(((search || {}).esearchresult || {}).count || 0);
    if (!ids.length) return { empty: "ClinVar has no single-gene record for " + sym + "." };

    const rows = [];
    for (let i = 0; i < ids.length; i += CLINVAR_BATCH) {
      const batch = ids.slice(i, i + CLINVAR_BATCH);
      const sum = await getJSON(EUTILS + "/esummary.fcgi?db=clinvar&retmode=json&id="
        + batch.join(","));
      const res = (sum || {}).result || {};
      for (const uid of (res.uids || [])) {
        const r = res[uid];
        if (!r) continue;
        const loc = pickLocation(r, ctx);
        if (!loc) continue;
        rows.push({ clinvar_id: uid, pos: loc, title: r.title || r.obj_type || uid,
                    sig: ((r.germline_classification || {}).description)
                      || ((r.clinical_significance || {}).description) || "not provided",
                    condition: conditionOf(r) });
      }
    }
    if (!rows.length) {
      return { empty: "ClinVar records exist for " + sym + " but none has a GRCh38 "
        + "position inside this locus." };
    }
    return { clinvar: rows, truncated: total > ids.length
      ? total - ids.length : 0 };
  }

  function pickLocation(r, ctx) {
    const vs = r.variation_set || [];
    for (const v of vs) {
      for (const loc of (v.variation_loc || [])) {
        if (!loc || loc.assembly_name !== "GRCh38") continue;
        const p = +loc.start;
        if (isFinite(p) && p >= ctx.lo && p <= ctx.hi) return p;
      }
    }
    return null;
  }

  function conditionOf(r) {
    const t = (r.trait_set || [])[0];
    if (t && t.trait_name) return t.trait_name;
    const g = (r.germline_classification || {}).trait_set || [];
    return (g[0] && g[0].trait_name) || "–";
  }

  async function fetchRegulatory(ctx) {
    const chr = String(ctx.chr || "").replace(/^chr/i, "");
    const region = chr + ":" + Math.max(1, Math.round(ctx.lo)) + "-" + Math.round(ctx.hi);
    const sp = (IV.species && IV.species.ensemblSpecies()) || "human";
    const d = await getJSON(ENSEMBL + "/overlap/region/" + encodeURIComponent(sp)
      + "/" + encodeURIComponent(region)
      + "?feature=regulatory;content-type=application/json");
    const rows = (d || []).map(function (f) {
      return { id: f.id, feature_type: f.feature_type, start: f.start, end: f.end };
    });
    if (!rows.length) {
      return { empty: "The Ensembl regulatory build has no feature over this locus." };
    }
    return { reg: rows };
  }

  const SOURCES = [
    { key: "domains", label: "Protein domains", short: "protein domains", fetch: fetchDomains,
      hint: "Pfam / SMART / PROSITE / CATH / InterPro features, projected from "
            + "protein onto genomic coordinates and packed into lanes under each "
            + "transcript." },
    { key: "reg", label: "Regulatory features", short: "regulatory features", fetch: fetchRegulatory,
      hint: "Promoters, enhancers and CTCF sites from the Ensembl regulatory build." },
    { key: "gnomad", label: "gnomAD variants", short: "gnomAD variants", fetch: fetchGnomad,
      hint: "gnomAD r4 population variants; tick height scales with log10 of the "
            + "allele frequency." },
    { key: "clinvar", label: "ClinVar variants", short: "ClinVar variants", fetch: fetchClinvar,
      hint: "Clinically reported variants, coloured by significance." },
  ];

  function overlayBar(ctx, geo) {
    const vs = ctx.vs;
    const key = ctx.geneKey;
    const store = cache[key] || (cache[key] = {});
    const outer = el("div");
    const bar = el("div", { class: "gt-overlays" });
    const status = el("span", { class: "control-hint" });
    const beta = el("details", { class: "disclose adv-group",
      style: { marginTop: "var(--sp-2)" } });
    beta.appendChild(el("summary", {},
      [el("span", { text: "gnomAD and ClinVar lookups" }),
       el("span", { class: "card-badge", text: "beta" })]));
    const betaBar = el("div", { class: "gt-overlays" });
    beta.appendChild(betaBar);
    const EXTERNAL = { gnomad: 1, clinvar: 1 };

    const fetchCtx = {
      chr: geo.chr, lo: geo.lo, hi: geo.hi, rows: geo.rows,
      geneId: ctx.geneId, geneName: ctx.geneName,
    };

    const frameForIds = (IV.state.loaded && IV.state.loaded[IV.state.mode]
      && IV.state.loaded[IV.state.mode].genes) || null;
    const withheld = [];
    const usable = SOURCES.filter(function (src) {
      if (!IV.species || IV.species.canUse(src.key, frameForIds)) return true;
      withheld.push({ label: src.label,
        why: IV.species.unavailableReason(src.key, frameForIds) });
      return false;
    });

    for (const src of usable) {
      const on = !!vs.ov[src.key];
      const btn = el("button", {
        class: "btn btn-sm", title: src.hint,
        "aria-pressed": on ? "true" : "false",
          text: (store[src.key] ? (on ? "Hide " : "Show ") : "Load ")
            + (src.short || src.label),
      });
      btn.addEventListener("click", function () {
        if (store[src.key]) {
          if (vs.ov[src.key]) delete vs.ov[src.key];
          else vs.ov[src.key] = store[src.key];
          IV.app.rerender();
          return;
        }
        const guard = key + ":" + src.key;
        if (inflight[guard]) return;
        inflight[guard] = true;
        btn.disabled = true;
        status.textContent = "Loading " + (src.short || src.label) + " …";
        src.fetch(fetchCtx).then(function (res) {
          if (res.empty) { status.textContent = res.empty; return; }
          const payload = res[src.key === "domains" ? "domains" : src.key];
          store[src.key] = payload;
          vs.ov[src.key] = payload;
          const notes = [];
          if (res.partial) notes.push(res.partial);
          if (res.truncated) {
            notes.push("showing " + F.int(CLINVAR_MAX) + " of "
              + F.int(CLINVAR_MAX + res.truncated) + " records");
          }
          status.textContent = notes.join(" · ");
          IV.app.rerender();
        }).catch(function (err) {
          status.textContent = "Could not load " + (src.short || src.label)
            + ": " + String((err && err.message) || err)
            + " - this overlay needs internet.";
        }).finally(function () {
          inflight[guard] = false;
          btn.disabled = false;
        });
      });
      (EXTERNAL[src.key] ? betaBar : bar).appendChild(btn);
    }
    bar.appendChild(status);
    if (withheld.length) {
      const reasons = [];
      const seen = {};
      for (const wd of withheld) {
        if (wd.why && !seen[wd.why]) { seen[wd.why] = 1; reasons.push(wd.why); }
      }
      bar.appendChild(el("div", { class: "note xsmall",
        style: { flexBasis: "100%", marginTop: "4px" },
        html: "Not available for this run: "
          + withheld.map(function (wd) { return F.escapeHtml(wd.label); }).join(", ")
          + ". " + reasons.map(F.escapeHtml).join(" ") }));
    }
    outer.appendChild(bar);
    if (betaBar.childNodes.length) outer.appendChild(beta);
    return outer;
  }

  const descCache = {};

  async function geneDescription(geneId) {
    const id = bare(geneId);
    if (!id || !/^ENS[A-Z]*G\d/.test(id)) return null;
    if (Object.prototype.hasOwnProperty.call(descCache, id)) return descCache[id];
    const key = "desc:" + id;
    if (inflight[key]) return inflight[key];
    inflight[key] = (async function () {
      try {
        const d = await getJSON(ENSEMBL + "/lookup/id/" + encodeURIComponent(id)
          + "?content-type=application/json");
        const raw = (d && d.description) || "";
        const text = String(raw).replace(/\s*\[Source:[^\]]*\]\s*$/, "").trim();
        const out = text ? { text: text, name: d.display_name || null,
                             biotype: d.biotype || null } : null;
        descCache[id] = out;
        return out;
      } catch (e) {
        descCache[id] = null;
        return null;
      } finally {
        delete inflight[key];
      }
    })();
    return inflight[key];
  }

  IV.overlays = { overlayBar: overlayBar, projectProtein: projectProtein,
                  geneDescription: geneDescription,
                  _sources: SOURCES, _cache: cache, _descCache: descCache };
})(window.IV);
