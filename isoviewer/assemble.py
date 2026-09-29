from __future__ import annotations

import base64
import html
import os
import re

CSS_ORDER = ["tokens.css", "base.css", "components.css"]

BLOCK_TEMPLATE = (
    '<script type="application/octet-stream" data-block="{name}">{data}</script>'
)


def _web_dir() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    inside = os.path.join(here, "web")
    if os.path.isdir(os.path.join(inside, "js")):
        return inside
    return os.path.join(os.path.dirname(here), "web")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


FONT_FACES = (
    ("Mona Sans", 400, "normal", "MonaSans-Regular.woff2"),
    ("Mona Sans", 700, "normal", "MonaSans-Bold.woff2"),
)


def collect_fonts(web: str | None = None) -> str:
    web = web or _web_dir()
    fdir = os.path.join(web, "assets", "fonts")
    if not os.path.isdir(fdir):
        return ""
    faces = []
    for family, weight, style, fname in FONT_FACES:
        path = os.path.join(fdir, fname)
        if not os.path.isfile(path):
            continue
        with open(path, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")
        faces.append(
            "@font-face{font-family:'%s';font-style:%s;font-weight:%d;"
            "font-display:swap;"
            "src:url(data:font/woff2;base64,%s) format('woff2')}"
            % (family, style, weight, b64)
        )
    if not faces:
        return ""
    notice = os.path.join(fdir, "mona-sans-OFL.txt")
    head = ""
    if os.path.isfile(notice):
        head = "/* Mona Sans is licensed under the SIL OFL 1.1:\n" \
               + _read(notice).replace("*/", "*)") + "\n*/\n"
    return head + "\n".join(faces)


def collect_css(web: str | None = None) -> str:
    web = web or _web_dir()
    css_dir = os.path.join(web, "css")
    names = CSS_ORDER + sorted(
        f for f in os.listdir(css_dir)
        if f.endswith(".css") and f not in CSS_ORDER
    )
    parts = []
    fonts = collect_fonts(web)
    if fonts:
        parts.append(fonts)
    for n in names:
        p = os.path.join(css_dir, n)
        if os.path.isfile(p):
            parts.append(_read(p))
    return "\n".join(parts)


VENDOR_ORDER = ("plotly.min.js", "d3.min.js")


def collect_vendor(web: str | None = None) -> tuple[str, list[str]]:
    web = web or _web_dir()
    vdir = os.path.join(web, "vendor")
    if not os.path.isdir(vdir):
        return "", []
    parts, used = [], []
    for n in VENDOR_ORDER:
        p = os.path.join(vdir, n)
        if os.path.isfile(p):
            parts.append(_read(p))
            used.append(n)
    return "\n".join(parts), used


def collect_js(web: str | None = None) -> str:
    web = web or _web_dir()
    js_dir = os.path.join(web, "js")
    names = sorted(f for f in os.listdir(js_dir) if f.endswith(".js"))
    parts = []
    vendor, _ = collect_vendor(web)
    if vendor:
        parts.append(vendor)
    for n in names:
        parts.append(_read(os.path.join(js_dir, n)))
    return "\n".join(parts)


def _guard_script(js: str) -> str:
    return re.sub(r"</(script)", r"<\\/\1", js, flags=re.I)


def collect_logo(web: str | None = None) -> str:
    web = web or _web_dir()
    path = os.path.join(web, "assets", "logo-white.svg")
    if not os.path.isfile(path):
        return ""
    svg = _read(path)
    svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    svg = re.sub(r'\s(width|height)="[^"]*"', "", svg, count=2)
    svg = svg.replace(".st0", ".bg-logo-w").replace(".st1", ".bg-logo-p")
    svg = svg.replace('class="st0"', 'class="bg-logo-w"')
    svg = svg.replace('class="st1"', 'class="bg-logo-p"')
    svg = re.sub(r"<svg", '<svg role="img" aria-label="Basic Genomics" focusable="false"', svg, count=1)
    return svg.strip()


def build_html(blocks, *, web: str | None = None, title: str | None = None) -> str:
    web = web or _web_dir()
    shell = _read(os.path.join(web, "index.html"))

    css = collect_css(web)
    js = collect_js(web)
    logo = collect_logo(web)

    block_html = "\n".join(
        BLOCK_TEMPLATE.format(name=b.name, data=base64.b64encode(b.data).decode("ascii"))
        for b in blocks
    )

    out = shell.replace("<!-- __STYLE__ -->", "<style>\n" + css + "\n</style>")
    out = out.replace("<!-- __LOGO__ -->", logo)
    out = out.replace("<!-- __BLOCKS__ -->", block_html)
    out = out.replace("<!-- __SCRIPT__ -->",
                      "<script>\n" + _guard_script(js) + "\n</script>")
    if title:
        out = out.replace("<title>IsoViewer</title>",
                          "<title>" + html.escape(title) + "</title>")
    return out


def write_report(path: str, blocks, *, web: str | None = None,
                 title: str | None = None) -> int:
    doc = build_html(blocks, web=web, title=title)
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)
    return len(doc.encode("utf-8"))
