"use strict";

const { formatIso, eventStatus, todayUtc, ymdFromUtc } = require("./mock");

const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; stock_tracker/1.0)",
  Accept: "application/json,text/plain,*/*",
};
const CHART_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];

let crumbCache = null;

function roundPrice(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function ymdInZone(unixSeconds, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date(unixSeconds * 1000));
  } catch (err) {
    return ymdFromUtc(unixSeconds * 1000);
  }
}

function dedupeBars(bars) {
  const map = new Map();
  for (const bar of bars) {
    if (!bar || !bar.time) continue;
    if (![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) continue;
    map.set(bar.time, bar);
  }
  return Array.from(map.values()).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

async function fetchText(url, headers) {
  const res = await fetch(url, {
    headers: Object.assign({}, UA, headers || {}),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  return { res, text };
}

async function getCrumb() {
  if (crumbCache && crumbCache.expires > Date.now()) return crumbCache;
  const first = await fetch("https://fc.yahoo.com", {
    headers: UA,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  const setCookies = typeof first.headers.getSetCookie === "function" ? first.headers.getSetCookie() : [];
  const cookie = setCookies.map((row) => row.split(";")[0]).filter(Boolean).join("; ");
  if (!cookie) return null;
  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: Object.assign({}, UA, { Cookie: cookie }),
    signal: AbortSignal.timeout(8000),
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.startsWith("{") || crumb.length > 64) return null;
  crumbCache = { cookie, crumb, expires: Date.now() + 20 * 60 * 1000 };
  return crumbCache;
}

async function fetchDailyBars(yahooSymbol, days) {
  const now = Math.floor(Date.now() / 1000);
  const period2 = now + 86400;
  const period1 = now - Math.max(1, days) * 86400;
  const path = "/v8/finance/chart/" + encodeURIComponent(yahooSymbol) +
    "?interval=1d&events=div%7Csplit&includePrePost=false&period1=" + period1 + "&period2=" + period2;
  let lastError = null;
  for (const host of CHART_HOSTS) {
    try {
      const { res, text } = await fetchText(host + path);
      if (!res.ok) {
        lastError = new Error("yahoo chart " + res.status);
        continue;
      }
      const json = JSON.parse(text);
      const result = json && json.chart && json.chart.result && json.chart.result[0];
      if (!result || !Array.isArray(result.timestamp)) {
        lastError = new Error("yahoo chart empty");
        continue;
      }
      const quote = result.indicators && result.indicators.quote && result.indicators.quote[0];
      if (!quote) continue;
      const zone = (result.meta && result.meta.exchangeTimezoneName) || "UTC";
      const bars = [];
      for (let i = 0; i < result.timestamp.length; i += 1) {
        const open = quote.open[i];
        const high = quote.high[i];
        const low = quote.low[i];
        const close = quote.close[i];
        const volume = quote.volume[i];
        if (open == null || high == null || low == null || close == null) continue;
        bars.push({
          time: ymdInZone(result.timestamp[i], zone),
          open: roundPrice(open),
          high: roundPrice(high),
          low: roundPrice(low),
          close: roundPrice(close),
          volume: volume == null ? 0 : Math.round(volume),
        });
      }
      const cleaned = dedupeBars(bars);
      if (!cleaned.length) {
        lastError = new Error("yahoo chart no bars");
        continue;
      }
      return { bars: cleaned, events: result.events || {} };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) return null;
  return null;
}

function isoFromYahooDate(value) {
  if (!value) return null;
  if (typeof value.fmt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.fmt)) return value.fmt;
  if (Number.isFinite(value.raw)) return ymdFromUtc(value.raw * 1000);
  return null;
}

function dividendFromChart(events, todayIso) {
  const dividends = events && events.dividends;
  if (!dividends || typeof dividends !== "object") return null;
  const rows = Object.values(dividends)
    .map((row) => {
      const unix = Number(row && (row.date || row.raw));
      if (!Number.isFinite(unix)) return null;
      return { iso: ymdFromUtc(unix * 1000), amount: row.amount };
    })
    .filter(Boolean)
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
  if (!rows.length) return null;
  const upcoming = rows.find((row) => row.iso >= todayIso);
  const picked = upcoming || rows[rows.length - 1];
  const amount = Number.isFinite(Number(picked.amount)) ? Number(picked.amount) : null;
  return {
    type: "dividend",
    label: "Dividend",
    iso: picked.iso,
    date: formatIso(picked.iso),
    status: eventStatus(picked.iso, todayIso),
    detail: amount == null ? "Dividend" : "Amount " + amount,
    source: "yahoo",
  };
}

async function fetchCalendar(yahooSymbol) {
  try {
    const session = await getCrumb();
    if (!session) return null;
    const url = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/" +
      encodeURIComponent(yahooSymbol) +
      "?modules=calendarEvents&crumb=" + encodeURIComponent(session.crumb);
    const res = await fetch(url, {
      headers: Object.assign({}, UA, { Cookie: session.cookie }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const calendar = json && json.quoteSummary && json.quoteSummary.result &&
      json.quoteSummary.result[0] && json.quoteSummary.result[0].calendarEvents;
    return calendar || null;
  } catch (err) {
    return null;
  }
}

async function fetchEventParts(yahooSymbol) {
  const todayIso = ymdFromUtc(todayUtc());
  const chart = await fetchDailyBars(yahooSymbol, 800);
  const calendar = await fetchCalendar(yahooSymbol);
  let earnings = null;
  let dividend = null;
  if (calendar && calendar.earnings && Array.isArray(calendar.earnings.earningsDate)) {
    const iso = isoFromYahooDate(calendar.earnings.earningsDate[0]);
    if (iso) {
      const average = calendar.earnings.earningsAverage && calendar.earnings.earningsAverage.fmt;
      const estimate = calendar.earnings.isEarningsDateEstimate ? "Estimated date" : "Scheduled date";
      earnings = {
        type: "earnings",
        label: "Earnings",
        iso,
        date: formatIso(iso),
        status: eventStatus(iso, todayIso),
        detail: average ? estimate + " · EPS " + average : estimate,
        source: "yahoo",
      };
    }
  }
  if (calendar && calendar.dividendDate) {
    const iso = isoFromYahooDate(calendar.dividendDate);
    if (iso) {
      const ex = isoFromYahooDate(calendar.exDividendDate);
      dividend = {
        type: "dividend",
        label: "Dividend",
        iso,
        date: formatIso(iso),
        status: eventStatus(iso, todayIso),
        detail: ex ? "Payable · ex-date " + formatIso(ex) : "Payable",
        source: "yahoo",
      };
    }
  }
  if (!dividend && chart && chart.events) dividend = dividendFromChart(chart.events, todayIso);
  return { earnings, dividend };
}

module.exports = { fetchDailyBars, fetchEventParts };
