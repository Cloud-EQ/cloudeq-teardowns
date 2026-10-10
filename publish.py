#!/usr/bin/env python3
"""
Build script for the financial articles site. Standard library only.

  python3 publish.py                 Scan articles/*.md and rebuild data/articles.js
  python3 publish.py new "Title"     Create a new article file from TEMPLATE.md

After running it, open index.html (or upload the folder to any web host).
"""
import datetime
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ARTICLES_DIR = ROOT / "articles"
OUT_FILE = ROOT / "data" / "articles.js"
CONFIG_FILE = ROOT / "config.json"
TEMPLATE_FILE = ROOT / "TEMPLATE.md"

DEFAULT_CONFIG = {
    "title": "Financial Breakdowns",
    "tagline": "Weekly breakdowns of company financials.",
    "author": "",
    "disclaimer": "For informational purposes only. Not investment advice.",
}


# ---------- Frontmatter ----------
def split_commas(s):
    parts, cur, quote = [], "", None
    for ch in s:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
            cur += ch
        elif ch == ",":
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def parse_scalar(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [parse_scalar(x) for x in split_commas(inner)] if inner else []
    return v


def parse_frontmatter(text):
    """Parse a small YAML subset: key: value, [a, b] lists, '- item' lists, one-level nested blocks."""
    text = text.lstrip("﻿")
    m = re.match(r"^---[ \t]*\n(.*?)\n---[ \t]*(?:\n|$)(.*)$", text, re.S)
    if not m:
        return {}, text
    meta, current = {}, None
    for raw in m.group(1).split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indented = raw[0] in " \t"
        line = raw.strip()
        if indented and current is not None:
            if line.startswith("- "):
                if not isinstance(meta[current], list):
                    meta[current] = []
                meta[current].append(parse_scalar(line[2:]))
                continue
            if ":" in line:
                k, v = line.split(":", 1)
                if not isinstance(meta[current], dict):
                    meta[current] = {}
                meta[current][k.strip()] = parse_scalar(v)
                continue
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if v == "":
            meta[k] = None  # filled by following indented lines
            current = k
        else:
            meta[k] = parse_scalar(v)
            current = None
    for k, v in list(meta.items()):
        if v is None:
            meta[k] = ""
    return meta, m.group(2)


# ---------- Helpers ----------
def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "article"


def as_list(v):
    if isinstance(v, list):
        return [str(x) for x in v if str(x).strip()]
    if isinstance(v, str) and v.strip():
        return [x.strip() for x in v.split(",") if x.strip()]
    return []


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        try:
            cfg.update(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
        except json.JSONDecodeError as e:
            print(f"WARNING: config.json is not valid JSON ({e}); using defaults.")
    return cfg


# ---------- Build ----------
def build():
    ARTICLES_DIR.mkdir(exist_ok=True)
    OUT_FILE.parent.mkdir(exist_ok=True)
    articles, warnings, drafts, slugs = [], [], 0, set()

    for path in sorted(ARTICLES_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        name = path.name

        if str(meta.get("draft", "")).lower() in ("true", "yes", "1"):
            drafts += 1
            continue

        # date: frontmatter, else filename prefix
        date = None
        raw_date = str(meta.get("date", "")).strip()
        fn_date = re.match(r"(\d{4}-\d{2}-\d{2})", path.stem)
        for candidate in (raw_date, fn_date.group(1) if fn_date else ""):
            if candidate:
                try:
                    date = datetime.date.fromisoformat(candidate).isoformat()
                    break
                except ValueError:
                    pass
        if not date:
            date = datetime.date.fromtimestamp(path.stat().st_mtime).isoformat()
            warnings.append(f"{name}: no valid date (use YYYY-MM-DD); used file modified date {date}")

        # title: frontmatter, else first '# ' heading, else filename
        title = str(meta.get("title", "")).strip()
        if not title:
            h = re.search(r"^#\s+(.+)$", body, re.M)
            title = h.group(1).strip() if h else path.stem
            warnings.append(f"{name}: no title in frontmatter; using '{title}'")

        slug = slugify(path.stem)
        if slug in slugs:
            n = 2
            while f"{slug}-{n}" in slugs:
                n += 1
            slug = f"{slug}-{n}"
        slugs.add(slug)

        metrics = meta.get("metrics", {})
        if not isinstance(metrics, dict):
            metrics = {}

        words = len(re.findall(r"\w+", body))
        articles.append({
            "slug": slug,
            "title": title,
            "date": date,
            "company": str(meta.get("company", "")).strip(),
            "ticker": str(meta.get("ticker", "")).strip(),
            "sector": str(meta.get("sector", "")).strip(),
            "tags": as_list(meta.get("tags", [])),
            "summary": str(meta.get("summary", "")).strip(),
            "author": str(meta.get("author", "")).strip(),
            "metrics": {str(k): str(v) for k, v in metrics.items()},
            "minutes": max(1, math.ceil(words / 220)),
            "body": body.strip(),
        })
        if not meta.get("summary"):
            warnings.append(f"{name}: no 'summary' (shown on the article card)")

    articles.sort(key=lambda a: (a["date"], a["slug"]), reverse=True)
    data = {"config": load_config(), "articles": articles}
    OUT_FILE.write_text(
        "/* Generated by publish.py. Do not edit by hand. */\n"
        "window.SITE_DATA = " + json.dumps(data, ensure_ascii=True, indent=1) + ";\n",
        encoding="utf-8",
    )

    print(f"Published {len(articles)} article(s)" + (f", skipped {drafts} draft(s)" if drafts else "") + ".")
    for w in warnings:
        print("  note:", w)
    print(f"Wrote {OUT_FILE.relative_to(ROOT)}. Open index.html to view the site.")


def new_article(title):
    ARTICLES_DIR.mkdir(exist_ok=True)
    today = datetime.date.today().isoformat()
    path = ARTICLES_DIR / f"{today}-{slugify(title)}.md"
    if path.exists():
        sys.exit(f"{path.name} already exists.")
    template = TEMPLATE_FILE.read_text(encoding="utf-8") if TEMPLATE_FILE.exists() else "---\ntitle: \"{{TITLE}}\"\ndate: {{DATE}}\ndraft: true\n---\n\n## Overview\n"
    path.write_text(template.replace("{{TITLE}}", title.replace('"', "'")).replace("{{DATE}}", today), encoding="utf-8")
    print(f"Created {path.relative_to(ROOT)}")
    print("Write the article, remove the 'draft: true' line, then run: python3 publish.py")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "new":
        new_article(" ".join(sys.argv[2:]))
    elif len(sys.argv) == 1:
        build()
    else:
        sys.exit(__doc__)
