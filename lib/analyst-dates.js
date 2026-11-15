"use strict";

const TWO_MONTH_MESSAGE = "Nothing from the last two months is waiting for this source.";

function pad(value) {
  return String(value).padStart(2, "0");
}

function sydneyParts(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map = {};
  fmt.formatToParts(date).forEach(function (part) {
    map[part.type] = part.value;
  });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function zonedMidnight(year, month, day) {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const seen = sydneyParts(new Date(utcGuess));
  const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  return new Date(utcGuess - (seenUtc - utcGuess));
}

function shiftMonths(year, month, day, delta) {
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextYear = shifted.getUTCFullYear();
  const nextMonth = shifted.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return { year: nextYear, month: nextMonth, day: Math.min(day, lastDay) };
}

function tradeWindow(now) {
  const date = now instanceof Date ? now : new Date();
  const parts = sydneyParts(date);
  const cutoff = shiftMonths(parts.year, parts.month, parts.day, -2);
  return {
    today: parts.year + "-" + pad(parts.month) + "-" + pad(parts.day),
    cutoffDay: cutoff.year + "-" + pad(cutoff.month) + "-" + pad(cutoff.day),
    cutoffIso: zonedMidnight(cutoff.year, cutoff.month, cutoff.day).toISOString(),
  };
}

function isWithinWindow(publishedAt, cutoffIso) {
  if (publishedAt == null || publishedAt === "") return true;
  const time = publishedAt instanceof Date ? publishedAt.getTime() : Date.parse(publishedAt);
  if (Number.isNaN(time)) return true;
  return time >= Date.parse(cutoffIso);
}

function channelChoice(items, cutoffIso) {
  const eligible = (items || []).filter(function (item) {
    return item && item.url && isWithinWindow(item.publishedAt, cutoffIso);
  });
  eligible.sort(function (a, b) {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : -1;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : -1;
    return bt - at;
  });
  const latest = eligible[0] || null;
  if (!latest) return { item: null, message: TWO_MONTH_MESSAGE };
  if (latest.processed) return { item: null, message: "That post is already analysed." };
  return { item: latest, message: "" };
}

module.exports = {
  TWO_MONTH_MESSAGE,
  tradeWindow,
  isWithinWindow,
  channelChoice,
};
