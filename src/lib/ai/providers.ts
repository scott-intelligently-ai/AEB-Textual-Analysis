/** Provider names and labels, safe to import from browser code. */

export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type Task = "ocr" | "analysis";

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

export interface ProviderInfo {
  provider: Provider;
  label: string;
  hasKey: boolean;
  keyVariable: string;
  models: Record<Task, { id: string; variable: string }>;
}
