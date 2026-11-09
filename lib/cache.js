"use strict";

const store = new Map();

const TTL = {
  ohlcv: 15 * 60 * 1000,
  events: 60 * 60 * 1000,
  institutional: 24 * 60 * 60 * 1000,
};

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

function clear() {
  store.clear();
}

module.exports = { TTL, get, set, clear };
