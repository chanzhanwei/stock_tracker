(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.STIndicators = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var PLACEHOLDERS = [
    { id: "ichimoku", label: "Ichimoku", group: "trend" },
    { id: "psar", label: "PSAR", group: "trend" },
    { id: "adx", label: "ADX/DMI", group: "trend" },
    { id: "stoch", label: "Stoch", group: "momentum" },
    { id: "cci", label: "CCI", group: "momentum" },
    { id: "willr", label: "Will%R", group: "momentum" },
    { id: "roc", label: "ROC", group: "momentum" },
    { id: "keltner", label: "Keltner", group: "volatility" },
    { id: "donchian", label: "Donchian", group: "volatility" },
    { id: "atr", label: "ATR", group: "volatility" },
    { id: "obv", label: "OBV", group: "volume" },
    { id: "mfi", label: "MFI", group: "volume" },
    { id: "adline", label: "A/D Line", group: "volume" },
    { id: "pivots", label: "Pivots", group: "levels" },
    { id: "fibonacci", label: "Fibonacci", group: "levels" },
  ];

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  function clampPeriod(value) {
    var n = Math.floor(Number(value));
    if (!isFinite(n)) return 30;
    return Math.min(400, Math.max(2, n));
  }

  function sma(values, period) {
    var out = new Array(values.length).fill(null);
    var sum = 0;
    for (var i = 0; i < values.length; i += 1) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    var out = new Array(values.length).fill(null);
    var k = 2 / (period + 1);
    var sum = 0;
    var prev = null;
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (value == null) {
        out[i] = null;
        continue;
      }
      if (prev == null) {
        sum += value;
        if (i === period - 1) {
          prev = sum / period;
          out[i] = prev;
        }
      } else {
        prev = value * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(values, period) {
    var out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    var gain = 0;
    var loss = 0;
    for (var i = 1; i <= period; i += 1) {
      var delta = values[i] - values[i - 1];
      if (delta >= 0) gain += delta;
      else loss -= delta;
    }
    var avgGain = gain / period;
    var avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (var j = period + 1; j < values.length; j += 1) {
      var change = values[j] - values[j - 1];
      var up = change > 0 ? change : 0;
      var down = change < 0 ? -change : 0;
      avgGain = (avgGain * (period - 1) + up) / period;
      avgLoss = (avgLoss * (period - 1) + down) / period;
      out[j] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  }

  function macd(values, fast, slow, signalPeriod) {
    var fastEma = ema(values, fast);
    var slowEma = ema(values, slow);
    var line = values.map(function (_value, i) {
      if (fastEma[i] == null || slowEma[i] == null) return null;
      return fastEma[i] - slowEma[i];
    });
    var signal = new Array(values.length).fill(null);
    var start = line.findIndex(function (value) { return value != null; });
    if (start !== -1) {
      var subset = line.slice(start).map(function (value) { return value == null ? 0 : value; });
      var signalSubset = ema(subset, signalPeriod);
      for (var i = 0; i < signalSubset.length; i += 1) signal[start + i] = signalSubset[i];
    }
    var hist = line.map(function (value, i) {
      if (value == null || signal[i] == null) return null;
      return value - signal[i];
    });
    return { line: line, signal: signal, hist: hist };
  }

  function bollinger(values, period, mult) {
    var mid = sma(values, period);
    var upper = new Array(values.length).fill(null);
    var lower = new Array(values.length).fill(null);
    for (var i = period - 1; i < values.length; i += 1) {
      var sum = 0;
      for (var j = i - period + 1; j <= i; j += 1) {
        var diff = values[j] - mid[i];
        sum += diff * diff;
      }
      var sd = Math.sqrt(sum / period);
      upper[i] = mid[i] + mult * sd;
      lower[i] = mid[i] - mult * sd;
    }
    return { mid: mid, upper: upper, lower: lower };
  }

  function vwap(bars) {
    var pv = 0;
    var volume = 0;
    return bars.map(function (bar) {
      var typical = (bar.high + bar.low + bar.close) / 3;
      var size = bar.volume || 0;
      pv += typical * size;
      volume += size;
      if (!volume) return null;
      return pv / volume;
    });
  }

  function priorAverage(values, index, period) {
    if (index < period) return null;
    var sum = 0;
    for (var i = index - period; i < index; i += 1) sum += values[i] || 0;
    return sum / period;
  }

  function voteAbove(close, level) {
    if (close == null || level == null) return 0;
    if (close > level) return 1;
    if (close < level) return -1;
    return 0;
  }

  function voteSmaStack(close, fast, slow) {
    if (close == null || fast == null || slow == null) return 0;
    if (close > fast && fast > slow) return 1;
    if (close < fast && fast < slow) return -1;
    return 0;
  }

  function voteRsi(value) {
    if (value == null) return 0;
    if (value < 30) return 1;
    if (value > 70) return -1;
    return 0;
  }

  function voteMacd(line, signal) {
    if (line == null || signal == null) return 0;
    if (line > signal) return 1;
    if (line < signal) return -1;
    return 0;
  }

  function voteBollinger(close, lower, upper) {
    if (close == null || lower == null || upper == null) return 0;
    var below = close <= lower;
    var above = close >= upper;
    if (below && above) return 0;
    if (below) return 1;
    if (above) return -1;
    return 0;
  }

  function voteVolume(volume, average, close, prevClose) {
    if (volume == null || average == null || !average || prevClose == null) return 0;
    if (volume > average * 1.3 && close > prevClose) return 1;
    if (volume > average * 1.3 && close < prevClose) return -1;
    return 0;
  }

  function voteInstitutional(buyPct, sellPct) {
    if (!isFinite(buyPct) || !isFinite(sellPct)) return 0;
    if (buyPct - sellPct > 15) return 1;
    if (sellPct - buyPct > 15) return -1;
    return 0;
  }

  function aggregate(votes) {
    if (!votes.length) return { average: 0, verdict: "HOLD", confidence: 50, activeCount: 0 };
    var sum = 0;
    for (var i = 0; i < votes.length; i += 1) sum += votes[i];
    var average = sum / votes.length;
    var verdict = "HOLD";
    if (average > 0.2) verdict = "BUY";
    else if (average < -0.2) verdict = "SELL";
    return {
      average: average,
      verdict: verdict,
      confidence: Math.round(50 + average * 50),
      activeCount: votes.length,
    };
  }

  function lineData(bars, values) {
    var out = [];
    for (var i = 0; i < bars.length; i += 1) {
      if (values[i] == null) continue;
      out.push({ time: bars[i].time, value: round4(values[i]) });
    }
    return out;
  }

  function onOff(active) {
    return active ? null : "off";
  }

  function compute(bars, options) {
    var opts = options || {};
    var toggles = opts.toggles || {};
    var period = clampPeriod(opts.customPeriod);
    var safeBars = Array.isArray(bars) ? bars : [];
    var closes = safeBars.map(function (bar) { return bar.close; });
    var last = safeBars.length - 1;
    var close = last >= 0 ? closes[last] : null;
    var prevClose = last >= 1 ? closes[last - 1] : null;
    var sma20 = sma(closes, 20);
    var sma50 = sma(closes, 50);
    var smaCustom = sma(closes, period);
    var ema21 = ema(closes, 21);
    var vwapValues = vwap(safeBars);
    var rsiValues = rsi(closes, 14);
    var macdValues = macd(closes, 12, 26, 9);
    var bands = bollinger(closes, 20, 2);
    var volumes = safeBars.map(function (bar) { return bar.volume || 0; });
    var volAvg = last >= 0 ? priorAverage(volumes, last, 20) : null;
    var inst = opts.institutional || {};
    var numeric = [];
    var votes = [];

    function pushVote(entry) {
      votes.push(entry);
      if (typeof entry.vote === "number") numeric.push(entry.vote);
    }

    var sma20On = !!toggles.sma20;
    var sma50On = !!toggles.sma50;
    if (sma20On && sma50On) {
      pushVote({
        id: "sma20_50",
        label: "SMA 20/50",
        group: "trend",
        vote: voteSmaStack(close, sma20[last], sma50[last]),
        implemented: true,
        active: true,
      });
    } else {
      pushVote({
        id: "sma20",
        label: "SMA 20",
        group: "trend",
        vote: sma20On ? voteAbove(close, sma20[last]) : "off",
        implemented: true,
        active: sma20On,
      });
      pushVote({
        id: "sma50",
        label: "SMA 50",
        group: "trend",
        vote: sma50On ? voteAbove(close, sma50[last]) : "off",
        implemented: true,
        active: sma50On,
      });
    }

    var customOn = !!toggles.smaCustom;
    pushVote({
      id: "smaCustom",
      label: "Custom SMA " + period,
      group: "trend",
      vote: customOn ? voteAbove(close, smaCustom[last]) : "off",
      implemented: true,
      active: customOn,
    });
    var emaOn = !!toggles.ema21;
    pushVote({
      id: "ema21",
      label: "EMA 21",
      group: "trend",
      vote: emaOn ? voteAbove(close, ema21[last]) : "off",
      implemented: true,
      active: emaOn,
    });
    var vwapOn = !!toggles.vwap;
    pushVote({
      id: "vwap",
      label: "VWAP",
      group: "trend",
      vote: vwapOn ? voteAbove(close, vwapValues[last]) : "off",
      implemented: true,
      active: vwapOn,
    });
    var rsiOn = !!toggles.rsi;
    pushVote({
      id: "rsi",
      label: "RSI 14",
      group: "momentum",
      vote: rsiOn ? voteRsi(rsiValues[last]) : "off",
      implemented: true,
      active: rsiOn,
    });
    var macdOn = !!toggles.macd;
    pushVote({
      id: "macd",
      label: "MACD 12/26/9",
      group: "momentum",
      vote: macdOn ? voteMacd(macdValues.line[last], macdValues.signal[last]) : "off",
      implemented: true,
      active: macdOn,
    });
    var bbOn = !!toggles.bollinger;
    pushVote({
      id: "bollinger",
      label: "Bollinger (20, 2)",
      group: "volatility",
      vote: bbOn ? voteBollinger(close, bands.lower[last], bands.upper[last]) : "off",
      implemented: true,
      active: bbOn,
    });
    var volumeOn = !!toggles.volume;
    pushVote({
      id: "volume",
      label: "Volume bars",
      group: "volume",
      vote: volumeOn ? voteVolume(last >= 0 ? volumes[last] : null, volAvg, close, prevClose) : "off",
      implemented: true,
      active: volumeOn,
    });
    var instOn = !!toggles.institutional;
    pushVote({
      id: "institutional",
      label: "Institutional buy/sell",
      group: "levels",
      vote: instOn ? voteInstitutional(Number(inst.buyPct), Number(inst.sellPct)) : "off",
      implemented: true,
      active: instOn,
    });
    PLACEHOLDERS.forEach(function (item) {
      pushVote({
        id: item.id,
        label: item.label,
        group: item.group,
        vote: "na",
        implemented: false,
        active: false,
      });
    });

    var summary = aggregate(numeric);
    var volumeBars = safeBars.map(function (bar) {
      var up = bar.close >= bar.open;
      return {
        time: bar.time,
        value: bar.volume || 0,
        color: up ? "rgba(63, 191, 138, 0.62)" : "rgba(227, 106, 106, 0.62)",
      };
    });
    var quote = null;
    if (last >= 0) {
      var change = prevClose == null ? 0 : close - prevClose;
      quote = {
        time: safeBars[last].time,
        close: close,
        change: change,
        changePct: prevClose ? (change / prevClose) * 100 : 0,
      };
    }
    return {
      sma20: lineData(safeBars, sma20),
      sma50: lineData(safeBars, sma50),
      smaCustom: lineData(safeBars, smaCustom),
      ema21: lineData(safeBars, ema21),
      vwap: lineData(safeBars, vwapValues),
      bbMid: lineData(safeBars, bands.mid),
      bbUpper: lineData(safeBars, bands.upper),
      bbLower: lineData(safeBars, bands.lower),
      rsi: lineData(safeBars, rsiValues),
      macd: lineData(safeBars, macdValues.line),
      macdSignal: lineData(safeBars, macdValues.signal),
      macdHist: safeBars.map(function (bar, i) {
        if (macdValues.hist[i] == null) return null;
        var value = round4(macdValues.hist[i]);
        return {
          time: bar.time,
          value: value,
          color: value >= 0 ? "rgba(63, 191, 138, 0.75)" : "rgba(227, 106, 106, 0.75)",
        };
      }).filter(Boolean),
      volume: volumeBars,
      votes: votes,
      average: summary.average,
      verdict: summary.verdict,
      confidence: summary.confidence,
      activeCount: summary.activeCount,
      quote: quote,
      customPeriod: period,
    };
  }

  return {
    compute: compute,
    aggregate: aggregate,
    voteAbove: voteAbove,
    voteSmaStack: voteSmaStack,
    voteRsi: voteRsi,
    voteMacd: voteMacd,
    voteBollinger: voteBollinger,
    voteVolume: voteVolume,
    voteInstitutional: voteInstitutional,
    clampPeriod: clampPeriod,
    onOff: onOff,
  };
});
