/** Shapes returned by the API, re-exported for browser code as types only. */

export type { Annotation, Tone } from "@/db/schema";
export type { TermCategory, TermEquivalence, DocumentTag } from "@/db/schema";
export type { DocumentDetail, DocumentSummary, DocumentTagSummary, SourcePage } from "@/server/documents";
export type { TermView as Term } from "@/server/terms";
export type { PageSummary, UploadSummary } from "@/server/uploads";
export type { ToneWithUsage } from "@/server/tones";
export type { ImportResult } from "@/server/terms";
export type { ToneDistribution, DistributionGroup } from "@/lib/text/distribution";
export type {
  GenerateResult,
  PendingSuggestion,
  SuggestionsResponse,
} from "@/server/suggestions";
export type { SettingsResponse } from "@/server/settings";
export type { AiToneResult } from "@/server/annotations";
export type { FrequencyTable } from "@/lib/text/match";
