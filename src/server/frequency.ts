import { inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { toCsv } from "../lib/text/csv";
import { findOccurrences, frequencyTable, spanKey, type FrequencyTable } from "../lib/text/match";
import { getDocumentRows } from "./documents";
import { listTerms, termPatterns } from "./terms";
import { listTones } from "./tones";

export function getFrequency(documentIds?: number[]): FrequencyTable {
  return frequencyTable(getDocumentRows(documentIds), termPatterns());
}

function snippet(text: string, start: number, end: number, radius = 80): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

/** One CSV row per term occurrence, with its tone, for analysis elsewhere. */
export function occurrencesCsv(documentIds?: number[]): string {
  const documents = getDocumentRows(documentIds);
  const terms = new Map(listTerms().map((term) => [term.id, term.text]));
  const patterns = termPatterns();
  const tones = listTones();
  const toneById = new Map(tones.map((tone) => [tone.id, tone]));
  const fallback = tones.find((tone) => tone.isDefault);

  const annotations =
    documents.length === 0
      ? []
      : getDb()
          .select()
          .from(schema.annotations)
          .where(
            inArray(
              schema.annotations.documentId,
              documents.map((document) => document.id),
            ),
          )
          .all();
  const tagged = new Map(annotations.map((a) => [`${a.documentId}:${spanKey(a)}`, a]));

  const rows: (string | number)[][] = [
    ["document", "term", "matched_text", "position", "tone", "tone_score", "tone_set_by", "context"],
  ];
  for (const document of documents) {
    for (const occurrence of findOccurrences(document.text, patterns)) {
      const annotation = tagged.get(`${document.id}:${spanKey(occurrence)}`);
      const tone = annotation ? toneById.get(annotation.toneId) : fallback;
      rows.push([
        document.title,
        terms.get(occurrence.termId) ?? "",
        occurrence.text,
        occurrence.start,
        tone?.name ?? "",
        tone?.score ?? "",
        annotation ? (annotation.source === "ai" ? "ai_suggestion" : "user") : "default",
        snippet(document.text, occurrence.start, occurrence.end),
      ]);
    }
  }
  return toCsv(rows);
}
