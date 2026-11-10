(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.STLedgerScore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var modelVersion = "v4-hypothesis";
  var DECAY_WINDOW_DAYS = 30;
  var CONFIRMATION_WINDOW_DAYS = 7;
  var CONFIRMATION_STEP = 0.25;
  var CONFIRMATION_CAP = 2.0;
  var MIN_HISTORY_SAMPLE = 5;
  var EARNINGS_WINDOW_DAYS = 10;
  var EARNINGS_BOOST = 1.25;
  var MOMENTUM_RECENT_DAYS = 15;

  var FILING_WEIGHTS = {
    "13D": 3.0,
    "FORM 4": 2.0,
    BUYBACK: 1.6,
    "13G": 1.5,
    CONGRESS: 1.4,
    SECONDARY: 1.4,
    "FORM 144": 1.3,
    INDEX: 1.3,
    "SHORT INT": 1.2,
    CONVERTIBLE: 1.2,
    CORPORATE_ACTION: 1.2,
    "DARK POOL": 1.1,
    SECLEND: 1.1,
    "13F": 1.0,
    OPTIONS: 1.0,
    ETF: 1.0,
  };

  var SOURCE_LAG = {
    OPTIONS: 0,
    "DARK POOL": 0,
    INDEX: 0,
    "FORM 4": 1,
    "FORM 144": 1,
    BUYBACK: 1,
    SECLEND: 1,
    SECONDARY: 1,
    CORPORATE_ACTION: 1,
    "13D": 2,
    "13G": 2,
    CONVERTIBLE: 2,
    "SHORT INT": 10,
    CONGRESS: 30,
    "13F": 45,
    ETF: 45,
  };

  var SOURCE_NOTES = {
    OPTIONS: "Same-day",
    "DARK POOL": "Same-day",
    INDEX: "Same-day",
    "SHORT INT": "FINRA is bi-monthly; 10 is a typical midpoint, not the schedule",
    CONGRESS: "Typical. Legal maximum under the STOCK Act is 45.",
    "13F": "Quarter-end plus the statutory filing window",
    ETF: "Quarter-end plus the statutory filing window",
  };

  var KIND_ORDER = [
    "13D", "FORM 4", "BUYBACK", "13G", "CONGRESS", "SECONDARY", "FORM 144", "INDEX",
    "SHORT INT", "CONVERTIBLE", "CORPORATE_ACTION", "DARK POOL", "SECLEND", "13F", "OPTIONS", "ETF",
  ];

  var REPUTATION = {
    activist: { label: "Known activist", weight: 1.5 },
    "insider-cluster": { label: "Insider cluster", weight: 1.3 },
    insider: { label: "Single insider", weight: 1.0 },
    "passive-index": { label: "Passive index fund", weight: 0.6 },
    "scheduled-plan": { label: "10b5-1 scheduled sale", weight: 0.5 },
  };

  var MECHANICAL = { INDEX: true, CORPORATE_ACTION: true };
  var CORE_KINDS = { "FORM 4": true, "13D": true, "13G": true, "13F": true };
  var SECTOR_COLORS = {
    Technology: "#C9A24B",
    Industrials: "#4C9A6A",
    Healthcare: "#5E8FB0",
    Consumer: "#B4543A",
    Financials: "#8E7FC9",
  };
  var UNKNOWN_SECTOR = "#8A8F98";

  function sourceLagFor(item) {
    var kind = item && item.kind;
    return Object.prototype.hasOwnProperty.call(SOURCE_LAG, kind) ? SOURCE_LAG[kind] : 0;
  }

  function effectiveDaysAgo(item) {
    return Number(item && item.daysAgo) + sourceLagFor(item);
  }

  function freshnessTier(daysAgo) {
    var n = typeof daysAgo === "object" && daysAgo ? Number(daysAgo.daysAgo) : Number(daysAgo);
    if (n <= 1) return 1;
    if (n <= 7) return 2;
    if (n <= 30) return 3;
    return 4;
  }

  function decay(item) {
    return Math.max(0, 1 - effectiveDaysAgo(item) / DECAY_WINDOW_DAYS);
  }

  function isRealSignal(item) {
    if (!item || item.excluded) return false;
    if (item.action === "flat") return false;
    return true;
  }

  function isMechanical(item) {
    return !!(item && MECHANICAL[item.kind]);
  }

  function reputationWeight(item) {
    if (isMechanical(item)) return 0.7;
    var row = item && REPUTATION[item.filerType];
    return row ? row.weight : 1;
  }

  function earningsFactor(item) {
    if (!item || isMechanical(item)) return 1;
    if (item.daysToEarnings == null) return 1;
    if (Number(item.daysToEarnings) <= EARNINGS_WINDOW_DAYS) return EARNINGS_BOOST;
    return 1;
  }

  function sameRow(item, other) {
    if (other === item) return true;
    return item && other && item.id != null && other.id === item.id;
  }

  function confirmationFor(item, signals) {
    var none = { count: 0, multiplier: 1 };
    if (!isRealSignal(item)) return none;
    var kinds = {};
    (signals || []).forEach(function (other) {
      if (sameRow(item, other) || !isRealSignal(other)) return;
      if (other.ticker !== item.ticker || other.kind === item.kind) return;
      if (Math.abs(Number(other.daysAgo) - Number(item.daysAgo)) <= CONFIRMATION_WINDOW_DAYS) kinds[other.kind] = true;
    });
    var count = Object.keys(kinds).length;
    return { count: count, multiplier: Math.min(1 + CONFIRMATION_STEP * count, CONFIRMATION_CAP) };
  }

  function contribution(item, metric, signals) {
    if (!isRealSignal(item)) return 0;
    if (metric === "count") {
      if (item.action === "buy") return 1;
      if (item.action === "sell") return -1;
      return 0;
    }
    var deltaPct = Number(item.to) - Number(item.from);
    if (metric === "dollar") return (deltaPct / 100) * Number(item.marketCapB);
    var filingW = Object.prototype.hasOwnProperty.call(FILING_WEIGHTS, item.kind) ? FILING_WEIGHTS[item.kind] : 1;
    var conf = confirmationFor(item, signals || [item]);
    return deltaPct * filingW * decay(item) * reputationWeight(item) * earningsFactor(item) * conf.multiplier;
  }

  function sectorRollup(signals, metric) {
    var rows = {};
    var order = [];
    (signals || []).forEach(function (item) {
      var name = item.sector || "Unknown";
      if (!rows[name]) {
        rows[name] = { sector: name, total: 0, recent: 0, older: 0, buys: 0, sells: 0, momentum: 0 };
        order.push(name);
      }
      var row = rows[name];
      var value = contribution(item, metric, signals);
      row.total += value;
      if (Number(item.daysAgo) <= MOMENTUM_RECENT_DAYS) row.recent += value;
      else if (Number(item.daysAgo) <= DECAY_WINDOW_DAYS) row.older += value;
      if (isRealSignal(item) && item.action === "buy") row.buys += 1;
      if (isRealSignal(item) && item.action === "sell") row.sells += 1;
    });
    return order.map(function (name) { return rows[name]; }).map(function (row) {
      row.momentum = row.recent - row.older;
      return row;
    }).sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      return a.sector < b.sector ? -1 : a.sector > b.sector ? 1 : 0;
    });
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function trendSeries(signals, metric) {
    var sectors = [];
    (signals || []).forEach(function (item) {
      var name = item.sector || "Unknown";
      if (sectors.indexOf(name) < 0) sectors.push(name);
    });
    var points = [];
    for (var d = 0; d <= DECAY_WINDOW_DAYS; d += 1) {
      var threshold = DECAY_WINDOW_DAYS - d;
      var values = {};
      sectors.forEach(function (sector) {
        var sum = 0;
        (signals || []).forEach(function (item) {
          if ((item.sector || "Unknown") === sector && Number(item.daysAgo) >= threshold) {
            sum += contribution(item, metric, signals);
          }
        });
        values[sector] = round2(sum);
      });
      points.push({ label: d === DECAY_WINDOW_DAYS ? "Today" : String(DECAY_WINDOW_DAYS - d) + "d", values: values });
    }
    return points;
  }

  function historyLine(item) {
    var stats = item && item.historicalStats;
    if (!stats) return "";
    var n = Number(stats.sampleSize);
    if (n < MIN_HISTORY_SAMPLE) return "History: insufficient sample (n=" + n + ") — hidden below n=5";
    var hits = Math.round(Number(stats.winRate) * n);
    var word = Number(stats.winRate) >= 0.5 ? "buyer" : "seller";
    var ret = Number(stats.avgExcessReturn60d);
    var signed = ret > 0 ? "+" + ret : String(ret);
    return "History: net " + word + " on " + hits + "/" + n + " similar signals, avg " + signed + "% 60d";
  }

  function summaryLine(item) {
    if (!item) return "";
    if (item.customSummary) return item.customSummary;
    if (item.action === "flat") return item.holder + " holds position unchanged";
    var verb = item.action === "buy" ? "increases" : "reduces";
    return item.holder + " " + verb + " stake from " + item.from + "% to " + item.to + "%";
  }

  function lagLabel(item) {
    var n = Number(item && item.daysAgo);
    var base = n === 0 ? "Today" : n === 1 ? "Yesterday" : n <= 30 ? n + "d ago" : n + "d old";
    var lag = sourceLagFor(item);
    if (lag > 0) base += " (+" + lag + "d lag)";
    return base;
  }

  function formatTotal(value, metric) {
    var n = Number(value) || 0;
    var sign = n > 0 ? "+" : "";
    if (metric === "count") return sign + String(Math.round(n));
    if (metric === "dollar") return sign + n.toFixed(2) + "B";
    return sign + n.toFixed(1);
  }

  function sectorColor(name) {
    return SECTOR_COLORS[name] || UNKNOWN_SECTOR;
  }

  return {
    modelVersion: modelVersion,
    DECAY_WINDOW_DAYS: DECAY_WINDOW_DAYS,
    CONFIRMATION_WINDOW_DAYS: CONFIRMATION_WINDOW_DAYS,
    CONFIRMATION_STEP: CONFIRMATION_STEP,
    CONFIRMATION_CAP: CONFIRMATION_CAP,
    MIN_HISTORY_SAMPLE: MIN_HISTORY_SAMPLE,
    EARNINGS_WINDOW_DAYS: EARNINGS_WINDOW_DAYS,
    EARNINGS_BOOST: EARNINGS_BOOST,
    FILING_WEIGHTS: FILING_WEIGHTS,
    SOURCE_LAG: SOURCE_LAG,
    SOURCE_NOTES: SOURCE_NOTES,
    KIND_ORDER: KIND_ORDER,
    REPUTATION: REPUTATION,
    CORE_KINDS: CORE_KINDS,
    SECTOR_COLORS: SECTOR_COLORS,
    sourceLagFor: sourceLagFor,
    effectiveDaysAgo: effectiveDaysAgo,
    freshnessTier: freshnessTier,
    decay: decay,
    isRealSignal: isRealSignal,
    isMechanical: isMechanical,
    reputationWeight: reputationWeight,
    earningsFactor: earningsFactor,
    confirmationFor: confirmationFor,
    contribution: contribution,
    sectorRollup: sectorRollup,
    trendSeries: trendSeries,
    historyLine: historyLine,
    summaryLine: summaryLine,
    lagLabel: lagLabel,
    formatTotal: formatTotal,
    sectorColor: sectorColor,
  };
});
