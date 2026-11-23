/** Shapes returned by the API, re-exported for browser code as types only. */

export type { Annotation, Term, Tone } from "@/db/schema";
export type { DocumentDetail, DocumentSummary, SourcePage } from "@/server/documents";
export type { PageSummary, UploadSummary } from "@/server/uploads";
export type { ToneWithUsage } from "@/server/tones";
export type { ImportResult } from "@/server/terms";
export type {
  GenerateResult,
  PendingSuggestion,
  SuggestionsResponse,
} from "@/server/suggestions";
export type { SettingsResponse } from "@/server/settings";
export type { AiToneResult } from "@/server/annotations";
export type { FrequencyTable } from "@/lib/text/match";
