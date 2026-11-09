(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.STFavorites = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function storageKey(email) {
    return "stock_tracker.favorites." + String(email || "").trim().toLowerCase();
  }

  function read(email) {
    try {
      var raw = localStorage.getItem(storageKey(email));
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (row) {
        return row && typeof row.exchange === "string" && typeof row.symbol === "string";
      }).map(function (row) {
        return { exchange: row.exchange.toUpperCase(), symbol: row.symbol.toUpperCase() };
      });
    } catch (err) {
      return [];
    }
  }

  function write(email, list) {
    localStorage.setItem(storageKey(email), JSON.stringify(list));
  }

  function has(email, exchange, symbol) {
    return read(email).some(function (row) {
      return row.exchange === exchange && row.symbol === symbol;
    });
  }

  function toggle(email, exchange, symbol) {
    var list = read(email);
    var next = list.filter(function (row) {
      return !(row.exchange === exchange && row.symbol === symbol);
    });
    if (next.length === list.length) next.push({ exchange: exchange, symbol: symbol });
    write(email, next);
    return next;
  }

  return { storageKey: storageKey, read: read, write: write, has: has, toggle: toggle };
});
