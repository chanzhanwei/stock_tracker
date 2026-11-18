"use strict";

function priceFacts(bars) {
  const empty = { pe: null, forwardPe: null, high: null, highDate: "", declinePct: null, lastVisit: "" };
  if (!Array.isArray(bars) || !bars.length) return empty;
  let high = -Infinity;
  let highDate = "";
  for (const bar of bars) {
    if (!bar || !Number.isFinite(bar.high)) continue;
    if (bar.high > high || (bar.high === high && String(bar.time || "") > highDate)) {
      high = bar.high;
      highDate = bar.time || "";
    }
  }
  if (!Number.isFinite(high) || high <= 0) return empty;
  const last = bars[bars.length - 1];
  const close = last && Number.isFinite(last.close) ? last.close : null;
  const facts = { pe: null, forwardPe: null, high: high, highDate: highDate, declinePct: null, lastVisit: "" };
  if (close == null || close >= high) return facts;
  facts.declinePct = ((high - close) / high) * 100;
  for (let i = bars.length - 2; i >= 0; i -= 1) {
    const bar = bars[i];
    if (!bar || !Number.isFinite(bar.low) || !Number.isFinite(bar.high)) continue;
    if (bar.low <= close && bar.high >= close) {
      facts.lastVisit = bar.time || "";
      break;
    }
  }
  return facts;
}

module.exports = { priceFacts };
