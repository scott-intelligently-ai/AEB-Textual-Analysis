import { getDb, schema } from "../db";
import { isProvider, providerInfo, type Provider, type ProviderInfo } from "../lib/ai/models";

export interface AppSettings {
  analysisPurpose: string;
  ocrProvider: Provider;
  analysisProvider: Provider;
}

export interface SettingsResponse extends AppSettings {
  providers: ProviderInfo[];
}

const DEFAULTS: AppSettings = {
  analysisPurpose: "",
  ocrProvider: "anthropic",
  analysisProvider: "anthropic",
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const stored = new Map((await db.select().from(schema.settings)).map((row) => [row.key, row.value]));
  const provider = (key: "ocrProvider" | "analysisProvider") => {
    const value = stored.get(key);
    return isProvider(value) ? value : DEFAULTS[key];
  };
  return {
    analysisPurpose: stored.get("analysisPurpose") ?? DEFAULTS.analysisPurpose,
    ocrProvider: provider("ocrProvider"),
    analysisProvider: provider("analysisProvider"),
  };
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = await getDb();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  }
  return getSettings();
}

export async function settingsResponse(): Promise<SettingsResponse> {
  return { ...(await getSettings()), providers: providerInfo() };
}
