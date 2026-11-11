"use strict";

const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";

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
  "qwen/qwen3.8-max-0902",
  "openai/gpt-5.6-terra",
  "z-ai/glm-5.3",
  "x-ai/grok-4.6",
  "google/gemini-3.8-flash",
  "thinkingmachines/inkling-2-small:free",
  "xiaomi/mimo-v2.6-pro",
  "minimax/minimax-m3.1-flash",
  "deepseek/deepseek-v4.1-flash-1017",
  "stepfun/step-5-preview",
];

function knownModel(id) {
  return MODELS.indexOf(id) !== -1;
}

module.exports = {
  DEFAULT_MODEL,
  MODELS,
  knownModel,
};
