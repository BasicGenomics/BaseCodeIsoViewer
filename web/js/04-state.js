(function (IV) {
  "use strict";

  const MODES = {
    ref: {
      key: "ref",
      label: "Reference",
      long: "Reference mode",
      blurb: "Quantification against the reference annotation.",
      detail:
        "Every gene and transcript here is an entry in the curated annotation " +
        "used for quantification.",
      source: "gene_grouped_<token>_{counts,tpm} · transcript_grouped_<token>_{counts,tpm}",
      genes: "ref.genes", tx: "ref.tx", struct: "ref.struct",
      featureWord: "transcript variant",
      featureWordPlural: "transcript variants",
      geneWord: "gene", geneWordPlural: "genes",
      variantWord: "transcript variant",
      variantWordPlural: "transcript variants",
    },
    disc: {
      key: "disc",
      label: "Discovery",
      long: "Discovery mode",
      blurb: "De-novo gene and transcript models reconstructed from the data.",
      detail:
        "Gene and transcript models built from the reads themselves, including " +
        "novel isoforms and novel loci.",
      source: "discovered_gene_grouped_<token>_{counts,tpm} · discovered_transcript_grouped_<token>_{counts,tpm}",
      genes: "disc.genes", tx: "disc.tx", struct: "disc.struct",
      featureWord: "transcript model", featureWordPlural: "transcript models",
      geneWord: "gene model", geneWordPlural: "gene models",
      variantWord: "transcript model",
      variantWordPlural: "transcript models",
    },
  };

  const STRINGENCY = {
    exploratory: {
      key: "exploratory", label: "Exploratory", min: 0,
      help: function () {
        return "Everything with a quantified value, including features seen once. "
          + "Use it to see the full tail; expect noise.";
      },
    },
    standard: {
      key: "standard", label: "Standard", min: 10,
      help: function () {
        return "At least 10 counted molecules in one sample. Drops the thin tail.";
      },
    },
    strict: {
      key: "strict", label: "Strict", min: 50,
      help: function () {
        return "At least 50 counted molecules in one sample. For a shortlist you "
          + "intend to follow up.";
      },
    },
  };

  const VALUE_MODE = {
    counts: {
      key: "counts", label: "molecules", labelCap: "Molecules",
      unit: "molecules", short: "molecules",
      help: "Reconstructed molecules counted for the feature.\n\n" +
            "Prefer molecules. Each one is a real molecule, not an estimate, " +
            "because the BaseCode Processing Pipeline reassembled the reads into " +
            "molecules before assignment. Molecule counts are not " +
            "depth-normalised, so compare within a sample rather than between " +
            "samples of different depth.",
      column: "counts",
    },
    tpm: {
      key: "tpm", label: "TPM", labelCap: "TPM", unit: "TPM", short: "TPM",
      help: "Molecule counts normalised to transcripts per million within each " +
            "sample.\n\nUse it to compare samples of different depth. The " +
            "normalisation makes samples comparable but no longer tells you how " +
            "many molecules were seen.",
      column: "tpm",
    },
  };

  const state = {
    core: null,
    mode: "ref",
    valueMode: "counts",
    stringency: "standard",
    universe: "all",
    weight: "mol",
    theme: "auto",
    view: "overview",
    viewArg: null,
    samples: [],
    sampleLabels: { labels: [], aliased: false },
    sampleOn: [],
    group: [],
    geneTabs: [],
    openGene: null,
    explorerState: null,
    loaded: {},
    derived: {},
    listeners: [],
  };

  function on(fn) { state.listeners.push(fn); }
  function emit(what) {
    for (const fn of state.listeners) {
      try { fn(what); } catch (e) { console.error(e); }
    }
  }

  function modeInfo(key) { return MODES[key || state.mode]; }
  function valueInfo() { return VALUE_MODE[state.valueMode]; }
  function stringencyInfo() { return STRINGENCY[state.stringency]; }

  function meanValuePhrase(capital) {
    const p = state.valueMode === "counts"
      ? "mean molecules per sample"
      : "mean TPM per sample";
    return capital ? p.charAt(0).toUpperCase() + p.slice(1) : p;
  }
  function meanValueShort() {
    return state.valueMode === "counts" ? "Mean molecules" : "Mean TPM";
  }

  const COUNTED_NOTE =
    "Averaged over samples from the quantified values, so it counts only the "
    + "molecules quantification counted - not every molecule assigned here.";

  const TOTAL_COUNTED_NOTE =
    "Summed over the selected samples from the quantified values, so it counts "
  + "only the molecules quantification counted - not every molecule assigned here.";

  const TERMS = [
    { term: "Detected molecules",
      body: "Molecules assigned to a feature, showing evidence that it was "
        + "observed before quantification." },
    { term: "Counted molecules",
      body: "Detected molecules that qualify for quantification: sufficient "
        + "support and an unambiguous assignment. Ambiguous or "
        + "annotation-conflicting molecules are detected but not counted." },
    { term: "Why show both?",
      body: "Quantification uses counted molecules, while detected molecules "
        + "distinguish features with evidence that could not be counted from "
        + "features that were never observed." },
  ];

  function evidence(frame, key, i) {
    const mk = key + "_s";
    if (frame.has(mk)) {
      const m = frame.col(mk), act = activeIdx();
      let sum = 0;
      for (let s = 0; s < act.length; s++) sum += m.get(i, act[s]);
      return sum;
    }
    return frame.has(key) ? frame.col(key)[i] : 0;
  }

  function hasPerSampleEvidence(frame) {
    return !!(frame && frame.has("mol_s"));
  }

  function evidenceColumn(frame, key) {
    const mk = key + "_s";
    if (!frame.has(mk)) {
      const plain = frame.has(key) ? frame.col(key) : null;
      return function (i) { return plain ? plain[i] : 0; };
    }
    const m = frame.col(mk), act = activeIdx();
    return function (i) {
      let sum = 0;
      for (let s = 0; s < act.length; s++) sum += m.get(i, act[s]);
      return sum;
    };
  }

  const PLACEHOLDER_BIOTYPES = new Set(["", "unknown", "na", "n/a", "none", "."]);
  const bioInfoCache = new WeakMap();

  function biotypeInfo(frame) {
    if (!frame || !frame.has("biotype")) return { informative: false, n: 0 };
    const hit = bioInfoCache.get(frame);
    if (hit) return hit;
    const col = frame.col("biotype");
    const seen = new Set();
    for (let i = 0; i < frame.n; i++) {
      const v = String(IV.blocks.cell(col, i) || "").trim().toLowerCase();
      if (PLACEHOLDER_BIOTYPES.has(v)) continue;
      seen.add(v);
      if (seen.size > 1) break;
    }
    const out = { informative: seen.size > 1, n: seen.size };
    bioInfoCache.set(frame, out);
    return out;
  }

  const valuedCache = new WeakMap();
  function hasValues(frame, key, minDistinct) {
    if (!frame || !frame.has(key)) return false;
    const want = minDistinct || 1;
    let per = valuedCache.get(frame);
    if (!per) { per = {}; valuedCache.set(frame, per); }
    const ck = key + "|" + want;
    if (per[ck] !== undefined) return per[ck];
    const col = frame.col(key);
    const seen = new Set();
    for (let i = 0; i < frame.n; i++) {
      const v = String(IV.blocks.cell(col, i) || "").trim();
      if (!v || v === "-" || v === "." || PLACEHOLDER_BIOTYPES.has(v.toLowerCase())) continue;
      seen.add(v);
      if (seen.size >= want) break;
    }
    per[ck] = seen.size >= want;
    return per[ck];
  }

  function hasBiotypes(frame) { return biotypeInfo(frame).informative; }

  const exampleCache = new WeakMap();

  function searchExamples(frame, n) {
    const want = n || 3;
    const hit = exampleCache.get(frame);
    if (hit && hit.length >= want) return hit.slice(0, want);
    if (!frame || !frame.n) return [];

    const names = frame.has("name") ? frame.col("name") : null;
    const ids = frame.has("id") ? frame.col("id") : null;
    if (!names && !ids) return [];

    const rank = frame.has("count") ? frame.col("count") : null;
    const idx = [];
    for (let i = 0; i < frame.n; i++) idx.push(i);
    if (rank) idx.sort(function (a, b) { return (rank[b] || 0) - (rank[a] || 0); });

    const out = [];
    const seen = new Set();
    for (let k = 0; k < idx.length && out.length < 8; k++) {
      const i = idx[k];
      let v = names ? String(IV.blocks.cell(names, i) || "").trim() : "";
      if (!v || v === "-" || v === "." || v.toLowerCase() === "unknown") {
        v = ids ? String(IV.blocks.cell(ids, i) || "").trim() : "";
      }
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    exampleCache.set(frame, out);
    return out.slice(0, want);
  }

  function searchPlaceholder(frame, tail) {
    const ex = searchExamples(frame, 3);
    const lead = ex.length ? "e.g. " + ex.join(", ") + " - " : "";
    return lead + (tail || "comma, space or newline separated");
  }

  function valueColumn() { return VALUE_MODE[state.valueMode].column; }
  function valueLabel() { return VALUE_MODE[state.valueMode].label; }
  function valueLabelCap() { return VALUE_MODE[state.valueMode].labelCap; }
  function valueUnit() { return VALUE_MODE[state.valueMode].unit; }

  function fmtValue(v) {
    return state.valueMode === "counts" ? IV.fmt.int(Math.round(v)) : IV.fmt.tpm(v);
  }

  async function universe(key) {
    const k = key || state.mode;
    if (state.loaded[k]) return state.loaded[k];
    const info = MODES[k];
    const [genes, tx] = await IV.blocks.loadAll([info.genes, info.tx]);
    state.loaded[k] = { key: k, info: info, genes: genes, tx: tx, struct: null };
    return state.loaded[k];
  }

  async function structOf(key) {
    const k = key || state.mode;
    const u = await universe(k);
    if (!u.struct) u.struct = await IV.blocks.load(MODES[k].struct);
    return u.struct;
  }

  function setMode(key) {
    if (!MODES[key] || state.mode === key) return;
    state.mode = key;
    emit("mode");
  }
  function setValueMode(v) {
    if (!VALUE_MODE[v] || state.valueMode === v) return;
    state.valueMode = v;
    emit("value");
  }
  function setStringency(v) {
    if (!STRINGENCY[v] || state.stringency === v) return;
    state.stringency = v;
    emit("stringency");
  }
  function setUniverse(u) {
    if (state.universe === u) return;
    state.universe = u;
    emit("universe");
  }
  function setWeight(w) {
    if (state.weight === w) return;
    state.weight = w;
    emit("weight");
  }

  function applyTheme() {
    const r = document.documentElement;
    if (state.theme === "auto") r.removeAttribute("data-theme");
    else r.setAttribute("data-theme", state.theme);
    try { localStorage.setItem("isoviewer-theme", state.theme); } catch (e) { }
    emit("theme");
  }
  function cycleTheme() {
    state.theme = state.theme === "auto" ? "light" : state.theme === "light" ? "dark" : "auto";
    applyTheme();
  }
  function initTheme() {
    let t = null;
    try { t = localStorage.getItem("isoviewer-theme"); } catch (e) { }
    if (t === "light" || t === "dark" || t === "auto") state.theme = t;
    applyTheme();
  }

  function derive(u) {
    const key = u.key + "|" + state.valueMode + "|" + state.stringency
      + "|" + sampleKey();
    if (state.derived[key]) return state.derived[key];

    const g = u.genes, t = u.tx;
    const act = activeIdx();
    const nG = g.n, nT = t.n, nS = act.length;
    const floor = STRINGENCY[state.stringency].min;
    const gm = g.col(valueColumn());
    const tm = t.col(valueColumn());
    const off = g.col("tx_off"), cnt = g.col("tx_n");

    function peakCounted(frame) {
      const cs = frame.has("counts") ? frame.col("counts") : null;
      if (!cs) {
        const plain = frame.has("count") ? frame.col("count") : null;
        return function (i) { return plain ? plain[i] : 0; };
      }
      return function (i) {
        let mx = 0;
        for (let s = 0; s < nS; s++) {
          const v = cs.get(i, act[s]);
          if (v > mx) mx = v;
        }
        return mx;
      };
    }
    const gPeakDet = peakCounted(g), tPeakDet = peakCounted(t);
    const txKeep = new Uint8Array(nT);
    for (let i = 0; i < nT; i++) {
      let mx = 0;
      for (let s = 0; s < nS; s++) {
        const v = tm.get(i, act[s]);
        if (v > mx) mx = v;
      }
      txKeep[i] = (mx > 0 && (floor <= 0 || tPeakDet(i) >= floor)) ? 1 : 0;
    }

    const keep = new Uint8Array(nG);
    const nVar = new Int32Array(nG);
    const nVarDet = new Int32Array(nG);
    const value = new Float64Array(nG);
    const total = new Float64Array(nG);
    const nDet = new Uint8Array(nG);
    const entropy = new Float32Array(nG);
    const jsdMean = new Float32Array(nG);
    const jsdPairs = new Int32Array(nG);
    const jsdMulti = new Float32Array(nG);
    const jsdMax = new Float32Array(nG);
    const switchSc = new Float32Array(nG);
    const cv = new Float32Array(nG);
    const domShare = new Float32Array(nG);

    const pairs = [];
    for (let a = 0; a < nS; a++) for (let b = a + 1; b < nS; b++) pairs.push([a, b]);
    const LN2 = Math.LN2;

    let widest = 0;
    for (let i = 0; i < nG; i++) if (cnt[i] > widest) widest = cnt[i];
    const meanBuf = new Float64Array(Math.max(1, widest));
    const colBuf = new Float64Array(Math.max(1, widest * Math.max(1, nS)));
    const idxBuf = new Int32Array(Math.max(1, widest));
    const colSum = new Float64Array(Math.max(1, nS));

    for (let i = 0; i < nG; i++) {
      let sSum = 0, det = 0;
      for (let s = 0; s < nS; s++) {
        const v = gm.get(i, act[s]);
        sSum += v;
        if (v > 0) det++;
      }
      total[i] = sSum;
      value[i] = nS ? sSum / nS : 0;
      nDet[i] = det;
      keep[i] = (sSum > 0 && (floor <= 0 || gPeakDet(i) >= floor)) ? 1 : 0;

      if (nS > 1 && value[i] > 0) {
        let acc = 0;
        for (let s = 0; s < nS; s++) {
          const dd = gm.get(i, act[s]) - value[i];
          acc += dd * dd;
        }
        cv[i] = Math.sqrt(acc / nS) / value[i];
      }

      const a0 = off[i], a1 = a0 + cnt[i];
      if (!keep[i]) {
        for (let x = a0; x < a1; x++) txKeep[x] = 0;
      }
      let k = 0;
      for (let x = a0; x < a1; x++) if (txKeep[x]) idxBuf[k++] = x;
      nVar[i] = k;
      if (!k) continue;

      let gTotal = 0, detVar = 0;
      for (let q = 0; q < k; q++) {
        const row = idxBuf[q];
        let sum = 0;
        for (let s = 0; s < nS; s++) {
          const v = tm.get(row, act[s]);
          sum += v;
          colBuf[q * nS + s] = v;
        }
        const mean = nS ? sum / nS : 0;
        meanBuf[q] = mean;
        gTotal += mean;
        if (mean > 0) detVar++;
      }
      nVarDet[i] = detVar;

      if (gTotal > 0) {
        let h = 0, dom = 0, nz = 0;
        for (let q = 0; q < k; q++) {
          const p = meanBuf[q] / gTotal;
          if (p > 0) { h -= p * Math.log(p) / LN2; nz++; }
          if (p > dom) dom = p;
        }
        domShare[i] = dom;
        entropy[i] = nz > 1 ? h / (Math.log(nz) / LN2) : 0;
      }

      if (k > 1 && nS > 1) {
        for (let s = 0; s < nS; s++) {
          let cs = 0;
          for (let q = 0; q < k; q++) cs += colBuf[q * nS + s];
          colSum[s] = cs;
        }
        let jSum = 0, jN = 0, jMx = 0, sw = 0;
        for (let pi = 0; pi < pairs.length; pi++) {
          const pa = pairs[pi][0], pb = pairs[pi][1];
          if (colSum[pa] <= 0 || colSum[pb] <= 0) continue;
          let acc = 0, da = 0, db = 0, va = -1, vb = -1;
          for (let q = 0; q < k; q++) {
            const p = colBuf[q * nS + pa] / colSum[pa];
            const r = colBuf[q * nS + pb] / colSum[pb];
            const m = 0.5 * (p + r);
            if (p > 0) acc += 0.5 * p * Math.log(p / m) / LN2;
            if (r > 0) acc += 0.5 * r * Math.log(r / m) / LN2;
            if (p > va) { va = p; da = q; }
            if (r > vb) { vb = r; db = q; }
          }
          if (acc < 0) acc = 0;
          if (acc > 1) acc = 1;
          jSum += acc; jN++;
          if (acc > jMx) jMx = acc;
          if (da !== db) {
            const f1 = Math.abs(colBuf[da * nS + pa] / colSum[pa]
                              - colBuf[da * nS + pb] / colSum[pb]);
            const f2 = Math.abs(colBuf[db * nS + pb] / colSum[pb]
                              - colBuf[db * nS + pa] / colSum[pa]);
            const best = f1 > f2 ? f1 : f2;
            if (best > sw) sw = best;
          }
        }
        jsdPairs[i] = jN;
        if (jN) { jsdMean[i] = jSum / jN; jsdMax[i] = jMx; }

        let used = 0;
        for (let s = 0; s < nS; s++) if (colSum[s] > 0) used++;
        if (used > 1) {
          let hMean = 0, meanH = 0;
          for (let q = 0; q < k; q++) {
            let mix = 0;
            for (let s = 0; s < nS; s++) {
              if (colSum[s] > 0) mix += colBuf[q * nS + s] / colSum[s];
            }
            mix /= used;
            if (mix > 0) hMean -= mix * Math.log(mix) / LN2;
          }
          for (let s = 0; s < nS; s++) {
            if (colSum[s] <= 0) continue;
            let hs = 0;
            for (let q = 0; q < k; q++) {
              const pq = colBuf[q * nS + s] / colSum[s];
              if (pq > 0) hs -= pq * Math.log(pq) / LN2;
            }
            meanH += hs;
          }
          meanH /= used;
          const norm = Math.log(used) / LN2;
          let v = norm > 0 ? (hMean - meanH) / norm : 0;
          if (!(v > 0)) v = 0;
          if (v > 1) v = 1;
          jsdMulti[i] = v;
        }
        switchSc[i] = sw;
      }
    }

    const molCol = evidenceColumn(g, "mol");
    const evidenceOnly = new Uint8Array(nG);
    for (let i = 0; i < nG; i++) {
      if (total[i] > 0 || !(molCol(i) > 0)) continue;
      if (floor > 0 && !(gPeakDet(i) >= floor)) continue;
      evidenceOnly[i] = 1;
    }

    const geneRows = new Int32Array(nG);
    let gk = 0;
    for (let i = 0; i < nG; i++) if (keep[i]) geneRows[gk++] = i;
    const geneRowsAll = new Int32Array(nG);
    let gak = 0;
    for (let i = 0; i < nG; i++) if (keep[i]) geneRowsAll[gak++] = i;
    for (let i = 0; i < nG; i++) if (evidenceOnly[i]) geneRowsAll[gak++] = i;
    const txRows = new Int32Array(nT);
    let tk = 0;
    for (let i = 0; i < nT; i++) if (txKeep[i]) txRows[tk++] = i;

    const txMolCol = evidenceColumn(t, "mol");
    const tGene = t.has("gene_idx") ? t.col("gene_idx") : null;
    const txEvidenceOnly = new Uint8Array(nT);
    for (let i = 0; i < nT; i++) {
      const gi = tGene ? tGene[i] : -1;
      if (gi >= 0 && !keep[gi] && !evidenceOnly[gi]) continue;
      let mx = 0;
      for (let sIdx = 0; sIdx < nS; sIdx++) {
        const v = tm.get(i, act[sIdx]);
        if (v > mx) mx = v;
      }
      if (mx > 0 || !(txMolCol(i) > 0)) continue;
      if (floor > 0 && !(tPeakDet(i) >= floor)) continue;
      txEvidenceOnly[i] = 1;
    }
    const txRowsAll = new Int32Array(nT);
    let tak = 0;
    for (let i = 0; i < nT; i++) if (txKeep[i]) txRowsAll[tak++] = i;
    for (let i = 0; i < nT; i++) if (txEvidenceOnly[i]) txRowsAll[tak++] = i;

    const out = {
      key: key, floor: floor,
      keep: keep, txKeep: txKeep,
      geneRows: geneRows.subarray(0, gk),
      geneRowsAll: geneRowsAll.subarray(0, gak),
      evidenceOnly: evidenceOnly,
      txRows: txRows.subarray(0, tk),
      txRowsAll: txRowsAll.subarray(0, tak),
      txEvidenceOnly: txEvidenceOnly,
      nVar: nVar, nVarDet: nVarDet, value: value, total: total, nDetected: nDet,
      entropy: entropy, jsdMean: jsdMean, jsdMax: jsdMax, switch: switchSc,
      jsdPairs: jsdPairs, nPairs: pairs.length, jsdMulti: jsdMulti,
      cv: cv, domShare: domShare,
    };
    state.derived[key] = out;
    return out;
  }

  function newFilter() {
    return {
      valMin: null, valMax: null,
      molMin: null, molMax: null,
      tpmMin: null, tpmMax: null,
      readMin: null, readMax: null,
      flMin: null, flFracMin: null,
      varMin: null, varMax: null,
      novelMin: null,
      entMin: null, entMax: null,
      jsdMin: null, jsdMax: null,
      samplesMin: null,
      biotypes: null,
      classes: null,
      names: null,
      novelOnly: false,
      quantifiedOnly: true,
    };
  }

  function inRange(v, lo, hi) {
    if (lo != null && !(v >= lo)) return false;
    if (hi != null && !(v <= hi)) return false;
    return true;
  }

  function filterGenes(u, f) {
    const d = derive(u);
    const g = u.genes;
    const mol = evidenceColumn(g, "mol"), read = evidenceColumn(g, "read"),
          molFl = evidenceColumn(g, "mol_fl");
    const bio = g.col("biotype"), ids = g.col("id"), names = g.col("name");
    const novel = g.has("novel") ? g.col("novel") : null;
    const nNic = g.has("n_nic") ? g.col("n_nic") : null;
    const nNnic = g.has("n_nnic") ? g.col("n_nnic") : null;
    const rows = f.quantifiedOnly ? d.geneRows : (d.geneRowsAll || d.geneRows);

    const out = new Int32Array(rows.length);
    let k = 0;
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      if (!inRange(d.value[i], f.valMin, f.valMax)) continue;
      if (!inRange(mol(i), f.molMin, f.molMax)) continue;
      if (!inRange(read(i), f.readMin, f.readMax)) continue;
      if (f.tpmMin != null || f.tpmMax != null) {
        const tv = totalTpm(g, i);
        if (tv == null || !inRange(tv, f.tpmMin, f.tpmMax)) continue;
      }
      if (f.flMin != null && !(molFl(i) >= f.flMin)) continue;
      if (f.flFracMin != null) {
        const fr = mol(i) > 0 ? molFl(i) / mol(i) : 0;
        if (!(fr >= f.flFracMin)) continue;
      }
      if (!inRange(d.nVar[i], f.varMin, f.varMax)) continue;
      if (!inRange(d.entropy[i], f.entMin, f.entMax)) continue;
      if (!inRange(d.jsdMean[i], f.jsdMin, f.jsdMax)) continue;
      if (f.samplesMin != null && !(d.nDetected[i] >= f.samplesMin)) continue;
      if (f.novelOnly && (!novel || !novel[i])) continue;
      if (f.novelMin != null) {
        const nv = (nNic ? nNic[i] : 0) + (nNnic ? nNnic[i] : 0);
        if (!(nv >= f.novelMin)) continue;
      }
      if (f.biotypes && f.biotypes.size && !f.biotypes.has(IV.blocks.cell(bio, i))) continue;
      if (f.names && f.names.size
          && !nameHit(f.names, ids, names, i)
          && !(gIdx && nameHit(f.names, gIds, gNames, gIdx[i]))) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  function filterTx(u, f) {
    const d = derive(u);
    const t = u.tx;
    const vm = t.col(valueColumn());
    const act = activeIdx();
    const nS = act.length;
    const mol = evidenceColumn(t, "mol"), read = evidenceColumn(t, "read"),
          molFl = evidenceColumn(t, "mol_fl");
    const gIdx = t.has("gene_idx") ? t.col("gene_idx") : null;
    const gIds = gIdx ? u.genes.col("id") : null;
    const gNames = gIdx ? u.genes.col("name") : null;
    const ids = t.col("id"), names = t.col("name");
    const bio = t.has("biotype") ? t.col("biotype") : null;
    const cls = t.has("class") ? t.col("class") : null;
    const novel = t.has("novel") ? t.col("novel") : null;
    const supFrac = t.has("sup_frac_fl") ? t.col("sup_frac_fl") : null;
    const rows = f.quantifiedOnly ? d.txRows : (d.txRowsAll || d.txRows);

    const out = new Int32Array(rows.length);
    let k = 0;
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      let sum = 0, det = 0;
      for (let s = 0; s < nS; s++) {
        const v = vm.get(i, act[s]);
        sum += v;
        if (v > 0) det++;
      }
      const mean = nS ? sum / nS : 0;
      if (!inRange(mean, f.valMin, f.valMax)) continue;
      if (!inRange(mol(i), f.molMin, f.molMax)) continue;
      if (!inRange(read(i), f.readMin, f.readMax)) continue;
      if (f.flMin != null && !(molFl(i) >= f.flMin)) continue;
      if (f.flFracMin != null) {
        const fr = supFrac ? supFrac[i] : (mol(i) > 0 ? molFl(i) / mol(i) : 0);
        if (!(fr >= f.flFracMin)) continue;
      }
      if (f.samplesMin != null && !(det >= f.samplesMin)) continue;
      if (f.novelOnly && (!novel || !novel[i])) continue;
      if (f.biotypes && f.biotypes.size && bio
          && !f.biotypes.has(IV.blocks.cell(bio, i))) continue;
      if (f.classes && f.classes.size && cls
          && !f.classes.has(IV.blocks.cell(cls, i))) continue;
      if (f.names && f.names.size && !nameHit(f.names, ids, names, i)) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  function nameHit(set, ids, names, i) {
    const id = IV.blocks.cell(ids, i), nm = IV.blocks.cell(names, i);
    return set.has(nm.toUpperCase()) || set.has(id.toUpperCase())
      || set.has(IV.fmt.stripVersion(id).toUpperCase());
  }

  function parseNames(text) {
    if (!text) return null;
    const parts = String(text).split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) return null;
    return new Set(parts.map(function (p) { return p.toUpperCase(); }));
  }

  function quantStrategy(level) {
    const want = level === "gene" ? "gene_quantification" : "transcript_quantification";
    const core = state.core;
    for (const p of (core && core.run && core.run.params) || []) {
      if (p.key === want) return p.value;
    }
    return null;
  }

  let _sampleRank = null;
  function sampleRank() {
    if (_sampleRank) return _sampleRank;
    const names = state.samples || [];
    const parsed = names.map(function (n, i) {
      const m = /^(.*?)(\d+)\s*$/.exec(String(n));
      return { i: i, head: m ? m[1] : String(n), num: m ? parseInt(m[2], 10) : null };
    });
    const allNumbered = parsed.length > 0 && parsed.every(function (p) { return p.num != null; });
    const rank = new Array(names.length);
    if (!allNumbered) {
      for (let k = 0; k < names.length; k++) rank[k] = k;
    } else {
      parsed.slice().sort(function (a, b) {
        return a.head < b.head ? -1 : a.head > b.head ? 1 : a.num - b.num;
      }).forEach(function (p, r) { rank[p.i] = r; });
    }
    _sampleRank = rank;
    return rank;
  }
  function sampleColor(i) {
    const r = sampleRank();
    const rank = r[i] == null ? i : r[i];
    const n = (state.samples || []).length;
    return IV.pal.rampSeries(rank, n);
  }

  function meanCounts(frame, i) {
    if (!frame.has("counts")) return 0;
    const m = frame.col("counts"), act = activeIdx();
    let sum = 0;
    for (let s = 0; s < act.length; s++) sum += m.get(i, act[s]);
    return act.length ? sum / act.length : 0;
  }

  function totalCounts(frame, i) {
    if (!frame.has("counts")) return 0;
    const m = frame.col("counts"), act = activeIdx();
    let sum = 0;
    for (let s = 0; s < act.length; s++) sum += m.get(i, act[s]);
    return sum;
  }

  function totalTpm(frame, i) {
    if (!frame.has("tpm")) return null;
    const m = frame.col("tpm"), act = activeIdx();
    let sum = 0;
    for (let s = 0; s < act.length; s++) sum += m.get(i, act[s]);
    return sum;
  }
  function meanTpm(frame, i) {
    if (!frame.has("tpm")) return null;
    const m = frame.col("tpm"), act = activeIdx();
    let sum = 0;
    for (let s = 0; s < act.length; s++) sum += m.get(i, act[s]);
    return act.length ? sum / act.length : 0;
  }

  function txValue(t, i) {
    const vm = t.col(valueColumn());
    const act = activeIdx();
    let s = 0;
    for (let j = 0; j < act.length; j++) s += vm.get(i, act[j]);
    return act.length ? s / act.length : 0;
  }

  function txValueRow(t, i) {
    return t.col(valueColumn()).row(i);
  }

  function geneValueRow(g, i) {
    return g.col(valueColumn()).row(i);
  }

  function weightLabel() { return state.weight === "read" ? "reads" : "molecules"; }
  function weightLabelCap() { return state.weight === "read" ? "Reads" : "Molecules"; }
  function universeLabel() {
    return state.universe === "all" ? "all molecules" : "full-length molecules";
  }

  function qcSlice() {
    const a = state.core.assignment;
    if (!a) return null;
    const uni = a.by_universe[state.universe] || a.by_universe.all;
    return { uni: uni, weight: state.weight === "read" ? "read" : "mol", root: a };
  }

  function assignTotals(universeKey) {
    const a = state.core.assignment;
    if (!a) return null;
    const uni = a.by_universe[universeKey || state.universe] || a.by_universe.all;
    const w = state.weight === "read" ? "read" : "mol";
    const all = allSamplesOn();
    const perSample = uni["sample_" + w];
    const perAssign = uni["sample_assign_" + w];

    const perClass = uni["sample_class_" + w];
    if (all || !perSample || !perAssign) {
      return {
        scoped: false,
        assign: uni["assign_" + w] || uni.assign_mol,
        cls: uni["class_" + w] || uni.class_mol,
        total_molecules: uni.total_molecules,
        total_reads: uni.total_reads,
      };
    }

    const act = activeIdx();
    const rowOf = {};
    (a.sample_values || []).forEach(function (nm, i) { rowOf[nm] = i; });

    const nT = (a.assign_values || []).length;
    const nC = (a.class_values || []).length;
    const assign = new Array(nT).fill(0);
    const cls = new Array(nC).fill(0);
    let mols = 0, reads = 0;
    for (let k = 0; k < act.length; k++) {
      const nm = state.samples[act[k]];
      const r = rowOf[nm];
      if (r == null) continue;
      const row = perAssign[r];
      if (row) for (let t = 0; t < nT; t++) assign[t] += row[t] || 0;
      const crow = perClass && perClass[r];
      if (crow) for (let t = 0; t < nC; t++) cls[t] += crow[t] || 0;
      mols += (uni.sample_mol && uni.sample_mol[r]) || 0;
      reads += (uni.sample_read && uni.sample_read[r]) || 0;
    }
    return {
      scoped: true,
      assign: assign,
      cls: (perClass ? cls : (uni["class_" + w] || uni.class_mol)),
      total_molecules: mols,
      total_reads: reads,
    };
  }

  function pushGeneTab(mode, index, id, name) {
    const existing = state.geneTabs.findIndex(function (t) {
      return t.mode === mode && t.index === index;
    });
    if (existing >= 0) return existing;
    state.geneTabs.push({ mode: mode, index: index, id: id, name: name });
    if (state.geneTabs.length > 12) state.geneTabs.shift();
    return state.geneTabs.length - 1;
  }

  function closeGeneTab(mode, index) {
    const i = state.geneTabs.findIndex(function (t) {
      return t.mode === mode && t.index === index;
    });
    if (i >= 0) state.geneTabs.splice(i, 1);
    return i;
  }

  IV.state = state;

  function ensureSampleOn() {
    const n = state.samples.length;
    if (!Array.isArray(state.sampleOn) || state.sampleOn.length !== n) {
      state.sampleOn = new Array(n).fill(true);
    }
    return state.sampleOn;
  }

  function activeIdx() {
    const on = ensureSampleOn();
    const out = [];
    for (let i = 0; i < on.length; i++) if (on[i]) out.push(i);
    if (!out.length) for (let i = 0; i < on.length; i++) out.push(i);
    return out;
  }

  function nActive() { return activeIdx().length; }

  function allSamplesOn() {
    const on = ensureSampleOn();
    for (let i = 0; i < on.length; i++) if (!on[i]) return false;
    return true;
  }

  function sampleKey() {
    const on = ensureSampleOn();
    let k = "";
    for (let i = 0; i < on.length; i++) k += on[i] ? "1" : "0";
    return k;
  }

  function setSampleOn(i, on) {
    ensureSampleOn();
    if (i < 0 || i >= state.sampleOn.length) return;
    if (!on && nActive() <= 1 && state.sampleOn[i]) return;
    state.sampleOn[i] = !!on;
    state.derived = {};
    emit("samples");
  }

  function setAllSamples(on) {
    ensureSampleOn();
    for (let i = 0; i < state.sampleOn.length; i++) state.sampleOn[i] = !!on;
    if (!on && state.sampleOn.length) state.sampleOn[0] = true;
    state.derived = {};
    emit("samples");
  }

  function setSampleSet(list) {
    ensureSampleOn();
    const want = new Set(list.map(Number));
    if (!want.size) return;
    for (let i = 0; i < state.sampleOn.length; i++) state.sampleOn[i] = want.has(i);
    state.derived = {};
    emit("samples");
  }

  function sampleAliasKey(indices) {
    const sl = state.sampleLabels;
    if (!sl || !sl.aliased) return null;
    return indices.map(function (i) {
      return {
        alias: sl.labels[i],
        full: String(state.samples[i] == null ? "" : state.samples[i]),
      };
    });
  }

  function sampleTipName(i) {
    const full = String(state.samples[i] == null ? "" : state.samples[i]);
    const sl = state.sampleLabels;
    if (!sl || !sl.aliased) return full;
    return sl.labels[i] + " · " + full;
  }

  IV.stateApi = {
    MODES, STRINGENCY, VALUE_MODE,
    on, emit, modeInfo, valueInfo, stringencyInfo,
    valueColumn, valueLabel, valueLabelCap, valueUnit, fmtValue,
    meanValuePhrase, meanValueShort, COUNTED_NOTE, TOTAL_COUNTED_NOTE, TERMS,
    universe, structOf, derive,
    setMode, setValueMode, setStringency, setUniverse, setWeight,
    initTheme, cycleTheme, applyTheme,
    newFilter, filterGenes, filterTx, parseNames,
    txValue, txValueRow, geneValueRow, meanCounts, meanTpm,
    totalCounts, totalTpm, quantStrategy,
    evidence, evidenceColumn, hasPerSampleEvidence,
    hasBiotypes, biotypeInfo, hasValues,
    searchExamples, searchPlaceholder,
    sampleColor, sampleRank,
    activeIdx, nActive, allSamplesOn, ensureSampleOn,
    setSampleOn, setAllSamples, setSampleSet,
    weightLabel, weightLabelCap, universeLabel, qcSlice, assignTotals,
    pushGeneTab, closeGeneTab, sampleAliasKey, sampleTipName,
  };
})(window.IV);
