"use strict";

function roundRate(value) {
  return Math.round(value * 1e6) / 1e6;
}

function perMillion(prompt, completion) {
  const input = Number(prompt);
  const output = Number(completion);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null;
  const inputPerMillion = roundRate(input * 1e6);
  const outputPerMillion = roundRate(output * 1e6);
  return {
    input: inputPerMillion,
    output: outputPerMillion,
    total: roundRate(inputPerMillion + outputPerMillion),
  };
}

function ratesFromCatalog(catalog, ids) {
  const byId = {};
  (catalog || []).forEach(function (row) {
    if (row && row.id) byId[row.id] = row;
  });
  const prices = {};
  (ids || []).forEach(function (id) {
    const row = byId[id];
    const rate = row && row.pricing ? perMillion(row.pricing.prompt, row.pricing.completion) : null;
    if (rate) prices[id] = rate;
  });
  return prices;
}

async function loadPrices(ids) {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    return ratesFromCatalog(data && data.data, ids);
  } catch (err) {
    return {};
  }
}

module.exports = {
  perMillion,
  ratesFromCatalog,
  loadPrices,
};
