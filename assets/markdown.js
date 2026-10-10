/*
 * Tiny dependency-free Markdown renderer for the financial articles site.
 *
 * Supports: headings, paragraphs, bold/italic/strikethrough, inline code, code fences,
 * links, images, blockquotes, nested bullet/numbered lists, tables (with alignment),
 * horizontal rules, and ```chart blocks (bar / line charts drawn as inline SVG).
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
  function niceTicks(min, max) {
    if (min === max) max = min + 1;
    var span = max - min, step0 = span / 5;
    var mag = Math.pow(10, Math.floor(Math.log10(step0)));
    var norm = step0 / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (var v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
    return t;
  }

  function fmtNum(v) {
    if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return String(+v.toFixed(2));
  }

  function r1(n) { return +n.toFixed(1); }

  function renderChart(spec) {
    var type = spec.type === "line" ? "line" : "bar";
    var labels = spec.labels || [], series = spec.series || [];
    if (!labels.length || !series.length) throw new Error("chart needs \"labels\" and \"series\"");
    series.forEach(function (s) {
      if (!Array.isArray(s.values) || s.values.length !== labels.length)
        throw new Error('series "' + (s.name || "?") + '" needs exactly one value per label');
    });

    var W = 680, H = 340;
    var m = { t: spec.title ? 52 : 28, r: 24, b: series.length > 1 ? 76 : 48, l: 58 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var all = [].concat.apply([], series.map(function (s) { return s.values; }));
    // Bars always start at zero; lines fit the data unless "zero": true is set.
    var forceZero = type === "bar" || spec.zero === true;
    var dmin = Math.min.apply(null, forceZero ? [0].concat(all) : all);
    var dmax = Math.max.apply(null, forceZero ? [0].concat(all) : all);
    var ticks = niceTicks(dmin, dmax);
    var lo = ticks[0], hi = ticks[ticks.length - 1];
    function y(v) { return r1(m.t + ph - ((v - lo) / (hi - lo)) * ph); }
    var unit = spec.unit || "";
    var n = labels.length, gw = pw / n;

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(spec.title || "Chart") + '">';
    if (spec.title) svg += '<text class="ct" x="' + m.l + '" y="24">' + esc(spec.title) + "</text>";
    if (unit) svg += '<text class="ax" x="' + m.l + '" y="' + (m.t - 10) + '">' + esc(unit) + "</text>";

    ticks.forEach(function (t) {
      svg += '<line class="grid' + (t === 0 ? " zero" : "") + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>';
      svg += '<text class="ax" x="' + (m.l - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmtNum(t) + "</text>";
    });
    labels.forEach(function (l, i) {
      svg += '<text class="ax" x="' + r1(m.l + gw * i + gw / 2) + '" y="' + (m.t + ph + 20) + '" text-anchor="middle">' + esc(l) + "</text>";
    });

    if (type === "bar") {
      var bw = Math.min(56, (gw * 0.74) / series.length), gap = 3;
      var total = bw * series.length + gap * (series.length - 1);
      series.forEach(function (s, si) {
        s.values.forEach(function (v, i) {
          var x = m.l + gw * i + (gw - total) / 2 + si * (bw + gap);
          var y0 = y(0), y1 = y(v);
          svg += '<rect class="b s' + (si % 5) + '" x="' + r1(x) + '" y="' + Math.min(y0, y1) + '" width="' + r1(bw) +
            '" height="' + r1(Math.max(Math.abs(y1 - y0), 0.5)) + '" rx="2"><title>' + esc(s.name || "") + " " + esc(labels[i]) +
            ": " + fmtNum(v) + esc(unit) + "</title></rect>";
          if (n * series.length <= 12) {
            svg += '<text class="vl" x="' + r1(x + bw / 2) + '" y="' + (v >= 0 ? y1 - 5 : y1 + 14) + '" text-anchor="middle">' + fmtNum(v) + "</text>";
          }
        });
      });
    } else {
      series.forEach(function (s, si) {
        var pts = s.values.map(function (v, i) { return r1(m.l + gw * i + gw / 2) + "," + y(v); });
        svg += '<polyline class="ln s' + (si % 5) + '" points="' + pts.join(" ") + '"/>';
        s.values.forEach(function (v, i) {
          var cx = r1(m.l + gw * i + gw / 2);
          svg += '<circle class="dot s' + (si % 5) + '" cx="' + cx + '" cy="' + y(v) + '" r="4"><title>' + esc(s.name || "") + " " +
            esc(labels[i]) + ": " + fmtNum(v) + esc(unit) + "</title></circle>";
          if (series.length === 1 && n <= 8) {
            svg += '<text class="vl" x="' + cx + '" y="' + (y(v) - 10) + '" text-anchor="middle">' + fmtNum(v) + "</text>";
          }
        });
      });
    }

    if (series.length > 1) {
      var lx = m.l, ly = H - 14;
      series.forEach(function (s, si) {
        var name = s.name || "Series " + (si + 1);
        svg += '<rect class="lg s' + (si % 5) + '" x="' + lx + '" y="' + (ly - 10) + '" width="12" height="12" rx="2"/>';
        svg += '<text class="ax" x="' + (lx + 18) + '" y="' + ly + '">' + esc(name) + "</text>";
        lx += 18 + name.length * 7 + 22;
      });
    }
    svg += "</svg>";

    var cap = spec.source ? "<figcaption>" + inline(String(spec.source)) + "</figcaption>" : "";
    return '<figure class="chart">' + svg + cap + "</figure>";
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
          try { out.push(renderChart(JSON.parse(buf.join("\n")))); }
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
