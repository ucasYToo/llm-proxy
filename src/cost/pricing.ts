import type { TokenUsage } from "../interfaces";

/* ── Model Pricing ── */

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** USD per 1M cache read tokens (0 if not supported) */
  cacheReadPer1M: number;
  /** USD per 1M cache write tokens (0 if not supported) */
  cacheWritePer1M: number;
}

/* ── Hardcoded Pricing (2025-05 data) ── */

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude Opus 4
  "claude-opus-4-20250514": {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  "claude-opus-4-20250918": {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  // Claude Sonnet 4
  "claude-sonnet-4-20250514": {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  "claude-sonnet-4-20250929": {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  // Claude Haiku 3.5
  "claude-3-5-haiku-20241022": {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cacheReadPer1M: 0.08,
    cacheWritePer1M: 1,
  },
  "claude-3-5-haiku-latest": {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cacheReadPer1M: 0.08,
    cacheWritePer1M: 1,
  },
  // Claude 3.5 Sonnet
  "claude-3-5-sonnet-20241022": {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  "claude-3-5-sonnet-20240620": {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  "claude-3-5-sonnet-latest": {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
  },
  // Claude 3 Opus
  "claude-3-opus-20240229": {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  "claude-3-opus-latest": {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
  },
  // Claude 3 Haiku
  "claude-3-haiku-20240307": {
    inputPer1M: 0.25,
    outputPer1M: 1.25,
    cacheReadPer1M: 0.03,
    cacheWritePer1M: 0.3,
  },
  // OpenAI GPT-4o
  "gpt-4o": {
    inputPer1M: 2.5,
    outputPer1M: 10,
    cacheReadPer1M: 1.25,
    cacheWritePer1M: 0,
  },
  "gpt-4o-2024-11-20": {
    inputPer1M: 2.5,
    outputPer1M: 10,
    cacheReadPer1M: 1.25,
    cacheWritePer1M: 0,
  },
  // OpenAI GPT-4o-mini
  "gpt-4o-mini": {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cacheReadPer1M: 0.075,
    cacheWritePer1M: 0,
  },
  "gpt-4o-mini-2024-07-18": {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cacheReadPer1M: 0.075,
    cacheWritePer1M: 0,
  },
  // OpenAI o1
  "o1": {
    inputPer1M: 15,
    outputPer1M: 60,
    cacheReadPer1M: 7.5,
    cacheWritePer1M: 0,
  },
  "o1-2024-12-17": {
    inputPer1M: 15,
    outputPer1M: 60,
    cacheReadPer1M: 7.5,
    cacheWritePer1M: 0,
  },
  // OpenAI o1-mini
  "o1-mini": {
    inputPer1M: 3,
    outputPer1M: 12,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 0,
  },
  // OpenAI o3-mini
  "o3-mini": {
    inputPer1M: 1.1,
    outputPer1M: 4.4,
    cacheReadPer1M: 0.55,
    cacheWritePer1M: 0,
  },
};

/* ── Default Fallback Pricing ── */

export const DEFAULT_PRICING: ModelPricing = {
  inputPer1M: 3,
  outputPer1M: 15,
  cacheReadPer1M: 0.3,
  cacheWritePer1M: 3.75,
};

/* ── Resolve Pricing ── */

export type PricingSource = "override" | "exact" | "family" | "default";

export interface ResolvedPricing {
  pricing: ModelPricing;
  source: PricingSource;
  /** Matched key from MODEL_PRICING when source is "exact" or "family", else null. */
  matchedKey: string | null;
}

const FAMILY_PATTERNS: RegExp[] = [
  /^claude-opus-4/i,
  /^claude-sonnet-4/i,
  /^claude-3-5-haiku/i,
  /^claude-3-5-sonnet/i,
  /^claude-3-opus/i,
  /^claude-3-haiku/i,
  /^gpt-4o-mini/i,
  /^gpt-4o/i,
  /^o1-mini/i,
  /^o1/i,
  /^o3-mini/i,
];

/**
 * Resolve pricing for a model with source info. Strategy:
 * 1. Per-target override (any field) → "override"
 * 2. Exact match in MODEL_PRICING → "exact"
 * 3. Prefix / family regex match → "family"
 * 4. DEFAULT_PRICING fallback → "default"
 */
export const resolvePricingDetailed = (
  model?: string,
  override?: Partial<ModelPricing>,
): ResolvedPricing => {
  if (override && Object.keys(override).length > 0) {
    return {
      pricing: { ...DEFAULT_PRICING, ...override },
      source: "override",
      matchedKey: null,
    };
  }

  if (!model) {
    return { pricing: { ...DEFAULT_PRICING }, source: "default", matchedKey: null };
  }

  if (MODEL_PRICING[model]) {
    return { pricing: { ...MODEL_PRICING[model] }, source: "exact", matchedKey: model };
  }

  // Prefix match: find longest key that model starts with
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(key) && key.length > bestLen) {
      bestMatch = key;
      bestLen = key.length;
    }
  }
  if (bestMatch) {
    return { pricing: { ...MODEL_PRICING[bestMatch] }, source: "family", matchedKey: bestMatch };
  }

  // Family regex match
  for (const pattern of FAMILY_PATTERNS) {
    if (pattern.test(model)) {
      for (const key of Object.keys(MODEL_PRICING)) {
        if (pattern.test(key)) {
          return { pricing: { ...MODEL_PRICING[key] }, source: "family", matchedKey: key };
        }
      }
    }
  }

  return { pricing: { ...DEFAULT_PRICING }, source: "default", matchedKey: null };
};

/** Convenience wrapper: returns just the pricing (existing callers). */
export const resolvePricing = (
  model?: string,
  override?: Partial<ModelPricing>,
): ModelPricing => resolvePricingDetailed(model, override).pricing;

/* ── Calculate Cost ── */

/**
 * Calculate cost in USD from token usage and pricing.
 */
export const calculateCost = (
  usage: TokenUsage,
  pricing: ModelPricing,
): number => {
  const input = (usage.inputTokens ?? 0) * (pricing.inputPer1M / 1_000_000);
  const output = (usage.outputTokens ?? 0) * (pricing.outputPer1M / 1_000_000);
  const cacheRead =
    (usage.cacheReadTokens ?? 0) * (pricing.cacheReadPer1M / 1_000_000);
  const cacheWrite =
    (usage.cacheCreationTokens ?? 0) * (pricing.cacheWritePer1M / 1_000_000);
  return input + output + cacheRead + cacheWrite;
};
