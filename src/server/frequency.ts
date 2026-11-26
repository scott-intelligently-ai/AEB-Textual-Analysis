import { inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { formatTermCategories } from "../lib/text/categories";
import { formatTermWithVariants } from "../lib/text/variants";
import { OCCURRENCE_DOWNLOAD_NOTE, TONE_FREQUENCY_DOWNLOAD_NOTE, csvWithNote } from "../lib/text/explanations";
import { findOccurrences, frequencyTable, spanKey, type FrequencyTable } from "../lib/text/match";
import { getDocumentRows } from "./documents";
import { listCategories } from "./taxonomy";
import { listTerms, termPatterns } from "./terms";
import { listTones } from "./tones";

export async function getFrequency(documentIds?: number[]): Promise<FrequencyTable> {
  const termList = await listTerms();
  const table = frequencyTable(
    await getDocumentRows(documentIds),
    termList.map(({ id, text, variants, caseSensitive }) => ({ id, text, variants, caseSensitive })),
  );
  const labels = await categoryLabels(termList);
  return {
    ...table,
    rows: table.rows.map((row) => ({ ...row, categories: labels.get(row.termId) ?? "" })),
  };
}

async function categoryLabels(terms: { id: number; categoryIds: number[] }[]): Promise<Map<number, string>> {
  const categories = await listCategories();
  return new Map(terms.map((term) => [term.id, formatTermCategories(term.categoryIds, categories)]));
}

function snippet(text: string, start: number, end: number, radius = 80): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

/** Documents, terms, and the tone recorded on each occurrence. Untagged uses the default tone. */
async function markedOccurrences(documentIds?: number[]) {
  const documents = await getDocumentRows(documentIds);
  const termList = await listTerms();
  const patterns = await termPatterns();
  const tones = await listTones();
  const toneById = new Map(tones.map((tone) => [tone.id, tone]));
  const fallback = tones.find((tone) => tone.isDefault);
  const db = await getDb();
  const annotations =
    documents.length === 0
      ? []
      : await db
          .select()
          .from(schema.annotations)
          .where(
            inArray(
              schema.annotations.documentId,
              documents.map((document) => document.id),
            ),
          );
  const tagged = new Map(
    annotations.map((annotation) => [`${annotation.documentId}:${spanKey(annotation)}`, annotation]),
  );
  return { documents, termList, patterns, tones, toneById, fallback, tagged };
}

/** One CSV row per term occurrence, with its tone, for analysis elsewhere. */
export async function occurrencesCsv(documentIds?: number[]): Promise<string> {
  const { documents, termList, patterns, toneById, fallback, tagged } = await markedOccurrences(documentIds);
  const terms = new Map(termList.map((term) => [term.id, term.text]));
  const labels = await categoryLabels(termList);

  const rows: (string | number)[][] = [
    ["document", "term", "term_with_variants", "categories", "matched_text", "position", "tone", "tone_score", "tone_set_by", "context"],
  ];
  const forms = new Map(
    termList.map((term) => [term.id, formatTermWithVariants(term.text, term.variants)]),
  );
  for (const document of documents) {
    for (const occurrence of findOccurrences(document.text, patterns)) {
      const annotation = tagged.get(`${document.id}:${spanKey(occurrence)}`);
      const tone = annotation ? toneById.get(annotation.toneId) : fallback;
      rows.push([
        document.title,
        terms.get(occurrence.termId) ?? "",
        forms.get(occurrence.termId) ?? "",
        labels.get(occurrence.termId) ?? "",
        occurrence.text,
        occurrence.start,
        tone?.name ?? "",
        tone?.score ?? "",
        annotation ? "user" : "default",
        snippet(document.text, occurrence.start, occurrence.end),
      ]);
    }
  }
  return csvWithNote(rows, OCCURRENCE_DOWNLOAD_NOTE);
}

/**
 * One CSV row per term per document. Each tone has its own count, followed by
 * the total, so three tones produce four numbers for that term in that document.
 */
export async function toneFrequencyCsv(documentIds?: number[]): Promise<string> {
  const { documents, termList, patterns, tones, toneById, fallback, tagged } =
    await markedOccurrences(documentIds);
  const toneIndex = new Map(tones.map((tone, index) => [tone.id, index]));
  const counts = new Map<string, number[]>();

  for (const document of documents) {
    for (const occurrence of findOccurrences(document.text, patterns)) {
      const annotation = tagged.get(`${document.id}:${spanKey(occurrence)}`);
      const tone = annotation ? toneById.get(annotation.toneId) : fallback;
      const index = tone ? toneIndex.get(tone.id) : undefined;
      if (index === undefined) continue;
      const key = `${document.id}:${occurrence.termId}`;
      const row = counts.get(key) ?? tones.map(() => 0);
      row[index] += 1;
      counts.set(key, row);
    }
  }

  const labels = await categoryLabels(termList);
  const rows: (string | number)[][] = [
    ["document", "term", "term_with_variants", "categories", ...tones.map((tone) => tone.name), "total"],
  ];
  for (const document of documents) {
    for (const term of termList) {
      const values = counts.get(`${document.id}:${term.id}`) ?? tones.map(() => 0);
      rows.push([
        document.title,
        term.text,
        formatTermWithVariants(term.text, term.variants),
        labels.get(term.id) ?? "",
        ...values,
        values.reduce((sum, count) => sum + count, 0),
      ]);
    }
  }
  return csvWithNote(rows, TONE_FREQUENCY_DOWNLOAD_NOTE);
}
