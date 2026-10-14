/*
 * Tiny dependency-free Markdown renderer for the financial articles site.
 *
 * Supports: headings, paragraphs, bold/italic/strikethrough, inline code, code fences,
 * links, images, blockquotes, nested bullet/numbered lists, tables (with alignment),
 * horizontal rules, and ```chart blocks (placeholders that charts.js mounts as interactive charts).
 *
 * All text is HTML-escaped first, so article content can never inject scripts.
 */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function slugify(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  }

  function safeUrl(u) {
    return /^\s*(javascript|data|vbscript):/i.test(u) ? "#" : u;
  }

  /* ---------- Inline ---------- */
  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, src) {
      return '<img src="' + safeUrl(src) + '" alt="' + alt + '" loading="lazy">';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, u) {
      var ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return '<a href="' + safeUrl(u) + '"' + ext + ">" + t + "</a>";
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, n) {
      return "<code>" + esc(codes[+n]) + "</code>";
    });
    return s;
  }

  /* ---------- Tables ---------- */
  function splitRow(l) {
    l = l.trim();
    if (l[0] === "|") l = l.slice(1);
    if (l.endsWith("|") && l[l.length - 2] !== "\\") l = l.slice(0, -1);
    var cells = [], cur = "";
    for (var i = 0; i < l.length; i++) {
      var ch = l[i];
      if (ch === "\\" && l[i + 1] === "|") { cur += "|"; i++; }
      else if (ch === "|") { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  var SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function tableHtml(head, sep, rows) {
    var aligns = splitRow(sep).map(function (c) {
      var l = c.startsWith(":"), r = c.endsWith(":");
      return l && r ? "center" : r ? "right" : l ? "left" : "";
    });
    function cell(tag, text, i) {
      var a = aligns[i] ? ' style="text-align:' + aligns[i] + '"' : "";
      return "<" + tag + a + ">" + inline(text) + "</" + tag + ">";
    }
    var h = "<thead><tr>" + splitRow(head).map(function (c, i) { return cell("th", c, i); }).join("") + "</tr></thead>";
    var b = "<tbody>" + rows.map(function (r) {
      return "<tr>" + splitRow(r).map(function (c, i) { return cell("td", c, i); }).join("") + "</tr>";
    }).join("") + "</tbody>";
    return '<div class="table-wrap"><table>' + h + b + "</table></div>";
  }

  /* ---------- Lists ---------- */
  var LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function listHtml(lines, start) {
    var items = [], i = start;
    while (i < lines.length) {
      var m = lines[i].match(LIST_RE);
      if (!m) break;
      items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3] });
      i++;
    }
    var pos = 0;
    function build(base) {
      var tag = items[pos].ordered ? "ol" : "ul";
      var html = "<" + tag + ">";
      while (pos < items.length && items[pos].indent >= base) {
        if (items[pos].indent > base) {
          var nested = build(items[pos].indent);
          html = /<\/li>$/.test(html) ? html.replace(/<\/li>$/, nested + "</li>") : html + "<li>" + nested + "</li>";
          continue;
        }
        html += "<li>" + inline(items[pos].text) + "</li>";
        pos++;
      }
      return html + "</" + tag + ">";
    }
    var out = "";
    while (pos < items.length) out += build(items[pos].indent);
    return { html: out, next: i };
  }

  /* ---------- Charts ---------- */
  // Chart blocks become placeholders; charts.js turns them into interactive SVG charts.
  function chartHost(spec) {
    return '<div class="chart-host" data-chart="' + esc(JSON.stringify(spec)) + '"></div>';
  }

  /* ---------- Blocks ---------- */
  function isBlockStart(line) {
    return /^(#{1,6}\s|```|>)/.test(line) || LIST_RE.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line);
  }

  function render(src) {
    var lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    var out = [], seen = {}, i = 0, m;

    while (i < lines.length) {
      var line = lines[i];

      if (!line.trim()) { i++; continue; }

      // fenced code / chart
      if ((m = line.match(/^```\s*(\w*)\s*$/))) {
        var lang = m[1].toLowerCase(), buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        if (lang === "chart") {
          try { out.push(chartHost(JSON.parse(buf.join("\n")))); }
          catch (e) { out.push('<p class="err">Chart error: ' + esc(e.message) + "</p>"); }
        } else {
          out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        }
        continue;
      }

      // heading
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        var lvl = m[1].length, base = slugify(m[2]), id = base, k = 2;
        while (seen[id]) id = base + "-" + k++;
        seen[id] = 1;
        out.push("<h" + lvl + ' id="' + id + '">' + inline(m[2]) + "</h" + lvl + ">");
        i++;
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

      // table
      if (line.indexOf("|") >= 0 && i + 1 < lines.length && SEP_RE.test(lines[i + 1]) && lines[i + 1].indexOf("-") >= 0) {
        var head = line, sep = lines[i + 1], rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") >= 0) { rows.push(lines[i]); i++; }
        out.push(tableHtml(head, sep, rows));
        continue;
      }

      // blockquote
      if (/^>/.test(line)) {
        var q = [];
        while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
        out.push("<blockquote>" + render(q.join("\n")) + "</blockquote>");
        continue;
      }

      // list
      if (LIST_RE.test(line)) {
        var res = listHtml(lines, i);
        out.push(res.html);
        i = res.next;
        continue;
      }

      // paragraph
      var p = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) &&
             !(lines[i].indexOf("|") >= 0 && i + 1 < lines.length && SEP_RE.test(lines[i + 1]))) {
        p.push(lines[i]);
        i++;
      }
      out.push("<p>" + inline(p.join(" ")) + "</p>");
    }
    return out.join("\n");
  }

  global.MD = { render: render, esc: esc };
})(window);
