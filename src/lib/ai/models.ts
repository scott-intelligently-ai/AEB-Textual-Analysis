import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TASKS = ["ocr", "analysis"] as const;
export type Task = (typeof TASKS)[number];

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const KEY_VARS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const MODEL_VARS: Record<Provider, Record<Task, string>> = {
  anthropic: { ocr: "ANTHROPIC_OCR_MODEL", analysis: "ANTHROPIC_ANALYSIS_MODEL" },
  openai: { ocr: "OPENAI_OCR_MODEL", analysis: "OPENAI_ANALYSIS_MODEL" },
};

/**
 * Fallbacks used when the environment variables above are unset. These were
 * chosen from each provider's model list on 2026-11-23; set the variables to
 * move to newer models without a code change.
 */
const FALLBACK_MODELS: Record<Provider, Record<Task, string>> = {
  anthropic: { ocr: "claude-sonnet-5-5", analysis: "claude-sonnet-5-5" },
  openai: { ocr: "gpt-6.2-sol", analysis: "gpt-6.2-sol" },
};

export class AiConfigError extends Error {}

export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

export function modelId(provider: Provider, task: Task): string {
  return process.env[MODEL_VARS[provider][task]]?.trim() || FALLBACK_MODELS[provider][task];
}

export function hasKey(provider: Provider): boolean {
  return Boolean(process.env[KEY_VARS[provider]]?.trim());
}

export function languageModel(provider: Provider, task: Task): LanguageModel {
  const apiKey = process.env[KEY_VARS[provider]]?.trim();
  if (!apiKey) {
    throw new AiConfigError(
      `${KEY_VARS[provider]} is not set, so ${PROVIDER_LABELS[provider]} cannot be used. ` +
        "Add the key to the environment or choose the other provider in Settings.",
    );
  }
  const id = modelId(provider, task);
  return provider === "anthropic"
    ? createAnthropic({ apiKey })(id)
    : createOpenAI({ apiKey })(id);
}

export interface ProviderInfo {
  provider: Provider;
  label: string;
  hasKey: boolean;
  keyVariable: string;
  models: Record<Task, { id: string; variable: string }>;
}

export function providerInfo(): ProviderInfo[] {
  return PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    hasKey: hasKey(provider),
    keyVariable: KEY_VARS[provider],
    models: {
      ocr: { id: modelId(provider, "ocr"), variable: MODEL_VARS[provider].ocr },
      analysis: {
        id: modelId(provider, "analysis"),
        variable: MODEL_VARS[provider].analysis,
      },
    },
  }));
}

/** Runs async work over items with a cap on how many run at once. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
