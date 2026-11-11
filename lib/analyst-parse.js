"use strict";

function lineValue(text, label) {
  const match = String(text || "").match(new RegExp("^" + label + "\\s*:\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
}

function parsePicks(text) {
  return {
    shortTerm: lineValue(text, "Short-term"),
    longTerm: lineValue(text, "Long-term"),
  };
}

module.exports = {
  parsePicks,
};
