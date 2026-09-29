(function (IV) {
  "use strict";

  const TYPED = {
    f32: Float32Array, i8: Int8Array, u8: Uint8Array,
    i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array,
  };

  const cache = new Map();
  const pending = new Map();

  function blockNode(name) {
    return document.querySelector('script[data-block="' + name + '"]');
  }

  function available() {
    return Array.from(document.querySelectorAll("script[data-block]"))
      .map(function (n) { return n.dataset.block; });
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error(
        "This browser cannot decompress the report payload (DecompressionStream " +
        "is unavailable). Please open the report in a current version of " +
        "Chrome, Edge, Firefox or Safari."
      );
    }
    const ds = new DecompressionStream("gzip");
    const w = ds.writable.getWriter();
    w.write(bytes);
    w.close();
    const chunks = [];
    let total = 0;
    const r = ds.readable.getReader();
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const n = bin.length;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function Table(header, buffer, base) {
    this.name = header.name;
    this.n = header.n || 0;
    this.meta = header.meta || {};
    this._spec = header.columns || {};
    this._buf = buffer;
    this._base = base;
    this._cols = new Map();
  }

  Table.prototype.has = function (key) {
    return Object.prototype.hasOwnProperty.call(this._spec, key);
  };
  Table.prototype.keys = function () { return Object.keys(this._spec); };

  Table.prototype._view = function (Ctor, offset, bytes) {
    const at = this._base + offset;
    const n = bytes / Ctor.BYTES_PER_ELEMENT;
    if (at % Ctor.BYTES_PER_ELEMENT === 0) return new Ctor(this._buf, at, n);
    return new Ctor(this._buf.slice(at, at + bytes));
  };

  Table.prototype.col = function (key) {
    if (this._cols.has(key)) return this._cols.get(key);
    const s = this._spec[key];
    if (!s) return null;
    let v;
    if (s.kind === "num") {
      v = this._view(TYPED[s.dtype], s.offset, s.bytes);
    } else if (s.kind === "str") {
      v = s.values;
    } else if (s.kind === "dict") {
      v = new DictColumn(this._view(TYPED[s.dtype], s.offset, s.bytes), s.values);
    } else if (s.kind === "matrix") {
      v = new Matrix(this._view(Float32Array, s.offset, s.bytes), s.rows, s.cols);
    }
    this._cols.set(key, v);
    return v;
  };

  Table.prototype.text = function (key) {
    const c = this.col(key);
    if (c == null) return null;
    if (c instanceof DictColumn) return c;
    return c;
  };

  function DictColumn(codes, values) {
    this.codes = codes;
    this.values = values;
    this.length = codes.length;
  }
  DictColumn.prototype.get = function (i) { return this.values[this.codes[i]]; };
  DictColumn.prototype.levelOf = function (s) { return this.values.indexOf(s); };
  DictColumn.prototype.toArray = function () {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.values[this.codes[i]];
    return out;
  };

  function Matrix(values, rows, cols) {
    this.values = values;
    this.rows = rows;
    this.cols = cols;
    this.nc = cols.length;
  }
  Matrix.prototype.get = function (i, j) { return this.values[i * this.nc + j]; };
  Matrix.prototype.row = function (i) {
    return this.values.subarray(i * this.nc, (i + 1) * this.nc);
  };
  Matrix.prototype.colIndex = function (name) { return this.cols.indexOf(name); };

  function cell(col, i) {
    if (col == null) return "";
    if (col instanceof DictColumn) return col.get(i);
    return col[i];
  }

  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    if (pending.has(name)) return pending.get(name);

    const node = blockNode(name);
    if (!node) {
      const err = new Error("payload block '" + name + "' is not present in this report");
      err.missingBlock = name;
      throw err;
    }
    const p = (async function () {
      const raw = await inflate(b64ToBytes(node.textContent.trim()));
      node.textContent = "";
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const hlen = dv.getUint32(0, true);
      const header = JSON.parse(
        new TextDecoder().decode(raw.subarray(4, 4 + hlen)));
      const base = raw.byteOffset + 4 + hlen;
      let value;
      if (header.kind === "json") {
        value = JSON.parse(new TextDecoder().decode(
          raw.subarray(4 + hlen, 4 + hlen + header.bytes)));
      } else {
        value = new Table(header, raw.buffer, base);
      }
      cache.set(name, value);
      pending.delete(name);
      return value;
    })();
    pending.set(name, p);
    return p;
  }

  function loadAll(names) {
    return Promise.all(names.map(load));
  }

  function peek(name) { return cache.get(name) || null; }

  IV.blocks = { load, loadAll, peek, available, cell, Table, Matrix, DictColumn };
})(window.IV);
