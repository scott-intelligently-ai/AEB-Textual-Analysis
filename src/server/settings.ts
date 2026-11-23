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

export function getSettings(): AppSettings {
  const stored = new Map(
    getDb()
      .select()
      .from(schema.settings)
      .all()
      .map((row) => [row.key, row.value]),
  );
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

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb();
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    db.insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
      .run();
  }
  return getSettings();
}

export function settingsResponse(): SettingsResponse {
  return { ...getSettings(), providers: providerInfo() };
}
