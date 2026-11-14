"use strict";

const { knownModel } = require("./analyst-models");

const SYSTEM = [
  "You read one post from a market commentator.",
  "This is not financial advice.",
  "Reply in this exact shape, with one value on each labeled line:",
  "Analyst: <the commentator's name>",
  "Short-term stock: <one ticker, or none>",
  "Long-term stock: <one ticker, or none>",
  "Short-term industry: <one industry, or none>",
  "Long-term industry: <one industry, or none>",
  "Short-term avoid: <one ticker the post says to avoid in the short term, or none>",
  "<a short note the reader can edit>",
  "Use none when the post does not name that pick.",
].join("\n");

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

async function analyse(model, text) {
  if (!knownModel(model)) {
    throw openRouterError("bad_model", "Choose a model from the list.");
  }
  const body = String(text || "").trim();
  if (!body) throw openRouterError("empty_text", "The text box is empty.");
  if (body.length > 100000) throw openRouterError("empty_text", "The text box is too long.");
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
          { role: "system", content: SYSTEM },
          { role: "user", content: body },
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
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  const textOut = typeof content === "string" ? content : "";
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
};
