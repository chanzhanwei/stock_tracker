"use strict";

function lineValue(text, label) {
  const match = String(text || "").match(new RegExp("^" + label + "\\s*:\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
}

function parsePicks(text) {
  return {
    analystName: lineValue(text, "Analyst"),
    shortTermStock: lineValue(text, "Short-term stock"),
    longTermStock: lineValue(text, "Long-term stock"),
    shortTermIndustry: lineValue(text, "Short-term industry"),
    longTermIndustry: lineValue(text, "Long-term industry"),
    shortTermAvoid: lineValue(text, "Short-term avoid"),
  };
}

module.exports = {
  parsePicks,
};
