"use strict";

const KINDS = ["youtube", "x", "website", "substack"];

function fetchError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function escapeReg(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXml(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function htmlToText(html) {
  return decodeXml(String(html || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const re = new RegExp("<" + escapeReg(name) + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + escapeReg(name) + ">", "i");
  const match = String(block || "").match(re);
  if (!match) return "";
  return htmlToText(match[1]);
}

function blocks(xml, name) {
  const re = new RegExp("<" + escapeReg(name) + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + escapeReg(name) + ">", "gi");
  const out = [];
  let match;
  const source = String(xml || "");
  while ((match = re.exec(source))) out.push(match[1]);
  return out;
}

function atomLink(block) {
  const links = String(block || "").match(/<link\b[^>]*>/gi) || [];
  let href = "";
  for (const link of links) {
    const rel = (link.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || "alternate";
    const candidate = (link.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (!candidate) continue;
    if (rel === "alternate" || !href) href = decodeXml(candidate);
  }
  return href;
}

function normalizeDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function parseFeed(xml) {
  const entries = blocks(xml, "entry");
  const rows = entries.length ? entries : blocks(xml, "item");
  return rows.map(function (block) {
    const videoId = tag(block, "yt:videoId");
    const link = videoId
      ? "https://www.youtube.com/watch?v=" + videoId
      : (atomLink(block) || tag(block, "link"));
    const rawBody = tag(block, "content:encoded") || tag(block, "description") || tag(block, "summary") || "";
    return {
      url: link,
      title: tag(block, "title"),
      body: videoId ? "" : rawBody.slice(0, 20000),
      publishedAt: normalizeDate(tag(block, "published") || tag(block, "updated") || tag(block, "pubDate")),
    };
  }).filter(function (row) {
    return /^https?:\/\//i.test(row.url);
  });
}

function publishedFromX(row) {
  if (row && row.created_timestamp != null && isFinite(Number(row.created_timestamp))) {
    const n = Number(row.created_timestamp);
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  return normalizeDate(row && row.created_at);
}

function itemsFromXPayload(data) {
  const results = data && Array.isArray(data.results) ? data.results : [];
  return results.filter(function (row) {
    return row && row.type === "status" && row.url && row.text;
  }).map(function (row) {
    return {
      url: String(row.url),
      title: "",
      body: String(row.text).slice(0, 20000),
      publishedAt: publishedFromX(row),
    };
  });
}

function looksLikeFeed(text, contentType) {
  const body = String(text || "");
  const type = String(contentType || "");
  const tagged = /<(rss|feed)\b/i.test(body);
  if (!tagged) return false;
  return /rss|atom|xml/i.test(type) || /^\s*(<\?xml|<(rss|feed)\b)/i.test(body);
}

function feedLink(html) {
  const links = String(html || "").match(/<link\b[^>]*>/gi) || [];
  for (const link of links) {
    const rel = (link.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    const type = (link.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    const href = (link.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (!href) continue;
    if (/alternate/i.test(rel) && /rss|atom|xml/i.test(type)) return decodeXml(href);
  }
  return "";
}

function isBlockedHost(host) {
  const name = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!name || name === "localhost" || name === "::1" || name.endsWith(".local")) return true;
  if (name === "metadata.google.internal" || name === "0.0.0.0") return true;
  if (name.startsWith("127.") || name.startsWith("10.") || name.startsWith("192.168.") || name.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(name)) return true;
  return false;
}

function assertHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    throw fetchError("bad_url", "Enter an http or https URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw fetchError("bad_url", "Enter an http or https URL.");
  }
  const host = url.hostname.toLowerCase();
  if (host === "metadata.google.internal" || host === "169.254.169.254") {
    throw fetchError("bad_url", "That URL is not a public source.");
  }
  if (process.env.VERCEL && isBlockedHost(host)) {
    throw fetchError("bad_url", "That URL is not a public source.");
  }
  return url;
}

function hostOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function youtubeVideoId(url) {
  const host = hostOf(url);
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return /^[\w-]{6,}$/.test(id) ? id : "";
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return "";
  if (url.pathname === "/watch") return url.searchParams.get("v") || "";
  const nested = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return nested ? nested[1] : "";
}

function kindForUrl(url) {
  const host = hostOf(url);
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com" || host === "music.youtube.com") return "youtube";
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com" || host === "mobile.x.com") return "x";
  if (host === "substack.com" || host.endsWith(".substack.com")) return "substack";
  return "website";
}

function canonicalPostUrl(value) {
  let raw = String(value || "").trim();
  if (!raw) throw fetchError("bad_url", "Enter an http or https URL.");
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  const url = assertHttpUrl(raw);
  url.hash = "";
  const host = hostOf(url);
  const videoId = youtubeVideoId(url);
  if (videoId) return "https://www.youtube.com/watch?v=" + videoId;
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com" || host === "music.youtube.com") {
    url.protocol = "https:";
    url.hostname = host === "youtu.be" ? "youtu.be" : "www.youtube.com";
    url.search = "";
  } else if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com" || host === "mobile.x.com") {
    url.protocol = "https:";
    url.hostname = "x.com";
    url.search = "";
    const status = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (status) return "https://x.com/" + status[1].toLowerCase() + "/status/" + status[2];
  } else {
    url.hostname = host;
    const kept = [];
    url.searchParams.forEach(function (param, key) {
      if (!/^utm_/i.test(key) && key !== "fbclid" && key !== "gclid") kept.push([key, param]);
    });
    url.search = "";
    kept.forEach(function (pair) { url.searchParams.append(pair[0], pair[1]); });
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  const rendered = url.toString();
  if (!url.search && !url.hash && rendered.endsWith("/") && (url.pathname === "/" || url.pathname === "")) {
    return rendered.slice(0, -1);
  }
  return rendered;
}

async function fetchText(startUrl, limit) {
  const max = limit || 1000000;
  let current = startUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    assertHttpUrl(current);
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": "stock_tracker/1.0 (analyst desk)",
        "Accept": "text/html, application/atom+xml, application/rss+xml, application/xml, text/xml, application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw fetchError("fetch_failed", "The source could not be fetched.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw fetchError("fetch_failed", "The source could not be fetched (" + res.status + ").");
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let text = "";
    if (!reader) {
      text = await res.text();
    } else {
      const chunks = [];
      let size = 0;
      while (size < max) {
        const step = await reader.read();
        if (step.done) break;
        size += step.value.byteLength;
        chunks.push(Buffer.from(step.value));
        if (size >= max) break;
      }
      try { await reader.cancel(); } catch (err) { /* the rest of a long page is unused */ }
      text = Buffer.concat(chunks).toString("utf8");
    }
    return {
      text: text.slice(0, max),
      contentType: res.headers.get("content-type") || "",
      url: current,
    };
  }
  throw fetchError("fetch_failed", "The source redirected too many times.");
}

async function youtubeChannelId(name) {
  const raw = String(name || "").trim();
  const direct = raw.match(/(?:channel\/|channel_id=)(UC[\w-]{20,})/i) || raw.match(/^(UC[\w-]{20,})$/);
  if (direct) return direct[1];
  let pageUrl = "";
  if (/^https?:\/\//i.test(raw)) {
    pageUrl = assertHttpUrl(raw).toString();
  } else {
    const handle = raw.replace(/^@/, "").trim();
    if (!/^[\w.-]{2,80}$/.test(handle)) {
      throw fetchError("bad_youtube", "Enter a YouTube channel URL, a channel id, or an @handle.");
    }
    pageUrl = "https://www.youtube.com/@" + encodeURIComponent(handle);
  }
  const page = await fetchText(pageUrl, 1500000);
  const found = page.text.match(/channel_id=(UC[\w-]{20,})/)
    || page.text.match(/\/channel\/(UC[\w-]{20,})/)
    || page.text.match(/"externalId":"(UC[\w-]{20,})"/)
    || page.text.match(/"browseId":"(UC[\w-]{20,})"/);
  if (!found) {
    throw fetchError("youtube_channel_not_found", "That YouTube channel was not found. Use a channel URL, a channel id, or an @handle.");
  }
  return found[1];
}

async function discoverYoutube(name) {
  const channelId = await youtubeChannelId(name);
  const feedUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=" + encodeURIComponent(channelId);
  const feed = await fetchText(feedUrl);
  const items = parseFeed(feed.text).filter(function (row) {
    return row.url.indexOf("watch?v=") !== -1;
  });
  if (!items.length) throw fetchError("no_items", "No videos were found for that channel.");
  return items.slice(0, 20);
}

function xHandle(name) {
  const raw = String(name || "").trim();
  const fromUrl = raw.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:\/|$|\?)/i);
  if (fromUrl) return fromUrl[1];
  const handle = raw.match(/^@?([A-Za-z0-9_]{1,15})$/);
  if (handle) return handle[1];
  throw fetchError("bad_x_user", "Enter an X handle, like @name, or a profile URL.");
}

async function discoverX(name) {
  const handle = xHandle(name);
  const endpoint = "https://api.fxtwitter.com/2/profile/" + encodeURIComponent(handle) + "/statuses?count=20";
  const res = await fetchText(endpoint);
  let data;
  try {
    data = JSON.parse(res.text);
  } catch (err) {
    throw fetchError("x_unavailable", "That X user could not be fetched.");
  }
  if (!data || data.code !== 200) throw fetchError("x_unavailable", "That X user could not be fetched.");
  const items = itemsFromXPayload(data);
  if (!items.length) throw fetchError("no_items", "No posts were found for that X user.");
  return items;
}

async function discoverWebsite(name) {
  let raw = String(name || "").trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  const page = await fetchText(assertHttpUrl(raw).toString());
  if (looksLikeFeed(page.text, page.contentType)) return parseFeed(page.text).slice(0, 20);
  const alternate = feedLink(page.text);
  if (alternate) {
    const feedUrl = new URL(alternate, page.url).toString();
    const feed = await fetchText(feedUrl);
    if (looksLikeFeed(feed.text, feed.contentType)) return parseFeed(feed.text).slice(0, 20);
  }
  const title = tag(page.text, "title") || page.url;
  return [{
    url: page.url,
    title: title.slice(0, 300),
    body: htmlToText(page.text).slice(0, 20000),
    publishedAt: null,
  }];
}

function itemFromXStatus(data, handle, statusId) {
  const tweet = (data && (data.tweet || data.status))
    || (data && Array.isArray(data.results) && data.results[0])
    || null;
  const text = tweet && (tweet.text || tweet.full_text || tweet.raw_text);
  if (!text) return null;
  const author = (tweet.author && (tweet.author.screen_name || tweet.author.handle || tweet.author.username))
    || (tweet.user && (tweet.user.screen_name || tweet.user.username))
    || handle;
  const fallback = "https://x.com/" + String(author || handle || "x").replace(/^@/, "") + "/status/" + statusId;
  let url = fallback;
  try {
    url = canonicalPostUrl(tweet.url || fallback);
  } catch (err) {
    url = fallback;
  }
  return {
    sourceName: String(author || handle || "").replace(/^@/, ""),
    item: {
      url: url,
      title: "",
      body: String(text).slice(0, 20000),
      publishedAt: publishedFromX(tweet),
    },
  };
}

async function discoverXStatus(statusId, handle) {
  const res = await fetchText("https://api.fxtwitter.com/status/" + encodeURIComponent(statusId));
  let data = null;
  try {
    data = JSON.parse(res.text);
  } catch (err) {
    data = null;
  }
  const parsed = itemFromXStatus(data, handle, statusId);
  if (!parsed) throw fetchError("x_unavailable", "That X post could not be fetched.");
  return parsed;
}

function publicationName(url, kind) {
  if (kind === "substack") {
    const host = url.hostname.toLowerCase();
    if (host.endsWith(".substack.com")) return host.slice(0, -".substack.com".length);
    return host;
  }
  if (kind === "website") return canonicalPostUrl(url.toString());
  return url.hostname;
}

async function openTarget(raw) {
  const canonical = canonicalPostUrl(raw);
  const url = new URL(canonical);
  const kind = kindForUrl(url);
  if (kind === "youtube") {
    const videoId = youtubeVideoId(url);
    if (videoId) {
      const watch = "https://www.youtube.com/watch?v=" + videoId;
      let author = "YouTube";
      let title = "";
      try {
        const oembed = await fetchText("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch));
        const data = JSON.parse(oembed.text);
        if (data && data.author_name) author = String(data.author_name).slice(0, 300);
        if (data && data.title) title = String(data.title).slice(0, 300);
      } catch (err) { /* the title stays blank; the transcript is still pasted */ }
      return {
        kind: "youtube",
        sourceName: author,
        items: [{ url: watch, title: title, body: "", publishedAt: null }],
        focusUrl: watch,
      };
    }
    const handle = url.pathname.match(/^\/@([^/]+)/);
    return {
      kind: "youtube",
      sourceName: handle ? decodeURIComponent(handle[1]) : canonical,
      items: await discoverYoutube(canonical),
      focusUrl: null,
    };
  }
  if (kind === "x") {
    const status = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
    if (status) {
      const parsed = await discoverXStatus(status[2], status[1]);
      return {
        kind: "x",
        sourceName: parsed.sourceName || status[1],
        items: [parsed.item],
        focusUrl: parsed.item.url,
      };
    }
    const handle = xHandle(canonical);
    return { kind: "x", sourceName: handle, items: await discoverX(handle), focusUrl: null };
  }
  const sourceName = publicationName(url, kind);
  if (!url.pathname) {
    const items = await discoverWebsite(canonical);
    if (!items.length) throw fetchError("no_items", "No posts were found at that URL.");
    return { kind: kind, sourceName: sourceName, items: items, focusUrl: null };
  }
  const page = await fetchText(canonical);
  if (looksLikeFeed(page.text, page.contentType)) {
    const items = parseFeed(page.text).slice(0, 20);
    if (!items.length) throw fetchError("no_items", "No posts were found at that URL.");
    return { kind: kind, sourceName: sourceName, items: items, focusUrl: null };
  }
  const finalUrl = canonicalPostUrl(page.url || canonical);
  const title = tag(page.text, "title") || finalUrl;
  return {
    kind: kind,
    sourceName: sourceName,
    items: [{
      url: finalUrl,
      title: title.slice(0, 300),
      body: htmlToText(page.text).slice(0, 20000),
      publishedAt: null,
    }],
    focusUrl: finalUrl,
  };
}

async function discover(source) {
  if (!source || KINDS.indexOf(source.kind) === -1) {
    throw fetchError("bad_kind", "Choose a YouTube channel, an X user, a Substack, or a website.");
  }
  if (source.kind === "youtube") return discoverYoutube(source.name);
  if (source.kind === "x") return discoverX(source.name);
  return discoverWebsite(source.name);
}

function textForBox(kind, item) {
  if (kind === "youtube") {
    const title = item && item.title ? String(item.title).trim() : "";
    return title ? title + "\n\n" : "";
  }
  return item && item.body ? String(item.body) : "";
}

function normalizeSourceName(name, kind) {
  const trimmed = String(name || "").trim();
  if (!trimmed || trimmed.length > 300) {
    throw fetchError("bad_name", "Enter a source name.");
  }
  if (KINDS.indexOf(kind) === -1) {
    throw fetchError("bad_kind", "Choose a YouTube channel, an X user, a Substack, or a website.");
  }
  if (kind === "x") return xHandle(trimmed);
  if (kind === "substack") {
    if (/^https?:\/\//i.test(trimmed) || /[./]/.test(trimmed)) return canonicalPostUrl(trimmed);
    const handle = trimmed.replace(/^@/, "").replace(/\.substack\.com$/i, "");
    if (!/^[\w.-]{2,80}$/.test(handle)) {
      throw fetchError("bad_name", "Enter a Substack URL or name.");
    }
    return canonicalPostUrl("https://" + handle + ".substack.com");
  }
  if (kind === "website") return canonicalPostUrl(trimmed);
  return trimmed;
}

module.exports = {
  KINDS,
  discover,
  openTarget,
  parseFeed,
  itemsFromXPayload,
  itemFromXStatus,
  textForBox,
  normalizeSourceName,
  canonicalPostUrl,
  xHandle,
  looksLikeFeed,
};
