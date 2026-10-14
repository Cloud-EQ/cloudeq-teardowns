/*
 * Interactive charts for the financial articles site. No dependencies.
 *
 * markdown.js turns every ```chart block into <div class="chart-host" data-chart="...JSON...">.
 * Charts.mountAll(root) then upgrades each one:
 *   - "bar" / "line": hover, tap or the arrow keys show a tooltip; legend buttons hide or show a series.
 *   - "financials": a card with metric tabs and a Yearly / Quarterly switch.
 *
 * Charts are drawn as SVG at the real pixel width of their container, so text never shrinks on phones.
 * Colours come from CSS variables, so charts follow the site theme.
 */
(function (global) {
  "use strict";

  /* ---------- Helpers ---------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Escaped text, with [label](https://...) links allowed
  function srcHtml(s) {
    return esc(s).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function r1(n) { return +n.toFixed(1); }

  function isPct(unit) { return /^\s*%/.test(unit || ""); }

  function fmtNum(v, dec) {
    v = Number(v);
    if (typeof dec === "number") {
      return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    if (Math.abs(v) >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return String(+v.toFixed(2));
  }

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

  function checkSeries(labels, series) {
    if (!Array.isArray(labels) || !labels.length || !Array.isArray(series) || !series.length) {
      throw new Error('chart needs "labels" and "series"');
    }
    series.forEach(function (s) {
      if (!Array.isArray(s.values) || s.values.length !== labels.length) {
        throw new Error('series "' + (s.name || "?") + '" needs exactly one value per label');
      }
      s.values.forEach(function (v) {
        if (typeof v !== "number" || !isFinite(v)) throw new Error('series "' + (s.name || "?") + '" has a value that is not a number');
      });
    });
  }

  /* ---------- Drawing ---------- */
  // o: { type, labels, series[{values, cls, hidden}], W, H, active, zero, area, values, yFmt, valFmt, left }
  function draw(o) {
    var n = o.labels.length;
    var vis = o.series.filter(function (s) { return !s.hidden; });
    var m = { t: 16, r: 14, b: 32, l: o.left || 50 };
    var W = o.W, H = o.H;
    var pw = W - m.l - m.r, ph = H - m.t - m.b, gw = pw / n;

    var all = [];
    vis.forEach(function (s) { all = all.concat(s.values); });
    if (!all.length) all = [0, 1];
    var forceZero = o.type === "bar" || o.zero;
    var pool = forceZero ? all.concat([0]) : all;
    var ticks = niceTicks(Math.min.apply(null, pool), Math.max.apply(null, pool));
    var lo = ticks[0], hi = ticks[ticks.length - 1];

    function y(v) { return r1(m.t + ph - ((v - lo) / (hi - lo)) * ph); }
    function xc(i) { return r1(m.l + gw * i + gw / 2); }

    var s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true" focusable="false">';

    // grid + y labels
    ticks.forEach(function (t) {
      s += '<line class="gl' + (t === 0 ? " zero" : "") + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>';
      s += '<text class="ax" x="' + (m.l - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + esc(o.yFmt(t)) + "</text>";
    });

    // x labels, thinned to fit and anchored on the latest period
    var maxLab = 0;
    o.labels.forEach(function (l) { maxLab = Math.max(maxLab, String(l).length); });
    var every = Math.max(1, Math.ceil((maxLab * 6.6 + 12) / gw));
    o.labels.forEach(function (l, i) {
      if ((n - 1 - i) % every === 0) {
        s += '<text class="ax" x="' + xc(i) + '" y="' + (m.t + ph + 20) + '" text-anchor="middle">' + esc(l) + "</text>";
      }
    });

    // active highlight sits behind the data
    if (o.active >= 0) {
      if (o.type === "bar") {
        s += '<rect class="c-band" x="' + r1(m.l + gw * o.active) + '" y="' + m.t + '" width="' + r1(gw) + '" height="' + ph + '" rx="4"/>';
      } else {
        s += '<line class="c-cross" x1="' + xc(o.active) + '" x2="' + xc(o.active) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '"/>';
      }
    }

    // value labels only when they fit
    var lw = 0, k = vis.length || 1;
    vis.forEach(function (sr) { sr.values.forEach(function (v) { lw = Math.max(lw, o.valFmt(v).length); }); });
    lw = lw * 6.4 + 6;
    var showVals = o.values !== false && (o.type === "bar" ? gw / k >= lw : vis.length === 1 && gw >= lw);

    if (o.type === "bar") {
      var bw = Math.min(56, (gw * 0.74) / k), gap = k > 1 ? 3 : 0, total = bw * k + gap * (k - 1);
      vis.forEach(function (sr, vi) {
        sr.values.forEach(function (v, i) {
          var x = m.l + gw * i + (gw - total) / 2 + vi * (bw + gap);
          var y0 = y(0), y1 = y(v);
          var dim = o.active >= 0 && i !== o.active ? " dim" : "";
          s += '<rect class="b s' + sr.cls + dim + '" x="' + r1(x) + '" y="' + Math.min(y0, y1) + '" width="' + r1(bw) +
            '" height="' + r1(Math.max(Math.abs(y1 - y0), 0.5)) + '" rx="2"/>';
          if (showVals) {
            s += '<text class="vl" x="' + r1(x + bw / 2) + '" y="' + (v >= 0 ? y1 - 5 : y1 + 14) + '" text-anchor="middle">' + esc(o.valFmt(v)) + "</text>";
          }
        });
      });
    } else {
      vis.forEach(function (sr) {
        var pts = sr.values.map(function (v, i) { return xc(i) + "," + y(v); });
        if (o.area) {
          s += '<polygon class="ar s' + sr.cls + '" points="' + xc(0) + "," + (m.t + ph) + " " + pts.join(" ") + " " + xc(n - 1) + "," + (m.t + ph) + '"/>';
        }
        s += '<polyline class="ln s' + sr.cls + '" points="' + pts.join(" ") + '"/>';
        sr.values.forEach(function (v, i) {
          s += '<circle class="dot s' + sr.cls + '" cx="' + xc(i) + '" cy="' + y(v) + '" r="' + (i === o.active ? 6 : 3.5) + '"/>';
          if (showVals) {
            s += '<text class="vl" x="' + xc(i) + '" y="' + (y(v) - 10) + '" text-anchor="middle">' + esc(o.valFmt(v)) + "</text>";
          }
        });
      });
    }

    return { svg: s + "</svg>", m: m, gw: gw, n: n, xc: xc, y: y };
  }

  /* ---------- Interaction shared by every chart ---------- */
  // cfg: { draw(active, W, H) -> result, tip(i) -> html, anchorY(i, res) -> px | null, onActive(i) }
  function makePlot(plot, cfg) {
    var svgBox = plot.querySelector(".c-svg");
    var tip = plot.querySelector(".c-tip");
    var active = -1, res = null, W = 0, H = 0;

    function measure() {
      W = Math.max(260, Math.round(plot.clientWidth || 600));
      H = W < 480 ? 240 : 280;
    }

    function placeTip() {
      if (active < 0 || !res) { tip.className = "c-tip"; return; }
      tip.innerHTML = cfg.tip(active);
      tip.className = "c-tip on";
      var tw = tip.offsetWidth, th = tip.offsetHeight, x = res.xc(active);
      var left = x + 14;
      if (left + tw > W - 4) left = x - tw - 14;
      left = Math.max(4, left);
      var top = res.m.t;
      var ay = cfg.anchorY ? cfg.anchorY(active, res) : null;
      if (ay != null) { top = ay - th - 12; if (top < 2) top = ay + 14; }
      top = Math.max(2, Math.min(top, H - th - 2));
      tip.style.left = Math.round(left) + "px";
      tip.style.top = Math.round(top) + "px";
    }

    function render() {
      measure();
      res = cfg.draw(active, W, H);
      svgBox.innerHTML = res.svg;
      placeTip();
      if (cfg.onActive) cfg.onActive(active);
    }

    function setActive(i) {
      if (i === active) return;
      active = i;
      render();
    }

    function idxFromEvent(e) {
      var r = svgBox.getBoundingClientRect();
      var x = e.clientX - r.left;
      if (x < res.m.l - 4 || x > W - res.m.r + 4) return -1;
      return Math.max(0, Math.min(res.n - 1, Math.floor((x - res.m.l) / res.gw)));
    }

    plot.addEventListener("pointermove", function (e) { setActive(idxFromEvent(e)); });
    plot.addEventListener("pointerdown", function (e) { setActive(idxFromEvent(e)); });
    plot.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") setActive(-1); });

    plot.addEventListener("keydown", function (e) {
      var n = res.n, i = active;
      if (e.key === "ArrowRight") i = i < 0 ? 0 : Math.min(n - 1, i + 1);
      else if (e.key === "ArrowLeft") i = i < 0 ? n - 1 : Math.max(0, i - 1);
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = n - 1;
      else if (e.key === "Escape") i = -1;
      else return;
      e.preventDefault();
      setActive(i);
    });
    plot.addEventListener("blur", function () { setActive(-1); });

    // a tap or click outside the chart clears the tooltip (touch keeps it after the finger lifts)
    // (the chart redraws on pointerdown, which detaches the touched element, so test the event path
    // recorded at dispatch time rather than e.target)
    function onDoc(e) {
      if (!plot.isConnected) { document.removeEventListener("pointerdown", onDoc); return; }
      var path = e.composedPath ? e.composedPath() : [];
      if (path.indexOf(plot) >= 0 || plot.contains(e.target)) return;
      setActive(-1);
    }
    document.addEventListener("pointerdown", onDoc);

    // redraw at the new pixel width when the container resizes
    function onResize() {
      var w = Math.round(plot.clientWidth);
      if (w && Math.abs(w - W) > 1) render();
    }
    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (!plot.isConnected) { ro.disconnect(); return; }
        onResize();
      });
      ro.observe(plot);
    } else {
      global.addEventListener("resize", onResize);
    }

    return {
      render: render,
      reset: function () { active = -1; render(); }
    };
  }

  function plotHtml(label) {
    return '<div class="c-plot" tabindex="0" role="group" aria-label="' + esc(label) +
      ' Interactive chart: hover, tap, or use the left and right arrow keys to read values.">' +
      '<div class="c-svg"></div><div class="c-tip" role="status"></div></div>';
  }

  /* ---------- Bar and line charts ---------- */
  function mountBasic(host, spec) {
    var type = spec.type === "line" ? "line" : "bar";
    var labels = spec.labels;
    checkSeries(labels, spec.series);

    var S = spec.series.map(function (s, i) {
      return { name: s.name || "Series " + (i + 1), values: s.values, cls: i % 5, hidden: false };
    });
    var unit = spec.unit || "", pct = isPct(unit);
    function f(v) { return fmtNum(v) + (pct ? "%" : ""); }

    var legend = "";
    if (S.length > 1) {
      legend = '<div class="c-legend">' + S.map(function (s, i) {
        return '<button type="button" class="c-lg" data-i="' + i + '" aria-pressed="true" title="Click to hide or show"><i class="sw s' + s.cls + '"></i>' + esc(s.name) + "</button>";
      }).join("") + "</div>";
    }

    host.innerHTML =
      '<figure class="chart">' +
        '<div class="c-head"><div>' +
          (spec.title ? '<span class="c-title">' + esc(spec.title) + "</span>" : "") +
          (unit ? '<span class="c-unit">' + esc(unit) + "</span>" : "") +
        '</div><span class="c-hint">Hover or tap for values</span></div>' +
        plotHtml(spec.title || "Chart.") + legend +
        (spec.source ? "<figcaption>" + srcHtml(spec.source) + "</figcaption>" : "") +
      "</figure>";

    var ctl = makePlot(host.querySelector(".c-plot"), {
      draw: function (active, W, H) {
        return draw({ type: type, labels: labels, series: S, W: W, H: H, active: active,
          zero: spec.zero === true, yFmt: f, valFmt: f });
      },
      tip: function (i) {
        var h = '<div class="t-h">' + esc(labels[i]) + "</div>";
        S.forEach(function (s) {
          if (s.hidden) return;
          h += '<div class="t-r"><i class="sw s' + s.cls + '"></i><span>' + esc(s.name) + "</span><b>" + esc(f(s.values[i])) + "</b></div>";
        });
        return h;
      },
      anchorY: type === "line" ? function (i, res) {
        var ys = S.filter(function (s) { return !s.hidden; }).map(function (s) { return res.y(s.values[i]); });
        return ys.length ? Math.min.apply(null, ys) : null;
      } : null
    });

    var lg = host.querySelector(".c-legend");
    if (lg) {
      lg.addEventListener("click", function (e) {
        var b = e.target.closest("[data-i]");
        if (!b) return;
        var i = +b.getAttribute("data-i");
        var visible = S.filter(function (s) { return !s.hidden; }).length;
        if (!S[i].hidden && visible === 1) return; // always keep one series on screen
        S[i].hidden = !S[i].hidden;
        b.setAttribute("aria-pressed", String(!S[i].hidden));
        ctl.render();
      });
    }
    ctl.render();
  }

  /* ---------- Financial Performance card ---------- */
  function mountFinancials(host, spec) {
    var periods = spec.periods || {}, metrics = spec.metrics || [];
    var freqs = ["yearly", "quarterly"].filter(function (k) {
      return periods[k] && Array.isArray(periods[k].labels) && periods[k].labels.length;
    });
    if (!metrics.length || !freqs.length) throw new Error('financials chart needs "periods" and "metrics"');
    metrics.forEach(function (mt) {
      if (!mt.label) throw new Error('every metric needs a "label"');
      freqs.forEach(function (k) {
        if (!Array.isArray(mt[k]) || mt[k].length !== periods[k].labels.length) {
          throw new Error('metric "' + mt.label + '" needs ' + periods[k].labels.length + " " + k + " values");
        }
        mt[k].forEach(function (v) {
          if (typeof v !== "number" || !isFinite(v)) throw new Error('metric "' + mt.label + '" has a ' + k + " value that is not a number");
        });
      });
    });

    var mi = 0, freq = freqs[0];
    if (spec.initialMetric) {
      metrics.forEach(function (mt, i) { if (mt.label.toLowerCase() === String(spec.initialMetric).toLowerCase()) mi = i; });
    }
    if (spec.initialFrequency && freqs.indexOf(spec.initialFrequency) >= 0) freq = spec.initialFrequency;

    var FREQ_NAME = { yearly: "Yearly", quarterly: "Quarterly" };
    var hasHead = !!(spec.title || spec.subtitle); // the heading is optional: leave both out for none

    host.innerHTML =
      '<figure class="chart fin">' +
        (hasHead
          ? '<div class="fin-head">' +
              (spec.title ? '<div class="fin-title">' + esc(spec.title) + "</div>" : "") +
              (spec.subtitle ? '<div class="fin-sub">' + esc(spec.subtitle) + "</div>" : "") + "</div>"
          : "") +
        '<div class="fin-tabs" role="tablist" aria-label="Metric"' + (hasHead ? "" : ' style="margin-top:0"') + ">" + metrics.map(function (mt, i) {
          return '<button type="button" role="tab" class="chip' + (i === mi ? " on" : "") + '" data-mi="' + i + '" aria-selected="' + (i === mi) + '">' + esc(mt.label) + "</button>";
        }).join("") + "</div>" +
        (freqs.length > 1 ? '<div class="fin-seg" role="group" aria-label="Period">' + freqs.map(function (k) {
          return '<button type="button" data-f="' + k + '" aria-pressed="' + (k === freq) + '">' + FREQ_NAME[k] + "</button>";
        }).join("") + "</div>" : "") +
        '<div class="fin-headline"><div class="fin-val"></div><div class="fin-meta"></div><div class="fin-chg"></div></div>' +
        plotHtml((spec.title || "Financial performance chart") + ".") +
        (spec.note ? "<figcaption>" + srcHtml(spec.note) + "</figcaption>" : "") +
      "</figure>";

    var elVal = host.querySelector(".fin-val"), elMeta = host.querySelector(".fin-meta"), elChg = host.querySelector(".fin-chg");

    function metric() { return metrics[mi]; }
    function vals() { return metric()[freq]; }
    function labels() { return periods[freq].labels; }
    function nameOf(i) { return (periods[freq].names && periods[freq].names[i]) || labels()[i]; }
    function fmtVal(v) {
      var mt = metric();
      return (mt.prefix || "") + fmtNum(v, mt.decimals == null ? 0 : mt.decimals) + (mt.suffix || "");
    }
    // change against the previous year (yearly) or the same quarter a year earlier (quarterly)
    function change(i) {
      var lag = freq === "quarterly" ? 4 : 1;
      if (i - lag < 0) return null;
      var cur = vals()[i], prev = vals()[i - lag], mt = metric(), amount, unit, signed;
      if (mt.change === "pts") {
        signed = cur - prev;
        amount = fmtNum(Math.abs(signed), 1);
        unit = " pts";
      } else {
        if (!prev) return null;
        signed = (cur / prev - 1) * 100;
        amount = Math.abs(signed).toFixed(1);
        unit = "%";
      }
      var zero = parseFloat(amount) === 0; // rounds to no change: neutral colour, no sign
      return {
        text: (zero ? "" : signed >= 0 ? "+" : "-") + amount + unit,
        cls: zero ? "" : signed >= 0 ? "pos" : "neg",
        vs: labels()[i - lag]
      };
    }
    function updateHeadline(active) {
      var i = active >= 0 ? active : labels().length - 1;
      var mt = metric();
      elVal.textContent = fmtVal(vals()[i]);
      elMeta.textContent = nameOf(i) + " · " + FREQ_NAME[freq] + (mt.unit ? " · " + mt.unit : "");
      var c = change(i);
      elChg.innerHTML = c
        ? '<span class="' + c.cls + '">' + esc(c.text) + '</span> <span class="vs">vs ' + esc(c.vs) + "</span>"
        : "&nbsp;";
    }

    var ctl = makePlot(host.querySelector(".c-plot"), {
      draw: function (active, W, H) {
        var mt = metric(), pct = isPct(mt.unit);
        return draw({
          type: "line", labels: labels(), W: W, H: H, active: active, area: true, values: false,
          series: [{ name: mt.label, values: vals(), cls: 0, hidden: false }],
          zero: mt.zero !== false,
          yFmt: function (v) { return fmtNum(v) + (pct ? "%" : ""); },
          valFmt: fmtVal
        });
      },
      tip: function (i) {
        var c = change(i);
        return '<div class="t-h">' + esc(nameOf(i)) + "</div>" +
          '<div class="t-r"><span>' + esc(metric().label) + "</span><b>" + esc(fmtVal(vals()[i])) + "</b></div>" +
          (c ? '<div class="t-chg"><span class="' + c.cls + '">' + esc(c.text) + "</span> vs " + esc(c.vs) + "</div>" : "");
      },
      anchorY: function (i, res) { return res.y(vals()[i]); },
      onActive: updateHeadline
    });

    host.querySelector(".fin-tabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-mi]");
      if (!b) return;
      mi = +b.getAttribute("data-mi");
      Array.prototype.forEach.call(host.querySelectorAll(".fin-tabs .chip"), function (el, i) {
        el.classList.toggle("on", i === mi);
        el.setAttribute("aria-selected", String(i === mi));
      });
      ctl.reset();
    });

    var seg = host.querySelector(".fin-seg");
    if (seg) {
      seg.addEventListener("click", function (e) {
        var b = e.target.closest("[data-f]");
        if (!b) return;
        freq = b.getAttribute("data-f");
        Array.prototype.forEach.call(seg.querySelectorAll("button"), function (el) {
          el.setAttribute("aria-pressed", String(el.getAttribute("data-f") === freq));
        });
        ctl.reset();
      });
    }
    ctl.render();
  }

  /* ---------- Mounting ---------- */
  function mount(host) {
    try {
      var spec = JSON.parse(host.getAttribute("data-chart"));
      if (spec.type === "financials") mountFinancials(host, spec);
      else mountBasic(host, spec);
    } catch (e) {
      host.innerHTML = '<p class="err">Chart error: ' + esc(e.message) + "</p>";
    }
  }

  function mountAll(root) {
    var hosts = root.querySelectorAll("[data-chart]");
    for (var i = 0; i < hosts.length; i++) mount(hosts[i]);
  }

  global.Charts = { mountAll: mountAll };
})(window);
