"use strict";

function lineValue(text, label) {
  const match = String(text || "").match(new RegExp("^" + label + "\\s*:\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
}

function parsePicks(text) {
  return {
    date: lineValue(text, "Date"),
    website: lineValue(text, "Website"),
    url: lineValue(text, "URL"),
    analystName: lineValue(text, "Analyst"),
    shortTermStock: lineValue(text, "Short-term stock buy"),
    longTermStock: lineValue(text, "Long-term stock buy"),
    shortTermIndustry: lineValue(text, "Short-term industry buy"),
    longTermIndustry: lineValue(text, "Long-term industry buy"),
    longTermIndustryAvoid: lineValue(text, "Long-term industry avoid"),
    shortTermAvoid: lineValue(text, "Short-term stock avoid"),
    note: lineValue(text, "Notes").slice(0, 4000),
  };
}

function resultDate(text) {
  const value = lineValue(text, "Date");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

module.exports = {
  parsePicks,
  resultDate,
};
