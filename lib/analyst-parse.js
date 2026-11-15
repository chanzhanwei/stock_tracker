"use strict";

const LABEL_LINE = /^(?:Date|Website|URL|Analyst|Short-term stock buy|Long-term stock buy|Short-term industry buy|Long-term industry buy|Long-term industry avoid|Short-term stock avoid)\s*:/i;

function lineValue(text, label) {
  const match = String(text || "").match(new RegExp("^" + label + "\\s*:\\s*(.+)$", "im"));
  return match ? match[1].trim() : "";
}

function noteFrom(text) {
  const lines = String(text || "").split(/\r?\n/);
  let lastLabeled = -1;
  lines.forEach(function (line, index) {
    if (LABEL_LINE.test(line.trim())) lastLabeled = index;
  });
  return lines.slice(lastLabeled + 1).map(function (line) {
    return line.trim();
  }).filter(Boolean).join("\n").slice(0, 4000);
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
    note: noteFrom(text),
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
