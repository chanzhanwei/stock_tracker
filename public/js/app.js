(function () {
  "use strict";

  var state = {
    email: "",
    admin: false,
    devBypass: false,
    clerk: null,
    publishableKey: "",
    pendingEmail: "",
    authMode: "email",
    exchange: STConfig.defaultExchange,
    symbol: "",
    allowMock: false,
    loaded: false,
    analystOpen: false,
    timeframe: STConfig.defaultTimeframe,
    toggles: {},
    customPeriod: 200,
    bars: [],
    events: [],
    institutional: null,
    source: "",
    eventsSource: "",
    charts: null,
    series: null,
    syncing: false,
    loadSeq: 0,
  };

  STConfig.defaultOn.forEach(function (id) { state.toggles[id] = true; });

  var screens = ["screen-boot", "screen-auth", "screen-denied", "screen-admin", "screen-app"];

  function $(id) { return document.getElementById(id); }

  function showScreen(id) {
    screens.forEach(function (name) { $(name).hidden = name !== id; });
  }

  function formatPrice(n) {
    if (n == null || !isFinite(n)) return "—";
    var digits = Math.abs(n) >= 1 ? 2 : 4;
    return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  var CLERK_HOST_ERROR = "Clerk's publishable key points at an unfinished host, so the code cannot be sent. In the Clerk dashboard, switch to the Development instance and save that publishable key and its secret key in the Vercel project.";

  function clerkFrontendHost(publishableKey) {
    var parts = String(publishableKey || "").split("_");
    if (parts.length < 3 || parts[0] !== "pk") return "";
    var body = parts.slice(2).join("_").replace(/-/g, "+").replace(/_/g, "/");
    var mod = body.length % 4;
    if (mod) body += "====".slice(0, 4 - mod);
    try {
      var decoded = atob(body);
      return decoded.charAt(decoded.length - 1) === "$" ? decoded.slice(0, -1) : decoded;
    } catch (err) {
      return "";
    }
  }

  function clerkHostUsable(host) {
    if (!host || host.charAt(0) === "." || host.indexOf(" ") !== -1) return false;
    return host.indexOf(".") > 0 && host !== "clerk.accounts.dev";
  }

  function clerkMessage(err) {
    var first = err && err.errors && err.errors[0];
    var message = (first && (first.longMessage || first.message)) || (err && err.message) || "Sign-in failed.";
    if (message.indexOf("ClerkJS:") === 0) {
      if (message.indexOf("Network error") !== -1 || message.indexOf(".clerk.accounts.dev") !== -1) return CLERK_HOST_ERROR;
      return message.replace(/^ClerkJS:\s*/, "");
    }
    return message;
  }

  function idleGlass() {
    var glass = $("boot-glass");
    if (glass) glass.classList.add("is-idle");
  }

  function clerkCode(err) {
    var first = err && err.errors && err.errors[0];
    return (first && first.code) || "";
  }

  async function api(path, options) {
    var opts = options || {};
    var headers = new Headers(opts.headers || {});
    if (state.devBypass) headers.set("x-dev-email", state.email || STConfig.adminEmail);
    else if (state.clerk && state.clerk.session) {
      var token = await state.clerk.session.getToken();
      if (token) headers.set("Authorization", "Bearer " + token);
    }
    if (opts.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body || undefined,
    });
  }

  function renderControls() {
    var exchange = $("exchange");
    STConfig.exchanges.forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      if (name === state.exchange) option.selected = true;
      exchange.appendChild(option);
    });
    var frames = $("timeframes");
    STConfig.timeframes.forEach(function (frame) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = frame.id;
      button.dataset.tf = frame.id;
      button.setAttribute("aria-pressed", frame.id === state.timeframe ? "true" : "false");
      button.addEventListener("click", function () {
        state.timeframe = frame.id;
        Array.prototype.forEach.call(frames.querySelectorAll("button"), function (el) {
          el.setAttribute("aria-pressed", el === button ? "true" : "false");
        });
        if (!state.loaded) return;
        if (state.bars.length) paint();
        else loadTicker();
      });
      frames.appendChild(button);
    });
    function indicatorControl(item) {
      var label = document.createElement("label");
      label.className = "ind" + (item.implemented ? "" : " na");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.disabled = !item.implemented;
      input.checked = !!state.toggles[item.id];
      input.dataset.id = item.id;
      var name = document.createElement("span");
      name.textContent = item.label;
      label.appendChild(input);
      label.appendChild(name);
      if (!item.implemented) {
        var na = document.createElement("em");
        na.textContent = "N/A";
        label.appendChild(na);
      }
      if (item.period) {
        var period = document.createElement("input");
        period.className = "period";
        period.type = "number";
        period.min = "2";
        period.max = "400";
        period.value = String(state.customPeriod);
        period.setAttribute("aria-label", "Custom SMA period");
        period.addEventListener("mousedown", function (event) { event.stopPropagation(); });
        period.addEventListener("click", function (event) { event.stopPropagation(); });
        period.addEventListener("change", function () {
          state.customPeriod = STIndicators.clampPeriod(period.value);
          period.value = String(state.customPeriod);
          if (state.loaded) paint();
        });
        label.appendChild(period);
      }
      if (item.implemented) {
        input.addEventListener("change", function () {
          state.toggles[item.id] = input.checked;
          syncPanes();
          if (state.loaded) paint();
        });
      }
      return label;
    }
    var pin = $("volume-pin");
    pin.textContent = "";
    pin.appendChild(indicatorControl({ id: "volume", label: "Volume bars", implemented: true }));
    var host = $("indicator-groups");
    host.textContent = "";
    STConfig.groups.forEach(function (group) {
      var section = document.createElement("details");
      section.className = "group";
      var title = document.createElement("summary");
      title.textContent = group.label;
      section.appendChild(title);
      group.items.forEach(function (item) {
        if (item.id === "volume") return;
        section.appendChild(indicatorControl(item));
      });
      host.appendChild(section);
    });
    $("ticker").value = state.symbol;
    syncPanes();
  }

  function syncPanes() {
    var rsi = $("rsi-pane");
    var macd = $("macd-pane");
    if (rsi) rsi.hidden = !state.toggles.rsi;
    if (macd) macd.hidden = !state.toggles.macd;
    if (state.charts) requestAnimationFrame(syncChartSizes);
  }

  function setAuthStep(step) {
    state.authMode = step;
    var codeField = $("auth-code-field");
    var back = $("auth-back");
    var submit = $("auth-submit");
    if (state.devBypass) {
      $("auth-copy").textContent = "Local development bypass. Clerk keys are absent and this host is localhost. Enter an allowlisted email. The default is the administrator. This bypass does not exist on Vercel.";
      codeField.hidden = true;
      back.hidden = true;
      submit.textContent = "Continue";
      return;
    }
    if (step === "code") {
      $("auth-copy").textContent = "Enter the code sent to " + state.pendingEmail + ".";
      codeField.hidden = false;
      back.hidden = false;
      submit.textContent = "Verify";
      $("auth-code").focus();
      return;
    }
    $("auth-copy").textContent = "Use the one-time code sent to your email. There is no password.";
    codeField.hidden = true;
    back.hidden = true;
    submit.textContent = "Send code";
  }

  function showAuthError(message) {
    $("auth-error").textContent = message || "";
  }

  async function sendCode(email) {
    var clerk = state.clerk;
    state.pendingEmail = email;
    if (!clerk || !clerkHostUsable(clerkFrontendHost(state.publishableKey))) {
      throw new Error(CLERK_HOST_ERROR);
    }
    try {
      var signIn = await clerk.client.signIn.create({ identifier: email });
      var factor = (signIn.supportedFirstFactors || []).find(function (item) {
        return item.strategy === "email_code";
      });
      if (!factor) throw new Error("Email code sign-in is not enabled.");
      await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      state.authMode = "sign-in";
      setAuthStep("code");
    } catch (err) {
      if (clerkCode(err) !== "form_identifier_not_found") throw err;
      await clerk.client.signUp.create({ emailAddress: email });
      await clerk.client.signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      state.authMode = "sign-up";
      setAuthStep("code");
    }
  }

  async function verifyCode(code) {
    var clerk = state.clerk;
    if (state.authMode === "sign-up") {
      var signedUp = await clerk.client.signUp.attemptEmailAddressVerification({ code: code });
      if (signedUp.status !== "complete") throw new Error("That code did not finish sign-up.");
      await clerk.setActive({ session: signedUp.createdSessionId });
      return;
    }
    var signedIn = await clerk.client.signIn.attemptFirstFactor({ strategy: "email_code", code: code });
    if (signedIn.status !== "complete") throw new Error("That code did not finish sign-in.");
    await clerk.setActive({ session: signedIn.createdSessionId });
  }

  async function enterApp() {
    var res = await api("/api/users");
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (res.status === 401) {
      showScreen("screen-auth");
      showAuthError("Sign in again.");
      return;
    }
    if (body.error === "not_allowlisted") {
      showDenied(body.email || state.email);
      return;
    }
    if (res.ok) {
      state.admin = true;
      state.email = body.me || state.email;
    } else if (body.allowed) {
      state.admin = false;
      state.email = body.email || state.email;
    } else {
      showScreen("screen-auth");
      showAuthError(body.error || "The desk could not be opened.");
      return;
    }
    $("who").textContent = state.email;
    $("users-button").hidden = !state.admin;
    showScreen("screen-app");
    ensureCharts();
    syncChartSizes();
    requestAnimationFrame(function () {
      syncChartSizes();
      requestAnimationFrame(syncChartSizes);
    });
    renderFavorites();
  }

  function showDenied(email) {
    state.email = email || state.email;
    $("denied-copy").textContent = (state.email || "This email") + " is signed in and is not on the allowlist. The dashboard stays closed.";
    showScreen("screen-denied");
  }

  async function onAuthSubmit(event) {
    event.preventDefault();
    var submit = $("auth-submit");
    submit.disabled = true;
    showAuthError("");
    try {
      if (state.devBypass) {
        state.email = ($("auth-email").value || STConfig.adminEmail).trim().toLowerCase();
        await enterApp();
        return;
      }
      if (state.authMode === "email") {
        await sendCode($("auth-email").value.trim().toLowerCase());
        return;
      }
      await verifyCode($("auth-code").value.trim());
      var user = state.clerk.user;
      var primary = user && (user.primaryEmailAddress || (user.emailAddresses && user.emailAddresses[0]));
      state.email = (primary && primary.emailAddress || state.pendingEmail).toLowerCase();
      await enterApp();
    } catch (err) {
      showAuthError(clerkMessage(err));
    } finally {
      submit.disabled = false;
    }
  }

  async function signOut() {
    if (state.clerk) {
      try { await state.clerk.signOut(); } catch (err) { /* stay local */ }
    }
    state.email = "";
    state.admin = false;
    state.authMode = "email";
    state.analystOpen = false;
    if ($("mode-slider")) setMode("stock");
    $("auth-code").value = "";
    setAuthStep("email");
    showAuthError("");
    showScreen("screen-auth");
  }

  function renderFavorites() {
    var list = $("favorite-list");
    list.textContent = "";
    var rows = [];
    try { rows = STFavorites.read(state.email); }
    catch (err) {
      var fail = document.createElement("li");
      fail.textContent = "This browser blocked local storage.";
      list.appendChild(fail);
      return;
    }
    if (!rows.length) {
      var empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No saved tickers yet.";
      list.appendChild(empty);
    }
    rows.forEach(function (row) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = row.exchange + " · " + row.symbol;
      button.addEventListener("click", function () {
        state.exchange = row.exchange;
        state.symbol = row.symbol;
        $("exchange").value = row.exchange;
        $("ticker").value = row.symbol;
        loadTicker();
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    var starred = STFavorites.has(state.email, state.exchange, state.symbol);
    $("star").textContent = starred ? "★" : "☆";
    $("star").setAttribute("aria-pressed", starred ? "true" : "false");
  }

  function toggleFavorite() {
    if (!state.email || !state.symbol) return;
    try {
      STFavorites.toggle(state.email, state.exchange, state.symbol);
    } catch (err) {
      $("status").textContent = "Favorites stay in this browser, and local storage is blocked.";
      return;
    }
    renderFavorites();
  }

  function chartOptions(el) {
    return {
      autoSize: false,
      width: el.clientWidth || 640,
      height: el.clientHeight || 160,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: "#12181b" },
        textColor: "#d5e0db",
        fontFamily: "Outfit, Avenir Next, Segoe UI, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(228, 196, 156, 0.08)" },
        horzLines: { color: "rgba(228, 196, 156, 0.08)" },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(228, 196, 156, 0.2)" },
      timeScale: { borderColor: "rgba(228, 196, 156, 0.2)", rightOffset: 2 },
    };
  }

  function addLine(chart, color, extra) {
    return chart.addLineSeries(Object.assign({
      color: color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }, extra || {}));
  }

  function syncChartSizes() {
    if (!state.charts) return;
    [
      [state.charts.main, "chart-main"],
      [state.charts.rsi, "chart-rsi"],
      [state.charts.macd, "chart-macd"],
    ].forEach(function (pair) {
      var el = $(pair[1]);
      if (!pair[0] || !el) return;
      if (el.clientWidth > 0 && el.clientHeight > 0) pair[0].resize(el.clientWidth, el.clientHeight);
    });
  }

  function linkScales(source, others) {
    source.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
      if (state.syncing || !range) return;
      state.syncing = true;
      others.forEach(function (chart) { chart.timeScale().setVisibleLogicalRange(range); });
      state.syncing = false;
    });
  }

  function ensureCharts() {
    if (state.charts || typeof LightweightCharts === "undefined") {
      if (typeof LightweightCharts === "undefined") $("status").textContent = "Chart library failed to load.";
      return;
    }
    var mainEl = $("chart-main");
    var rsiEl = $("chart-rsi");
    var macdEl = $("chart-macd");
    var main = LightweightCharts.createChart(mainEl, chartOptions(mainEl));
    var rsiChart = LightweightCharts.createChart(rsiEl, chartOptions(rsiEl));
    var macdChart = LightweightCharts.createChart(macdEl, chartOptions(macdEl));
    var candle = main.addCandlestickSeries({
      upColor: "#1f9d6a",
      downColor: "#d4535e",
      borderUpColor: "#1f9d6a",
      borderDownColor: "#d4535e",
      wickUpColor: "#8fd0b4",
      wickDownColor: "#f0a3a8",
    });
    var volume = main.addHistogramSeries({
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    main.priceScale("volume").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    main.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
    var rsi = rsiChart.addLineSeries({ color: "#7eb6c9", lineWidth: 2, priceLineVisible: false });
    rsi.createPriceLine({ price: 30, color: "#3fbf8a", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: "" });
    rsi.createPriceLine({ price: 70, color: "#e36a6a", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: "" });
    var macdHist = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    var macdLine = addLine(macdChart, "#e4b06a");
    var macdSignal = addLine(macdChart, "#c58be0");
    macdLine.createPriceLine({ price: 0, color: "rgba(231,239,233,0.35)", lineWidth: 1, axisLabelVisible: false, title: "" });
    state.charts = { main: main, rsi: rsiChart, macd: macdChart };
    state.series = {
      candle: candle,
      volume: volume,
      sma20: addLine(main, "#e4b06a"),
      sma50: addLine(main, "#7eb6c9"),
      smaCustom: addLine(main, "#c58be0"),
      ema21: addLine(main, "#f2e2c4"),
      vwap: addLine(main, "#8fd0b4"),
      bbMid: addLine(main, "#8ea099", { lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1 }),
      bbUpper: addLine(main, "#8ea099", { lineWidth: 1 }),
      bbLower: addLine(main, "#8ea099", { lineWidth: 1 }),
      rsi: rsi,
      macdHist: macdHist,
      macd: macdLine,
      macdSignal: macdSignal,
    };
    linkScales(main, [rsiChart, macdChart]);
    linkScales(rsiChart, [main, macdChart]);
    linkScales(macdChart, [main, rsiChart]);
    main.subscribeCrosshairMove(function (param) {
      if (!param || !param.point || !param.time) {
        paintQuote(null);
        return;
      }
      var bar = state.viewBars && state.viewBars.find(function (row) { return row.time === param.time; });
      paintQuote(bar || null);
    });
    window.addEventListener("resize", syncChartSizes);
    if (typeof ResizeObserver !== "undefined") {
      var observer = new ResizeObserver(syncChartSizes);
      observer.observe($("chart-stack"));
    }
    syncChartSizes();
  }

  function sliceFrom(rows, startTime) {
    return (rows || []).filter(function (row) { return row && row.time >= startTime; });
  }

  function extend(data, extraTimes) {
    var seen = {};
    var out = (data || []).slice();
    out.forEach(function (row) { seen[row.time] = true; });
    extraTimes.forEach(function (time) {
      if (!seen[time]) out.push({ time: time });
    });
    out.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    return out;
  }

  function paintQuote(bar) {
    var result = state.result;
    var quote = result && result.quote;
    var close = bar ? bar.close : quote && quote.close;
    var prev = null;
    if (bar && state.viewBars) {
      var index = state.viewBars.findIndex(function (row) { return row.time === bar.time; });
      if (index > 0) prev = state.viewBars[index - 1].close;
    }
    var change = bar && prev != null ? bar.close - prev : quote && quote.change;
    var changePct = bar && prev ? (change / prev) * 100 : quote && quote.changePct;
    $("last-price").textContent = formatPrice(close);
    var changeEl = $("last-change");
    if (change == null || !isFinite(change)) {
      changeEl.textContent = "";
      changeEl.className = "";
    } else {
      var sign = change > 0 ? "+" : "";
      changeEl.textContent = sign + formatPrice(change) + " (" + sign + changePct.toFixed(2) + "%)";
      changeEl.className = change > 0 ? "up" : change < 0 ? "down" : "flat";
    }
  }

  function paintVerdict(result) {
    var word = $("verdict-word");
    word.textContent = result.verdict;
    word.className = "verdict " + result.verdict;
    $("verdict-confidence").textContent = result.confidence + "% confidence";
    $("verdict-detail").textContent = result.activeCount
      ? "Mean vote " + result.average.toFixed(2) + " across " + result.activeCount + " active signals."
      : "No active signals. Mean is 0, so the verdict is HOLD.";
    var cats = $("category-bars");
    cats.textContent = "";
    [
      ["trend", "Trend"],
      ["momentum", "Momentum"],
      ["volatility", "Volatility"],
      ["volume", "Volume"],
      ["levels", "Levels"],
    ].forEach(function (pair) {
      var nums = result.votes.filter(function (vote) {
        return vote.group === pair[0] && typeof vote.vote === "number";
      }).map(function (vote) { return vote.vote; });
      var score = nums.length ? nums.reduce(function (sum, vote) { return sum + vote; }, 0) / nums.length : null;
      var row = document.createElement("div");
      row.className = "cat";
      var label = document.createElement("span");
      label.textContent = pair[1];
      var track = document.createElement("div");
      track.className = "track";
      var axis = document.createElement("i");
      track.appendChild(axis);
      if (score) {
        var fill = document.createElement("b");
        fill.className = score > 0 ? "pos" : "neg";
        fill.style.width = (Math.min(1, Math.abs(score)) * 50) + "%";
        track.appendChild(fill);
      }
      var value = document.createElement("span");
      value.textContent = score == null ? "—" : (score > 0 ? "+" : "") + score.toFixed(2);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      cats.appendChild(row);
    });
    var votes = $("vote-list");
    votes.textContent = "";
    function voteRow(vote) {
      var item = document.createElement("div");
      item.className = "vote-row";
      var name = document.createElement("span");
      name.textContent = vote.label;
      var value = document.createElement("span");
      var text = "N/A";
      var cls = "vote-na";
      if (vote.vote === "off") { text = "Off"; cls = "vote-off"; }
      else if (vote.vote === 1) { text = "Buy"; cls = "vote-buy"; }
      else if (vote.vote === -1) { text = "Sell"; cls = "vote-sell"; }
      else if (vote.vote === 0) { text = "Hold"; cls = "vote-hold"; }
      value.textContent = text;
      value.className = cls;
      item.appendChild(name);
      item.appendChild(value);
      return item;
    }
    result.votes.filter(function (vote) { return vote.id === "volume"; }).forEach(function (vote) {
      votes.appendChild(voteRow(vote));
    });
    [
      ["trend", "Trend"],
      ["momentum", "Momentum"],
      ["volatility", "Volatility"],
      ["volume", "Volume"],
      ["levels", "Flow and levels"],
    ].forEach(function (pair) {
      var details = document.createElement("details");
      details.className = "vote-group";
      var summary = document.createElement("summary");
      summary.textContent = pair[1];
      details.appendChild(summary);
      result.votes.filter(function (vote) {
        return vote.group === pair[0] && vote.id !== "volume";
      }).forEach(function (vote) {
        details.appendChild(voteRow(vote));
      });
      votes.appendChild(details);
    });
  }

  function paintEvents() {
    var host = $("events");
    host.textContent = "";
    if (!state.events.length) {
      var empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "No events.";
      host.appendChild(empty);
      return;
    }
    state.events.forEach(function (event) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "event " + (event.status || "");
      var title = document.createElement("strong");
      title.textContent = event.label;
      var when = document.createElement("span");
      when.textContent = event.date || event.iso;
      var meta = document.createElement("em");
      meta.textContent = (event.status || "") + " · " + (event.source || "") + (event.detail ? " · " + event.detail : "");
      button.appendChild(title);
      button.appendChild(when);
      button.appendChild(meta);
      button.addEventListener("click", function () { revealEvent(event.iso); });
      host.appendChild(button);
    });
  }

  function paintInstitutional() {
    var inst = state.institutional || { buyPct: null, sellPct: null, source: "none" };
    var badge = $("inst-source");
    if (inst.source === "none" || inst.buyPct == null || inst.sellPct == null) {
      $("inst-buy").style.width = "0%";
      $("inst-sell").style.width = "0%";
      badge.textContent = "off";
      badge.className = "badge";
      $("inst-caption").textContent = "Institutional data is off.";
      return;
    }
    var buy = Math.max(0, Number(inst.buyPct) || 0);
    var sell = Math.max(0, Number(inst.sellPct) || 0);
    var scale = buy + sell > 100 ? 100 / (buy + sell) : 1;
    $("inst-buy").style.width = (buy * scale) + "%";
    $("inst-sell").style.width = (sell * scale) + "%";
    badge.textContent = inst.source || "mock";
    badge.className = "badge" + (inst.source === "mock" ? " mock" : "");
    $("inst-caption").textContent = "Buy " + buy + "% · Sell " + sell + "% · mock data, not a live holdings feed.";
  }

  function markerFor(events) {
    return events.map(function (event) {
      var shape = "circle";
      var position = "aboveBar";
      var color = "#e4b06a";
      if (event.type === "earnings") { shape = "arrowDown"; color = "#7eb6c9"; }
      if (event.type === "dividend") { shape = "arrowUp"; position = "belowBar"; color = "#3fbf8a"; }
      return {
        time: event.iso,
        position: position,
        color: color,
        shape: shape,
        text: event.label,
      };
    });
  }

  function paint() {
    syncPanes();
    if (!state.charts) return;
    var visible = STConfig.visibleDays(state.timeframe);
    var result = STIndicators.compute(state.bars, {
      toggles: state.toggles,
      customPeriod: state.customPeriod,
      institutional: state.institutional,
    });
    state.result = result;
    if (!state.bars.length) {
      Object.keys(state.series).forEach(function (key) {
        if (state.series[key] && state.series[key].setData) state.series[key].setData([]);
      });
      if (state.series.candle && state.series.candle.setMarkers) state.series.candle.setMarkers([]);
      state.candleTimes = [];
      state.viewBars = [];
      $("symbol-name").textContent = state.symbol || "—";
      $("symbol-meta").textContent = state.symbol ? state.exchange : "";
      var emptyBadge = $("source-badge");
      emptyBadge.textContent = state.source || "";
      emptyBadge.className = "badge" + (state.source === "mock" ? " mock" : "");
      paintQuote(null);
      paintVerdict(result);
      renderFavorites();
      return;
    }
    var start = Math.max(0, state.bars.length - visible);
    var view = state.bars.slice(start);
    state.viewBars = view;
    var startTime = view.length ? view[0].time : "";
    var extra = state.events.map(function (event) { return event.iso; }).filter(function (iso) {
      return iso && (!startTime || iso >= startTime);
    });
    function aligned(rows, enabled) {
      var source = enabled ? sliceFrom(rows, startTime) : [];
      var byTime = {};
      source.forEach(function (row) { byTime[row.time] = row; });
      var base = view.map(function (bar) { return byTime[bar.time] || { time: bar.time }; });
      return extend(base, extra);
    }
    var candles = extend(view.map(function (bar) {
      return { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
    }), extra);
    state.candleTimes = candles.map(function (bar) { return bar.time; });
    state.series.candle.setData(candles);
    state.series.volume.setData(state.toggles.volume ? aligned(result.volume, true) : []);
    state.series.sma20.setData(state.toggles.sma20 ? aligned(result.sma20, true) : []);
    state.series.sma50.setData(state.toggles.sma50 ? aligned(result.sma50, true) : []);
    state.series.smaCustom.setData(state.toggles.smaCustom ? aligned(result.smaCustom, true) : []);
    state.series.ema21.setData(state.toggles.ema21 ? aligned(result.ema21, true) : []);
    state.series.vwap.setData(state.toggles.vwap ? aligned(result.vwap, true) : []);
    var bands = state.toggles.bollinger;
    state.series.bbMid.setData(bands ? aligned(result.bbMid, true) : []);
    state.series.bbUpper.setData(bands ? aligned(result.bbUpper, true) : []);
    state.series.bbLower.setData(bands ? aligned(result.bbLower, true) : []);
    state.series.rsi.setData(aligned(result.rsi, state.toggles.rsi));
    state.series.macd.setData(aligned(result.macd, state.toggles.macd));
    state.series.macdSignal.setData(state.toggles.macd ? aligned(result.macdSignal, true) : []);
    state.series.macdHist.setData(state.toggles.macd ? aligned(result.macdHist, true) : []);
    var markers = markerFor(state.events.filter(function (event) {
      return candles.some(function (bar) { return bar.time === event.iso; });
    }));
    state.series.candle.setMarkers(markers);
    var from = candles.findIndex(function (bar) { return view.length && bar.time === view[0].time; });
    var to = candles.findIndex(function (bar) { return view.length && bar.time === view[view.length - 1].time; });
    if (from >= 0 && to >= from) {
      var range = { from: Math.max(0, from - 0.5), to: to + 2 };
      state.syncing = true;
      state.charts.main.timeScale().setVisibleLogicalRange(range);
      state.charts.rsi.timeScale().setVisibleLogicalRange(range);
      state.charts.macd.timeScale().setVisibleLogicalRange(range);
      state.syncing = false;
    }
    $("symbol-name").textContent = state.symbol;
    $("symbol-meta").textContent = state.exchange + (view.length ? " · " + view[0].time + " to " + view[view.length - 1].time : "");
    var badge = $("source-badge");
    badge.textContent = state.source || "";
    badge.className = "badge" + (state.source === "mock" ? " mock" : "");
    paintQuote(null);
    paintVerdict(result);
    renderFavorites();
    syncChartSizes();
  }

  function revealEvent(iso) {
    if (!state.charts || !iso) return;
    var data = state.candleTimes || [];
    var index = data.findIndex(function (time) { return time >= iso; });
    if (index < 0) index = data.length - 1;
    var range = { from: Math.max(0, index - 12), to: index + 6 };
    state.syncing = true;
    state.charts.main.timeScale().setVisibleLogicalRange(range);
    state.charts.rsi.timeScale().setVisibleLogicalRange(range);
    state.charts.macd.timeScale().setVisibleLogicalRange(range);
    state.syncing = false;
  }

  async function loadTicker() {
    var symbol = $("ticker").value.trim().toUpperCase();
    if (!symbol) {
      $("status").textContent = "Enter a ticker.";
      return;
    }
    state.symbol = symbol;
    state.loaded = true;
    state.exchange = $("exchange").value;
    $("ticker").value = symbol;
    var seq = ++state.loadSeq;
    $("status").textContent = "Loading " + state.exchange + ":" + symbol + "…";
    var days = STConfig.calendarDays(STConfig.visibleDays(state.timeframe));
    var query = "exchange=" + encodeURIComponent(state.exchange) + "&symbol=" + encodeURIComponent(symbol) + "&mock=" + (state.allowMock ? "1" : "0");
    try {
      var responses = await Promise.all([
        api("/api/ohlcv?" + query + "&days=" + days),
        api("/api/events?" + query),
        api("/api/institutional?" + query),
      ]);
      if (seq !== state.loadSeq) return;
      var bodies = await Promise.all(responses.map(function (res) { return res.json().catch(function () { return {}; }); }));
      var denied = responses.find(function (res) { return res.status === 401 || res.status === 403; });
      if (denied) {
        var problem = bodies[responses.indexOf(denied)];
        if (denied.status === 401) {
          showScreen("screen-auth");
          showAuthError("Sign in again.");
        } else if (problem.error === "not_allowlisted") showDenied(problem.email || state.email);
        else $("status").textContent = problem.error || "Request refused.";
        return;
      }
      if (!responses[0].ok) {
        $("status").textContent = bodies[0].error || "Price data failed.";
        return;
      }
      state.bars = bodies[0].bars || [];
      state.source = bodies[0].source || "";
      state.events = (bodies[1] && bodies[1].events) || [];
      state.eventsSource = (bodies[1] && bodies[1].source) || "";
      state.institutional = bodies[2] || { source: "none", buyPct: null, sellPct: null };
      $("status").textContent = state.bars.length ? "" : (state.allowMock ? "No prices." : "No live prices. Mock data is off.");
      paintEvents();
      paintInstitutional();
      paint();
    } catch (err) {
      if (seq !== state.loadSeq) return;
      $("status").textContent = "The request failed.";
    }
  }

  function renderAdmin(emails) {
    var list = $("admin-list");
    list.textContent = "";
    (emails || []).forEach(function (email) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.textContent = email;
      item.appendChild(name);
      if (email === STConfig.adminEmail) {
        var pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = "Administrator";
        item.appendChild(pill);
      } else {
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost";
        remove.textContent = "Remove";
        remove.addEventListener("click", function () { changeUser("remove", email); });
        item.appendChild(remove);
      }
      list.appendChild(item);
    });
  }

  async function openAdmin() {
    showScreen("screen-admin");
    $("admin-error").textContent = "";
    var res = await api("/api/users");
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok || !body.admin) {
      $("admin-panel").hidden = true;
      $("admin-blocked").hidden = false;
      $("admin-blocked-text").textContent = "You cannot open the user screen.";
      return;
    }
    $("admin-blocked").hidden = true;
    $("admin-panel").hidden = false;
    renderAdmin(body.emails || []);
  }

  async function changeUser(action, email) {
    $("admin-error").textContent = "";
    var res = await api("/api/users", { method: "POST", body: JSON.stringify({ action: action, email: email }) });
    var body = {};
    try { body = await res.json(); } catch (err) { body = {}; }
    if (!res.ok) {
      $("admin-error").textContent = body.error === "cannot_remove_admin"
        ? "The administrator cannot be removed."
        : (body.error || "The list was not updated.");
      return;
    }
    renderAdmin(body.emails || []);
  }

  function bind() {
    renderControls();
    $("auth-form").addEventListener("submit", onAuthSubmit);
    $("auth-back").addEventListener("click", function () {
      state.authMode = "email";
      $("auth-code").value = "";
      setAuthStep("email");
      showAuthError("");
    });
    $("auth-email").value = STConfig.adminEmail;
    $("load-form").addEventListener("submit", function (event) {
      event.preventDefault();
      loadTicker();
    });
    $("exchange").addEventListener("change", function () { state.exchange = $("exchange").value; });
    $("star").addEventListener("click", toggleFavorite);
    $("info-button").addEventListener("click", function () { $("info-overlay").hidden = false; });
    $("info-close").addEventListener("click", function () { $("info-overlay").hidden = true; });
    $("info-overlay").addEventListener("click", function (event) {
      if (event.target === $("info-overlay")) $("info-overlay").hidden = true;
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") $("info-overlay").hidden = true;
    });
    $("users-button").addEventListener("click", openAdmin);
    $("admin-back").addEventListener("click", function () { showScreen("screen-app"); syncChartSizes(); });
    $("admin-blocked-back").addEventListener("click", function () { showScreen("screen-app"); syncChartSizes(); });
    $("admin-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var email = $("admin-email").value.trim().toLowerCase();
      if (!email) return;
      changeUser("add", email).then(function () { $("admin-email").value = ""; });
    });
    $("signout").addEventListener("click", signOut);
    $("denied-signout").addEventListener("click", signOut);
    $("mock-toggle").addEventListener("change", function () {
      state.allowMock = $("mock-toggle").checked;
      if (state.loaded) loadTicker();
    });
    $("mode-stock").addEventListener("click", function () { setMode("stock"); });
    $("mode-analyze").addEventListener("click", function () { setMode("analyze"); });
    $("mode-institution").addEventListener("click", function () { setMode("institution"); });
  }

  function setMode(mode) {
    var analyze = mode === "analyze";
    var institution = mode === "institution";
    state.analystOpen = analyze || institution;
    $("desk").hidden = analyze || institution;
    $("analyst").hidden = !analyze;
    $("institution").hidden = !institution;
    $("mode-slider").dataset.mode = institution ? "institution" : analyze ? "analyze" : "stock";
    $("mode-stock").setAttribute("aria-pressed", (!analyze && !institution) ? "true" : "false");
    $("mode-analyze").setAttribute("aria-pressed", analyze ? "true" : "false");
    $("mode-institution").setAttribute("aria-pressed", institution ? "true" : "false");
    if (analyze) STAnalyst.open({ admin: state.admin, api: api });
    else if (institution) STAnalyst.openInstitution({ admin: state.admin, api: api });
    else syncChartSizes();
  }

  function loadClerk(publishableKey) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.setAttribute("data-clerk-publishable-key", publishableKey);
      script.onload = function () {
        try {
          var clerk = window.Clerk;
          if (typeof clerk === "function") {
            clerk = new clerk(publishableKey);
          } else if (clerk && typeof clerk.Clerk === "function") {
            clerk = new clerk.Clerk(publishableKey);
          }
          if (!clerk || typeof clerk.load !== "function") {
            reject(new Error("Clerk failed to load."));
            return;
          }
          state.clerk = clerk;
          clerk.load().then(resolve).catch(reject);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = function () { reject(new Error("Clerk failed to load.")); };
      document.head.appendChild(script);
    });
  }

  async function boot() {
    bind();
    try {
      var res = await fetch("/api/config");
      var cfg = await res.json();
      if (cfg.devBypass) {
        state.devBypass = true;
        setAuthStep("email");
        showScreen("screen-auth");
        return;
      }
      if (!cfg.publishableKey) {
        idleGlass();
        $("boot-status").textContent = "Clerk keys are missing on this host. The allowlist is not bypassed.";
        return;
      }
      state.publishableKey = cfg.publishableKey;
      if (!clerkHostUsable(clerkFrontendHost(cfg.publishableKey))) {
        setAuthStep("email");
        showAuthError(CLERK_HOST_ERROR);
        showScreen("screen-auth");
        return;
      }
      await loadClerk(cfg.publishableKey);
      if (state.clerk.user) {
        var primary = state.clerk.user.primaryEmailAddress || state.clerk.user.emailAddresses[0];
        state.email = (primary && primary.emailAddress || "").toLowerCase();
        await enterApp();
        return;
      }
      setAuthStep("email");
      showScreen("screen-auth");
    } catch (err) {
      idleGlass();
      $("boot-status").textContent = clerkMessage(err);
    }
  }

  window.syncChartSizes = syncChartSizes;
  boot();
})();
