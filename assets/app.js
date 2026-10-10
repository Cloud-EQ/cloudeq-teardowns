/*
 * Site logic: list page with search + filters, article page with metrics and
 * table of contents. Reads everything from window.SITE_DATA (written by publish.py).
 */
(function () {
  "use strict";

  var D = window.SITE_DATA;
  var app = document.getElementById("app");
  var esc = MD.esc;

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  } catch (e) { /* storage unavailable: follow system theme */ }

  document.getElementById("themeBtn").addEventListener("click", function () {
    var current = root.getAttribute("data-theme") ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* ignore */ }
  });

  if (!D) {
    app.innerHTML = '<div class="notice"><h2>No articles built yet</h2>' +
      "<p>Run <code>python3 publish.py</code> in the site folder, then reload this page.</p></div>";
    return;
  }

  var cfg = D.config || {};
  var A = (D.articles || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });

  document.getElementById("brand").textContent = cfg.title || "Financial Breakdowns";
  document.getElementById("disclaimer").textContent = cfg.disclaimer || "";
  document.getElementById("copyright").textContent =
    "© " + new Date().getFullYear() + " " + (cfg.author || cfg.title || "");

  /* ---------- Helpers ---------- */
  function fmtDate(s) {
    var d = new Date(s + "T12:00:00");
    return isNaN(d) ? s : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  function prettyKey(k) {
    return String(k).replace(/[_-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function tone(v) {
    v = String(v).trim();
    if (/^\+/.test(v)) return " pos";
    if (/^[-−–]/.test(v)) return " neg";
    return "";
  }

  function kicker(a) {
    return [a.company, a.ticker, a.sector].filter(Boolean).map(esc).join(" · ");
  }

  A.forEach(function (a) {
    a._hay = [a.title, a.company, a.ticker, a.sector, a.summary, (a.tags || []).join(" "), a.body]
      .join(" ").toLowerCase();
  });

  /* ---------- Home ---------- */
  var state = { q: "", sector: "", tag: "" };

  function showHome() {
    document.title = cfg.title || "Financial Breakdowns";
    var sectors = Array.from(new Set(A.map(function (a) { return a.sector; }).filter(Boolean))).sort();
    var counts = {};
    A.forEach(function (a) { (a.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x] || x.localeCompare(y); }).slice(0, 16);

    app.innerHTML =
      '<section class="hero"><h1>' + esc(cfg.title || "") + "</h1><p>" + esc(cfg.tagline || "") + "</p></section>" +
      '<div class="controls">' +
        '<input id="q" type="search" placeholder="Search companies, tickers, topics…" aria-label="Search articles" value="' + esc(state.q) + '">' +
        (sectors.length
          ? '<select id="sector" aria-label="Filter by sector"><option value="">All sectors</option>' +
            sectors.map(function (s) {
              return '<option value="' + esc(s) + '"' + (s === state.sector ? " selected" : "") + ">" + esc(s) + "</option>";
            }).join("") + "</select>"
          : "") +
      "</div>" +
      '<div class="chips" id="chips"></div>' +
      '<p class="count" id="count"></p>' +
      '<div class="grid" id="list"></div>';

    function update() {
      var q = state.q.trim().toLowerCase();
      var words = q ? q.split(/\s+/) : [];
      var res = A.filter(function (a) {
        if (state.sector && a.sector !== state.sector) return false;
        if (state.tag && (a.tags || []).indexOf(state.tag) < 0) return false;
        return words.every(function (w) { return a._hay.indexOf(w) >= 0; });
      });

      document.getElementById("chips").innerHTML = tags.map(function (t) {
        return '<button type="button" class="chip' + (t === state.tag ? " on" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
      }).join("");

      document.getElementById("count").textContent =
        res.length === A.length ? A.length + (A.length === 1 ? " article" : " articles")
                                : res.length + " of " + A.length + " articles";

      document.getElementById("list").innerHTML = res.length ? res.map(card).join("") :
        '<p class="empty">No articles match your search.</p>';
    }

    document.getElementById("q").addEventListener("input", function (e) { state.q = e.target.value; update(); });
    var sel = document.getElementById("sector");
    if (sel) sel.addEventListener("change", function (e) { state.sector = e.target.value; update(); });
    document.getElementById("chips").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tag]");
      if (!b) return;
      state.tag = state.tag === b.getAttribute("data-tag") ? "" : b.getAttribute("data-tag");
      update();
    });
    update();
  }

  function card(a) {
    var mini = Object.keys(a.metrics || {}).slice(0, 3).map(function (k) {
      return '<div><span class="ml">' + esc(prettyKey(k)) + '</span><span class="mv' + tone(a.metrics[k]) + '">' + esc(a.metrics[k]) + "</span></div>";
    }).join("");
    return '<a class="card" href="#/article/' + encodeURIComponent(a.slug) + '">' +
      '<span class="date">' + esc(fmtDate(a.date)) + " · " + a.minutes + " min read</span>" +
      (kicker(a) ? '<p class="kicker">' + kicker(a) + "</p>" : "") +
      "<h2>" + esc(a.title) + "</h2>" +
      (a.summary ? '<p class="sum">' + esc(a.summary) + "</p>" : "") +
      (mini ? '<div class="mini">' + mini + "</div>" : "") +
      "</a>";
  }

  /* ---------- Article ---------- */
  function showArticle(slug) {
    var i = A.findIndex(function (a) { return a.slug === slug; });
    if (i < 0) {
      document.title = "Not found — " + (cfg.title || "");
      app.innerHTML = '<div class="notice"><h2>Article not found</h2><p><a href="#/">Back to all articles</a></p></div>';
      return;
    }
    var a = A[i];
    document.title = a.title + " — " + (cfg.title || "");
    var html = MD.render(a.body);

    var toc = [], re = /<h2 id="([^"]+)">(.*?)<\/h2>/g, m;
    while ((m = re.exec(html))) toc.push({ id: m[1], text: m[2].replace(/<[^>]+>/g, "") });

    var metrics = Object.keys(a.metrics || {}).map(function (k) {
      return '<div class="metric"><span class="ml">' + esc(prettyKey(k)) + '</span><span class="mv' + tone(a.metrics[k]) + '">' + esc(a.metrics[k]) + "</span></div>";
    }).join("");

    var newer = A[i - 1], older = A[i + 1];
    var author = a.author || cfg.author;

    app.innerHTML =
      '<a class="back" href="#/">← All articles</a>' +
      '<header class="a-head">' +
        (kicker(a) ? '<p class="kicker">' + kicker(a) + "</p>" : "") +
        "<h1>" + esc(a.title) + "</h1>" +
        (a.summary ? '<p class="dek">' + esc(a.summary) + "</p>" : "") +
        '<p class="byline">' + esc(fmtDate(a.date)) + " · " + a.minutes + " min read" + (author ? " · " + esc(author) : "") + "</p>" +
      "</header>" +
      (metrics ? '<div class="metrics">' + metrics + "</div>" : "") +
      '<div class="a-layout' + (toc.length >= 3 ? " has-toc" : "") + '">' +
        '<article class="prose">' + html + "</article>" +
        (toc.length >= 3
          ? '<aside class="toc"><h3>On this page</h3><ul>' +
            toc.map(function (t) { return '<li><a href="#/article/' + encodeURIComponent(a.slug) + '" data-jump="' + esc(t.id) + '">' + esc(t.text) + "</a></li>"; }).join("") +
            "</ul></aside>"
          : "") +
      "</div>" +
      '<nav class="pager">' +
        (older ? '<a href="#/article/' + encodeURIComponent(older.slug) + '"><small>← Older</small>' + esc(older.title) + "</a>" : "<span></span>") +
        (newer ? '<a class="next" href="#/article/' + encodeURIComponent(newer.slug) + '"><small>Newer →</small>' + esc(newer.title) + "</a>" : "<span></span>") +
      "</nav>";
  }

  /* ---------- Routing ---------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, "");
    if (h.indexOf("article/") === 0) showArticle(decodeURIComponent(h.slice(8)));
    else showHome();
    window.scrollTo(0, 0);
  }

  // In-page jumps from the table of contents (keeps the hash router untouched)
  app.addEventListener("click", function (e) {
    var j = e.target.closest("[data-jump]");
    if (!j) return;
    e.preventDefault();
    var el = document.getElementById(j.getAttribute("data-jump"));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  window.addEventListener("hashchange", route);
  route();
})();
