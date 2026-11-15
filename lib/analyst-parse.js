"use strict";

function lineValue(text, label) {
  const match = String(text || "").match(new RegExp("^" + label + "\\s*:\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
}

function parsePicks(text) {
  return {
    date: lineValue(text, "Date"),
    url: lineValue(text, "URL"),
    analystName: lineValue(text, "Analyst"),
    shortTermStock: lineValue(text, "Short-term stock"),
    longTermStock: lineValue(text, "Long-term stock"),
    shortTermIndustry: lineValue(text, "Short-term industry"),
    longTermIndustry: lineValue(text, "Long-term industry"),
    shortTermAvoid: lineValue(text, "Short-term avoid"),
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
