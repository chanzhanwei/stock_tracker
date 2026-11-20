"use strict";

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
const URL_EXTRACT_ERROR = "This model do not extract URL contents";

const MODELS = [
  "anthropic/claude-fable-5.2",
  "google/gemini-4-carbon",
  "anthropic/claude-opus-5.5",
  "openai/gpt-6-astra",
  "openai/gpt-6.1-sol",
  "anthropic/claude-sonnet-5.5",
  "openai/gpt-6.1-terra",
  "google/gemini-4-argon",
  "moonshotai/kimi-k3.1-pro",
  "openai/gpt-6-sol",
  "anthropic/claude-opus-5",
  "meta/muse-wonder",
  "meta/muse-spark-1.3",
  "anthropic/claude-haiku-5.5",
  "x-ai/grok-4.7",
  "tencent/hy4",
  "qwen/qwen3.8-max-0902",
  "openai/gpt-5.6-terra",
  "z-ai/glm-5.3",
  "x-ai/grok-4.6",
  "google/gemini-3.8-flash",
  "xiaomi/mimo-v2.6-pro",
  "minimax/minimax-m3.1-flash",
  "deepseek/deepseek-v4.1-flash-1017",
  "stepfun/step-5-preview",
  "tencent/hy4-flash",
];

function knownModel(id) {
  return MODELS.indexOf(id) !== -1;
}

function refusesUrlExtract(id) {
  const model = String(id || "");
  return model.startsWith("google/gemini") || model.startsWith("openai/gpt") || model.startsWith("x-ai/grok") || model.startsWith("deepseek/");
}

module.exports = {
  DEFAULT_MODEL,
  URL_EXTRACT_ERROR,
  MODELS,
  knownModel,
  refusesUrlExtract,
};
