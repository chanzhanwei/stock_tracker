(function () {
  "use strict";

  var score = function () { return window.STLedgerScore; };
  var feed = function () { return window.STLedgerFeed.feed; };
  var view = {
    page: "feed",
    metric: "weighted",
    tab: "points",
    query: "",
    allowMock: false,
    filters: { kind: "", sector: "", action: "", excluded: "any", mechanical: "any" },
  };
  var root = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function readWatch() {
    try {
      var raw = JSON.parse(localStorage.getItem("ledger.watchlist") || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.filter(function (ticker) { return typeof ticker === "string" && ticker; });
    } catch (err) {
      return [];
    }
  }

  function writeWatch(list) {
    localStorage.setItem("ledger.watchlist", JSON.stringify(list));
  }

  function watchHas(ticker) {
    return readWatch().indexOf(ticker) >= 0;
  }

  function toggleWatch(ticker) {
    var list = readWatch();
    var index = list.indexOf(ticker);
    if (index >= 0) list.splice(index, 1);
    else list.push(ticker);
    writeWatch(list);
  }

  function matchesQuery(item) {
    var q = view.query.trim().toLowerCase();
    if (!q) return true;
    return item.ticker.toLowerCase().indexOf(q) >= 0 || String(item.holder).toLowerCase().indexOf(q) >= 0;
  }

  function matchesFilters(item) {
    var filters = view.filters;
    if (filters.kind && item.kind !== filters.kind) return false;
    if (filters.sector && item.sector !== filters.sector) return false;
    if (filters.action && item.action !== filters.action) return false;
    if (filters.excluded === "yes" && !item.excluded) return false;
    if (filters.excluded === "no" && item.excluded) return false;
    var mechanical = score().isMechanical(item);
    if (filters.mechanical === "yes" && !mechanical) return false;
    if (filters.mechanical === "no" && mechanical) return false;
    return true;
  }

  function shownFeed() {
    return view.allowMock ? feed() : [];
  }

  function spineItems() {
    var rows = shownFeed().filter(function (item) { return matchesQuery(item) && matchesFilters(item); });
    if (view.page === "watch") {
      var saved = readWatch();
      rows = rows.filter(function (item) { return saved.indexOf(item.ticker) >= 0; });
    }
    return rows;
  }

  function navButton(id, label) {
    var button = el("button", "ghost", label);
    button.type = "button";
    button.setAttribute("aria-pressed", view.page === id ? "true" : "false");
    button.addEventListener("click", function () {
      view.page = id;
      render();
    });
    return button;
  }

  function header() {
    var bar = el("div", "ledger-head");
    var brand = el("div", "ledger-brand");
    brand.appendChild(el("span", "ledger-mark"));
    brand.appendChild(el("strong", null, "Institution"));
    bar.appendChild(brand);
    if (view.allowMock) bar.appendChild(el("span", "ledger-pill", "Fixture tape"));
    var nav = el("nav", "ledger-nav");
    nav.appendChild(navButton("feed", "Feed"));
    nav.appendChild(navButton("watch", "Watchlist"));
    nav.appendChild(navButton("info", "Methodology"));
    bar.appendChild(nav);
    return bar;
  }

  function note() {
    var text = "Not financial advice.";
    if (view.allowMock) text += " Illustrative scores from weight table " + score().modelVersion + ". " + window.STLedgerFeed.label;
    else text += " Institutional data is off.";
    return el("p", "ledger-note", text);
  }

  function metricToggle() {
    var wrap = el("div", "ledger-metrics");
    ["weighted", "count", "dollar"].forEach(function (metric) {
      var button = el("button", "ghost", metric);
      button.type = "button";
      button.setAttribute("aria-pressed", view.metric === metric ? "true" : "false");
      button.addEventListener("click", function () {
        view.metric = metric;
        paintSummary();
        Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (elButton) {
          elButton.setAttribute("aria-pressed", elButton === button ? "true" : "false");
        });
      });
      wrap.appendChild(button);
    });
    return wrap;
  }

  function legend() {
    var row = el("div", "ledger-legend");
    Object.keys(score().SECTOR_COLORS).forEach(function (name) {
      var item = el("span");
      var swatch = el("i", "ledger-swatch");
      swatch.style.background = score().sectorColor(name);
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(name));
      row.appendChild(item);
    });
    return row;
  }

  function chartSvg(points) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 640 220");
    svg.setAttribute("class", "ledger-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Cumulative sector step chart");
    var sectors = points.length ? Object.keys(points[0].values) : [];
    var values = [];
    points.forEach(function (point) {
      sectors.forEach(function (name) { values.push(point.values[name]); });
    });
    var min = 0;
    var max = 0;
    values.forEach(function (value) {
      if (value < min) min = value;
      if (value > max) max = value;
    });
    if (min === max) max = min + 1;
    function xOf(i) { return 36 + (i / 30) * 590; }
    function yOf(value) { return 12 + (1 - (value - min) / (max - min)) * 168; }
    var dates = chartDates();
    var grid = document.createElementNS("http://www.w3.org/2000/svg", "line");
    grid.setAttribute("x1", "36");
    grid.setAttribute("x2", "626");
    grid.setAttribute("y1", String(yOf(0)));
    grid.setAttribute("y2", String(yOf(0)));
    grid.setAttribute("stroke", "#1F2830");
    svg.appendChild(grid);
    sectors.forEach(function (name) {
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      var d = "";
      points.forEach(function (point, i) {
        var x = xOf(i);
        var y = yOf(point.values[name]);
        d += i === 0 ? "M " + x.toFixed(2) + " " + y.toFixed(2) : " H " + x.toFixed(2) + " V " + y.toFixed(2);
      });
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", score().sectorColor(name));
      path.setAttribute("stroke-width", "2");
      svg.appendChild(path);
    });
    svg.appendChild(chartDateLabel(dates.start, 36, "start"));
    svg.appendChild(chartDateLabel(dates.end, 626, "end"));
    return svg;
  }

  function chartDates() {
    var end = new Date();
    var start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 30);
    function fmt(date) {
      return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }
    return { start: fmt(start), end: fmt(end) };
  }

  function chartDateLabel(text, x, anchor) {
    var label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", "214");
    label.setAttribute("fill", "#9aa0a8");
    label.setAttribute("font-size", "12");
    label.setAttribute("font-family", "Outfit, Avenir Next, Segoe UI, sans-serif");
    label.setAttribute("text-anchor", anchor);
    label.textContent = text;
    return label;
  }

  function summaryBlock() {
    var panel = el("section", "ledger-panel");
    panel.id = "ledger-summary";
    panel.appendChild(el("p", "eyebrow", "Industry summary"));
    panel.appendChild(metricToggle());
    panel.appendChild(legend());
    var chartHost = el("div");
    chartHost.id = "ledger-chart";
    panel.appendChild(chartHost);
    var rows = el("div");
    rows.id = "ledger-sectors";
    panel.appendChild(rows);
    return panel;
  }

  function paintSummary() {
    var chartHost = document.getElementById("ledger-chart");
    var rows = document.getElementById("ledger-sectors");
    if (!chartHost || !rows) return;
    if (!view.allowMock) {
      chartHost.textContent = "";
      chartHost.removeAttribute("data-lines");
      rows.textContent = "";
      rows.appendChild(el("p", "ledger-fine", "Institutional data is off."));
      return;
    }
    var points = score().trendSeries(feed(), view.metric);
    chartHost.textContent = "";
    chartHost.appendChild(chartSvg(points));
    var lines = chartHost.querySelectorAll("path");
    chartHost.setAttribute("data-lines", String(lines.length));
    rows.textContent = "";
    score().sectorRollup(feed(), view.metric).forEach(function (row) {
      var line = el("div", "ledger-sector");
      var name = el("span");
      var swatch = el("i", "ledger-swatch");
      swatch.style.background = score().sectorColor(row.sector);
      name.appendChild(swatch);
      name.appendChild(document.createTextNode(" " + row.sector));
      var figures = el("span");
      figures.appendChild(document.createTextNode(score().formatTotal(row.total, view.metric) + " "));
      var momentum = el("span", row.momentum >= 0 ? "ledger-up" : "ledger-down", (row.momentum >= 0 ? "↑ " : "↓ ") + score().formatTotal(row.momentum, view.metric) + " vs prior 15d");
      figures.appendChild(momentum);
      line.appendChild(name);
      line.appendChild(figures);
      rows.appendChild(line);
    });
  }

  function selectFilter(name, label, options) {
    var wrap = el("label", "ledger-filter");
    wrap.appendChild(el("span", "ledger-meta", label));
    var select = document.createElement("select");
    options.forEach(function (option) {
      var node = document.createElement("option");
      node.value = option[0];
      node.textContent = option[1];
      if (view.filters[name] === option[0]) node.selected = true;
      select.appendChild(node);
    });
    select.addEventListener("change", function () {
      view.filters[name] = select.value;
      paintSpine();
    });
    wrap.appendChild(select);
    return wrap;
  }

  function filters() {
    var row = el("div", "ledger-filters");
    var search = document.createElement("input");
    search.className = "ledger-search";
    search.type = "search";
    search.placeholder = "Ticker or holder";
    search.setAttribute("aria-label", "Search ticker or holder");
    search.value = view.query;
    search.addEventListener("input", function () {
      view.query = search.value;
      paintSpine();
    });
    row.appendChild(search);
    var kinds = [["", "Any kind"]].concat(score().KIND_ORDER.map(function (kind) { return [kind, kind]; }));
    var sectors = [["", "Any sector"]].concat(Object.keys(score().SECTOR_COLORS).map(function (name) { return [name, name]; }));
    row.appendChild(selectFilter("kind", "Kind", kinds));
    row.appendChild(selectFilter("sector", "Sector", sectors));
    row.appendChild(selectFilter("action", "Action", [["", "Any action"], ["buy", "Buy"], ["sell", "Sell"], ["flat", "Flat"]]));
    row.appendChild(selectFilter("excluded", "Excluded", [["any", "Excluded: any"], ["yes", "Excluded"], ["no", "Not excluded"]]));
    row.appendChild(selectFilter("mechanical", "Mechanical", [["any", "Mechanical: any"], ["yes", "Mechanical"], ["no", "Not mechanical"]]));
    return row;
  }

  function freshnessLegend() {
    var row = el("div", "ledger-fresh");
    [["tier-1", "Live 0–1d"], ["tier-2", "Recent 2–7d"], ["tier-3", "Aging 8–30d"], ["tier-4", "Stale 31d+"]].forEach(function (pair) {
      var item = el("span");
      item.appendChild(el("i", "ledger-dot " + pair[0]));
      item.appendChild(document.createTextNode(pair[1]));
      row.appendChild(item);
    });
    return row;
  }

  function card(item) {
    var api = score();
    var tier = api.freshnessTier(item.daysAgo);
    var node = el("article", "ledger-card" + (item.excluded ? " is-excluded" : "") + (tier === 4 ? " is-stale" : ""));
    node.dataset.ticker = item.ticker;
    var top = el("div", "ledger-card-top");
    var who = el("div");
    var age = el("span", "ledger-meta");
    age.appendChild(el("i", "ledger-dot tier-" + tier + (item.excluded ? "" : "")));
    if (item.excluded) age.querySelector(".ledger-dot").className = "ledger-dot";
    age.appendChild(document.createTextNode(" " + api.lagLabel(item)));
    who.appendChild(age);
    var title = el("div");
    title.appendChild(el("span", "ledger-ticker", item.ticker));
    title.appendChild(document.createTextNode(" " + item.sector));
    who.appendChild(title);
    top.appendChild(who);
    var badges = el("div", "ledger-badges");
    var kind = el("span", "ledger-badge" + (api.CORE_KINDS[item.kind] ? "" : " warn"), item.kind + (item.txnCode ? " " + item.txnCode : ""));
    badges.appendChild(kind);
    var action = el("span", "ledger-badge " + (item.action === "buy" ? "ledger-up" : item.action === "sell" ? "ledger-down" : "ledger-flat"), item.action);
    badges.appendChild(action);
    top.appendChild(badges);
    node.appendChild(top);
    node.appendChild(el("p", "ledger-summary", api.summaryLine(item)));
    if (item.excluded) node.appendChild(el("p", "ledger-meta", "Excluded: " + (item.excludeReason || "excluded")));
    if (api.isMechanical(item)) node.appendChild(el("p", "ledger-badge mute", "Mechanical flow"));
    var confirm = api.confirmationFor(item, shownFeed());
    if (confirm.count > 0) {
      var noun = confirm.count === 1 ? "source" : "sources";
      node.appendChild(el("p", "ledger-confirm", confirm.count + " confirming " + noun + " (×" + confirm.multiplier.toFixed(2) + ")"));
    }
    var history = api.historyLine(item);
    if (history) node.appendChild(el("p", "ledger-history", history));
    var foot = el("div", "ledger-card-foot");
    var cite = el("span", "ledger-meta");
    cite.appendChild(document.createTextNode(item.time + " · "));
    if (item.sourceUrl) {
      var link = document.createElement("a");
      link.href = item.sourceUrl;
      link.rel = "noreferrer";
      link.target = "_blank";
      link.textContent = item.source;
      cite.appendChild(link);
    } else {
      cite.appendChild(document.createTextNode(item.source));
    }
    foot.appendChild(cite);
    var watch = el("button", "ghost", watchHas(item.ticker) ? "Watching" : "Watch");
    watch.type = "button";
    watch.addEventListener("click", function () {
      toggleWatch(item.ticker);
      if (view.page === "watch") render();
      else paintSpine();
    });
    foot.appendChild(watch);
    node.appendChild(foot);
    return node;
  }

  function paintSpine() {
    var host = document.getElementById("ledger-spine");
    if (!host) return;
    host.textContent = "";
    if (!view.allowMock) {
      host.appendChild(el("p", "ledger-fine", "Institutional data is off."));
      return;
    }
    var rows = spineItems();
    if (!rows.length) {
      host.appendChild(el("p", "ledger-fine", view.page === "watch" && !readWatch().length
        ? "No tickers yet. Add one with Watch on a feed card. The list stays in this browser."
        : "No cards match."));
      return;
    }
    rows.forEach(function (item) { host.appendChild(card(item)); });
  }

  function watchChips() {
    var row = el("div", "ledger-watch");
    var saved = readWatch();
    if (!saved.length) {
      row.appendChild(el("span", "ledger-fine", "Watchlist is empty. Add a ticker from a card. Stored in this browser as ledger.watchlist."));
      return row;
    }
    saved.forEach(function (ticker) {
      var chip = el("button", "ghost", ticker + " ×");
      chip.type = "button";
      chip.addEventListener("click", function () {
        toggleWatch(ticker);
        render();
      });
      row.appendChild(chip);
    });
    return row;
  }

  function sourcesPanel() {
    var panel = el("section", "ledger-panel");
    panel.appendChild(el("h2", null, "Sources"));
    panel.appendChild(el("p", "ledger-fine", "Citations on this fixture. A row with no URL keeps the citation and no link."));
    var list = el("ul");
    var seen = {};
    feed().forEach(function (item) {
      var key = item.source + "|" + (item.sourceUrl || "");
      if (seen[key]) return;
      seen[key] = true;
      var li = el("li");
      if (item.sourceUrl) {
        var link = document.createElement("a");
        link.href = item.sourceUrl;
        link.rel = "noreferrer";
        link.target = "_blank";
        link.textContent = item.source;
        li.appendChild(link);
      } else {
        li.textContent = item.source;
      }
      list.appendChild(li);
    });
    panel.appendChild(list);
    return panel;
  }

  function feedPage() {
    var wrap = el("div");
    wrap.appendChild(summaryBlock());
    var layout = el("div", "ledger-layout");
    var main = el("div");
    main.appendChild(el("p", "eyebrow", "Recency spine"));
    main.appendChild(freshnessLegend());
    main.appendChild(filters());
    var spine = el("div");
    spine.id = "ledger-spine";
    main.appendChild(spine);
    layout.appendChild(main);
    if (view.allowMock) layout.appendChild(sourcesPanel());
    wrap.appendChild(layout);
    return wrap;
  }

  function watchPage() {
    var wrap = el("div");
    wrap.appendChild(el("p", "eyebrow", "Watchlist"));
    wrap.appendChild(el("p", "ledger-fine", "A ticker list in this browser. It does not change sector totals."));
    wrap.appendChild(watchChips());
    wrap.appendChild(filters());
    var spine = el("div");
    spine.id = "ledger-spine";
    wrap.appendChild(spine);
    return wrap;
  }

  function tabButton(id, label) {
    var button = el("button", "ghost", label);
    button.type = "button";
    button.setAttribute("aria-pressed", view.tab === id ? "true" : "false");
    button.addEventListener("click", function () {
      view.tab = id;
      render();
    });
    return button;
  }

  function pointsTab() {
    var box = el("div");
    var api = score();
    box.appendChild(el("p", null, "Count is +1 for a buy and −1 for a sell. Dollar is (to − from) / 100 × market cap in billions. Neither uses decay, reputation, earnings, or confirmation."));
    box.appendChild(el("p", null, "Weighted conviction is delta percent × filing weight × decay × reputation × earnings boost × confirmation. Decay is max(0, 1 − effective age / 30). Effective age is calendar days plus the kind’s source lag. Freshness color uses calendar age only."));
    box.appendChild(el("p", null, "Excluded rows and flat actions contribute 0. A 13F or ETF row has lag 45, so conviction is 0. Dollar and count still include it. Congress at calendar age 0 has effective age 30, so conviction is 0."));
    box.appendChild(el("p", "ledger-gap", "Known gap: the dollar figure multiplies every kind by market cap. That is a rough proxy when the unit is not shares of the issuer."));
    var table = el("table", "ledger-table");
    table.appendChild(el("caption", "ledger-meta", "Filing weights, " + api.modelVersion));
    api.KIND_ORDER.forEach(function (kind) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, kind));
      tr.appendChild(el("td", null, String(api.FILING_WEIGHTS[kind])));
      table.appendChild(tr);
    });
    box.appendChild(table);
    return box;
  }

  function signalsTab() {
    var box = el("div");
    box.appendChild(el("p", null, "A real row is not excluded and is not flat. Count follows the action. Dollar follows the sign of to − from, not the action word."));
    box.appendChild(el("p", null, "Confirmation counts distinct other kinds on the same ticker within 7 calendar days. Direction does not have to match. Two rows of the same kind do not confirm each other. The card shows the line only when the count is above 0. One other kind gives ×1.25. The cap is 2.0."));
    box.appendChild(el("p", null, "INDEX and CORPORATE_ACTION are mechanical. Their reputation is fixed at 0.7, the earnings boost stays 1, and the filer type is ignored. Any other kind within 10 days of earnings uses a 1.25 boost."));
    box.appendChild(el("p", null, "Sector momentum is the recent 15 calendar days minus the prior window through day 30. Rows older than 30 days stay in the total and in every chart point."));
    return box;
  }

  function sourcesTab() {
    var box = el("div");
    var api = score();
    box.appendChild(el("p", null, "Scoring lag is added to calendar age for decay only. The spine still shows calendar age."));
    var table = el("table", "ledger-table");
    var head = document.createElement("tr");
    head.appendChild(el("th", null, "Kind"));
    head.appendChild(el("th", null, "Lag days"));
    head.appendChild(el("th", null, "Note"));
    table.appendChild(head);
    api.KIND_ORDER.forEach(function (kind) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", null, kind));
      tr.appendChild(el("td", null, String(api.SOURCE_LAG[kind])));
      tr.appendChild(el("td", null, api.SOURCE_NOTES[kind] || ""));
      table.appendChild(tr);
    });
    box.appendChild(table);
    box.appendChild(el("p", "ledger-fine", "The Congress lag used for scoring is 30 days. The legal maximum under the STOCK Act is 45."));
    return box;
  }

  function backtestTab() {
    var box = el("div");
    box.appendChild(el("p", null, "Not yet run."));
    box.appendChild(el("p", "ledger-gap", "Weights stay a hypothesis until a backtest report exists. Do not treat " + score().modelVersion + " as a measured edge."));
    return box;
  }

  function methodology() {
    var wrap = el("section", "ledger-method");
    wrap.appendChild(el("h2", null, "Methodology"));
    var tabs = el("div", "ledger-tabs");
    tabs.appendChild(tabButton("points", "Point calculation"));
    tabs.appendChild(tabButton("signals", "Buy/sell rules"));
    tabs.appendChild(tabButton("sources", "Sources"));
    tabs.appendChild(tabButton("backtest", "Backtest"));
    wrap.appendChild(tabs);
    if (view.tab === "signals") wrap.appendChild(signalsTab());
    else if (view.tab === "sources") wrap.appendChild(sourcesTab());
    else if (view.tab === "backtest") wrap.appendChild(backtestTab());
    else wrap.appendChild(pointsTab());
    var back = el("button", "ghost", "Back to feed");
    back.type = "button";
    back.addEventListener("click", function () {
      view.page = "feed";
      render();
    });
    wrap.appendChild(back);
    return wrap;
  }

  function render() {
    if (!root) return;
    root.textContent = "";
    root.appendChild(header());
    root.appendChild(note());
    if (view.page === "info") root.appendChild(methodology());
    else if (view.page === "watch") root.appendChild(watchPage());
    else root.appendChild(feedPage());
    if (view.page !== "info") {
      paintSpine();
      if (view.page === "feed") paintSummary();
    }
    root.appendChild(el("p", "ledger-fine", "Not financial advice."));
  }

  window.STLedger = {
    open: function (host, allowMock) {
      root = host;
      view.allowMock = !!allowMock;
      render();
    },
    setMock: function (allowMock) {
      view.allowMock = !!allowMock;
      if (root) render();
    },
  };
})();
