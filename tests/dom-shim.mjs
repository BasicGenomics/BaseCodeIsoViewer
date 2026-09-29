const SVG_NS = "http://www.w3.org/2000/svg";

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); this._sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this._sync(); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) { (on == null ? !this.set.has(c) : on) ? this.add(c) : this.remove(c); }
  _sync() { this.node._attrs.class = Array.from(this.set).join(" "); }
}

class Node2 {
  constructor(name, ns) {
    this.tagName = String(name || "").toUpperCase();
    this.localName = String(name || "");
    this.namespaceURI = ns || null;
    this.childNodes = [];
    this.parentNode = null;
    this._attrs = Object.create(null);
    this._listeners = Object.create(null);
    this.style = new Proxy({}, { set(t, k, v) { t[k] = v; return true; } });
    this.dataset = Object.create(null);
    this._classList = new ClassList(this);
    this._text = null;
  }
  get classList() { return this._classList; }
  set className(v) {
    this._attrs.class = v;
    this._classList.set = new Set(String(v || "").split(/\s+/).filter(Boolean));
  }
  get className() { return this._attrs.class || ""; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get children() { return this.childNodes.filter((c) => c instanceof Node2); }
  appendChild(c) {
    if (c == null) throw new Error("appendChild(null)");
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this._attrs[k] = String(v);
    if (k === "class") this.className = v;
    if (k.startsWith("data-")) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  hasAttribute(k) { return k in this._attrs; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) {
    const a = this._listeners[t];
    if (a) this._listeners[t] = a.filter((f) => f !== fn);
  }
  dispatch(type, evt) {
    for (const fn of this._listeners[type] || []) fn(Object.assign({ type, target: this,
      clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }, evt));
  }
  click() {
    let stopped = false;
    const ev = { type: "click", target: this, clientX: 0, clientY: 0,
      preventDefault() {}, stopPropagation() { stopped = true; } };
    for (let n = this; n && !stopped; n = n.parentNode) {
      if (!(n instanceof Node2)) break;
      for (const fn of (n._listeners.click || []).slice()) {
        fn(Object.assign({}, ev, { currentTarget: n,
          stopPropagation: ev.stopPropagation }));
        if (stopped) break;
      }
    }
  }
  set textContent(v) {
    this.childNodes = [];
    this._text = v == null ? "" : String(v);
  }
  get textContent() {
    if (this._text != null) return this._text;
    const own = this._html
      ? String(this._html)
          .replace(/<[^>]*>/g, "")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      : "";
    return own + this.childNodes.map((c) => c.textContent).join("");
  }
  set innerHTML(v) { this.childNodes = []; this._text = null; this._html = String(v); }
  get innerHTML() { return this._html || ""; }
  set title(v) { this._attrs.title = String(v); }
  get title() { return this._attrs.title || ""; }
  set disabled(v) { this._attrs.disabled = !!v; }
  get disabled() { return !!this._attrs.disabled; }
  set value(v) { this._value = String(v); }
  get value() { return this._value == null ? "" : this._value; }
  set checked(v) { this._checked = !!v; }
  get checked() { return !!this._checked; }
  get type() { return this._attrs.type || ""; }
  set type(v) { this._attrs.type = v; }
  get clientWidth() { return 640; }
  get clientHeight() { return 300; }
  get scrollTop() { return this._scrollTop || 0; }
  set scrollTop(v) { this._scrollTop = Number(v) || 0; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 300,
    right: 640, bottom: 300 }; }
  get offsetWidth() { return 380; }
  get offsetHeight() { return 180; }
  scrollIntoView() { }
  getContext() { return canvasCtx(); }
  closest() { return null; }
  contains(n) {
    for (let p = n; p; p = p.parentNode) if (p === this) return true;
    return false;
  }
  querySelector(sel) { return findOne(this, sel); }
  querySelectorAll(sel) { const out = []; findAll(this, sel, out); return out; }
  get parentElement() { return this.parentNode; }
}

class Text2 {
  constructor(t) { this._text = String(t); this.parentNode = null; }
  get textContent() { return this._text; }
}

function matches(node, sel) {
  if (!(node instanceof Node2)) return false;
  const word = /[\w-]/;
  let i = 0, saw = false;
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === "#" || ch === ".") {
      let j = i + 1;
      while (j < sel.length && word.test(sel[j])) j++;
      const name = sel.slice(i + 1, j);
      if (j === i + 1) return false;
      if (ch === "#" ? node._attrs.id !== name : !node.classList.contains(name)) {
        return false;
      }
      i = j;
    } else if (ch === "[") {
      const end = sel.indexOf("]", i);
      if (end < 0) return false;
      const inner = sel.slice(i + 1, end);
      const eq = inner.indexOf("=");
      const name = eq < 0 ? inner : inner.slice(0, eq);
      if (/[~^$*|]$/.test(name)) return false;
      if (!(name in node._attrs)) return false;
      if (eq >= 0) {
        const want = inner.slice(eq + 1).replace(/^["']|["']$/g, "");
        if (String(node._attrs[name]) !== want) return false;
      }
      i = end + 1;
    } else if (ch === "*") {
      i++;
    } else if (word.test(ch)) {
      let j = i;
      while (j < sel.length && word.test(sel[j])) j++;
      if (node.localName !== sel.slice(i, j)) return false;
      i = j;
    } else {
      return false;
    }
    saw = true;
  }
  return saw;
}
function matchesSel(node, sel) {
  const parts = String(sel).trim().split(/\s+/);
  if (parts.length === 1) return matches(node, parts[0]);
  if (!matches(node, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let p = node.parentNode; p && i >= 0; p = p.parentNode) {
    if (matches(p, parts[i])) i--;
  }
  return i < 0;
}
function findOne(root, sel) {
  for (const c of root.childNodes) {
    if (matchesSel(c, sel)) return c;
    if (c instanceof Node2) { const r = findOne(c, sel); if (r) return r; }
  }
  return null;
}
function findAll(root, sel, out) {
  for (const c of root.childNodes) {
    if (matchesSel(c, sel)) out.push(c);
    if (c instanceof Node2) findAll(c, sel, out);
  }
}

function canvasCtx() {
  return {
    scale() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, fillRect() {},
    save() {}, restore() {}, moveTo() {}, lineTo() {}, closePath() {}, clearRect() {},
    set fillStyle(_v) {}, get fillStyle() { return "#000"; },
    set strokeStyle(_v) {}, get strokeStyle() { return "#000"; },
    set lineWidth(_v) {}, get lineWidth() { return 1; },
    set globalAlpha(_v) {}, get globalAlpha() { return 1; },
    set font(_v) {}, measureText() { return { width: 10 }; },
  };
}

export function installDom(tokens) {
  const doc = new Node2("html");
  const body = new Node2("body");
  const head = new Node2("head");
  doc.appendChild(head);
  doc.appendChild(body);

  const document = {
    documentElement: doc,
    body: body,
    head: head,
    readyState: "complete",
    title: "",
    createElement(t) { return new Node2(t); },
    createElementNS(ns, t) { return new Node2(t, ns); },
    createTextNode(t) { return new Text2(t); },
    getElementById(id) { return findOne(doc, "#" + id); },
    querySelector(sel) { return findOne(doc, sel); },
    querySelectorAll(sel) { const out = []; findAll(doc, sel, out); return out; },
    addEventListener() {},
    removeEventListener() {},
  };

  const styleMap = Object.assign(Object.create(null), tokens || {});
  const g = globalThis;
  g.document = document;
  g.window = g;
  g._listeners = Object.create(null);
  g.addEventListener = function (t, fn) {
    (g._listeners[t] = g._listeners[t] || []).push(fn);
  };
  g.removeEventListener = function (t, fn) {
    const a = g._listeners[t] || [];
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  };
  g.location = {
    _hash: "",
    href: "file:///report.html",
    get hash() { return this._hash; },
    set hash(v) {
      const nv = v && v.charAt(0) !== "#" ? "#" + v : (v || "");
      if (nv === this._hash) return;
      this._hash = nv;
      for (const fn of g._listeners.hashchange || []) {
        try { fn({ type: "hashchange" }); } catch (e) { console.error(e); }
      }
    },
  };
  g.history = {
    length: 1,
    back() {},
    forward() {},
    pushState() { this.length++; },
    replaceState() {},
  };
  g.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };
  g.cancelAnimationFrame = function (id) { clearTimeout(id); };
  g.Node = Node2;
  g.SVG_NS = SVG_NS;
  g.devicePixelRatio = 1;
  g.innerWidth = 1440;
  g.innerHeight = 900;
  g.getComputedStyle = function () {
    return { getPropertyValue(name) { return styleMap[name] || ""; } };
  };
  g.localStorage = {
    _d: Object.create(null),
    getItem(k) { return this._d[k] == null ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
  };
  g.URL = g.URL || {};
  g.URL.createObjectURL = function () { return "blob:stub"; };
  g.URL.revokeObjectURL = function () {};
  g.Blob = g.Blob || function () {};
  g.requestAnimationFrame = function (fn) { return setTimeout(fn, 0); };
  return { document, body, doc, Node: Node2 };
}

export { Node2 as ShimNode };
