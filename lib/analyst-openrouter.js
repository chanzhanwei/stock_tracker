"use strict";

const { knownModel } = require("./analyst-models");
const { tradeWindow } = require("./analyst-dates");

function instructions(postUrl, now) {
  const window = tradeWindow(now || new Date());
  const url = String(postUrl || "").trim().slice(0, 2000);
  return [
    "Today is " + window.today + " in Australia/Sydney.",
    "Ignore trades dated before " + window.cutoffDay + ".",
    "A purchase in that window is the short-term stock.",
    "A sale in that window is the short-term avoid.",
    "Reply in this exact shape, with one value on each labeled line:",
    "Date: <the article or post date as YYYY-MM-DD. If the page has no date, use the date of the latest trade in the text>",
    "Website: <post platform>",
    url ? "URL: " + url : "URL: <the post address>",
    "Analyst: <the commentator's name>",
    "Short-term stock buy: <one or more ticker, or none>",
    "Long-term stock buy: <one or more ticker, or none>",
    "Short-term industry buy: <one or more industry, or none>",
    "Long-term industry buy: <one or more industry, or none>",
    "Long-term industry avoid: <one or more industry, or none>",
    "Short-term stock avoid: <one or more ticker, or none>",
    "<a short note the reader can edit>",
    "Use none when the post does not name that pick.",
  ].join("\n");
}

function imageDataUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    throw openRouterError("bad_image", "Paste an image from the clipboard.");
  }
  if (raw.length > 4 * 1024 * 1024) {
    throw openRouterError("bad_image", "That image is larger than 4 MB.");
  }
  return raw.replace(/\s+/g, "");
}

function userContent(text, image) {
  const picture = imageDataUrl(image);
  const body = String(text || "").trim();
  if (!body && !picture) throw openRouterError("empty_text", "The text box is empty.");
  if (body.length > 100000) throw openRouterError("empty_text", "The text box is too long.");
  if (!picture) return body;
  return [
    { type: "text", text: body || "Read the attached image." },
    { type: "image_url", image_url: { url: picture } },
  ];
}

function openRouterError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function finiteCost(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function firstCost(details, names) {
  for (const name of names) {
    if (details && details[name] != null) {
      const n = finiteCost(details[name]);
      if (n != null) return n;
    }
  }
  return null;
}

function costsFromUsage(usage) {
  const details = (usage && usage.cost_details) || {};
  const inputCost = firstCost(details, ["upstream_inference_prompt_cost", "upstream_inference_input_cost"]);
  const outputCost = firstCost(details, ["upstream_inference_completions_cost", "upstream_inference_output_cost"]);
  let totalCost = finiteCost(usage && usage.cost);
  if (totalCost == null && inputCost != null && outputCost != null) totalCost = inputCost + outputCost;
  return { totalCost, inputCost, outputCost };
}

function providerMessage(data) {
  const raw = data && data.error;
  const message = typeof raw === "string" ? raw : (raw && raw.message) || "";
  if (!message || /sk-|api[_-]?key|bearer|authorization/i.test(message)) return "OpenRouter refused the request.";
  return String(message).slice(0, 300);
}

async function analyse(model, text, postUrl, image) {
  if (!knownModel(model)) {
    throw openRouterError("bad_model", "Choose a model from the list.");
  }
  const content = userContent(text, image);
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) throw openRouterError("openrouter_unconfigured", "Set OPENROUTER_API_KEY on the server.");
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/chanzhanwei/stock_tracker",
        "X-Title": "stock_tracker",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: instructions(postUrl) },
          { role: "user", content: content },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    if (err && err.name === "TimeoutError") {
      throw openRouterError("openrouter_timeout", "OpenRouter did not answer in time.");
    }
    throw openRouterError("openrouter_failed", "OpenRouter could not be reached.");
  }
  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    data = {};
  }
  if (!res.ok) throw openRouterError("openrouter_failed", providerMessage(data));
  const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const textOut = typeof reply === "string" ? reply : "";
  if (!textOut.trim()) throw openRouterError("openrouter_empty", "OpenRouter returned an empty result.");
  const costs = costsFromUsage(data.usage || {});
  return {
    text: textOut,
    model: model,
    totalCost: costs.totalCost,
    inputCost: costs.inputCost,
    outputCost: costs.outputCost,
  };
}

module.exports = {
  analyse,
  costsFromUsage,
  instructions,
  userContent,
};
