import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { suggestTones } from "../lib/ai/tone";
import type { Span } from "../lib/text/documents";
import { findOccurrences, spanKey, type Occurrence } from "../lib/text/match";
import { getDocumentRow } from "./documents";
import { HttpError, badRequest } from "./http";
import { getSettings } from "./settings";
import { termPatterns } from "./terms";
import { listTones } from "./tones";

export function listAnnotations(documentId: number): schema.Annotation[] {
  getDocumentRow(documentId);
  return getDb()
    .select()
    .from(schema.annotations)
    .where(eq(schema.annotations.documentId, documentId))
    .all();
}

function occurrenceAt(text: string, span: Span): Occurrence {
  const occurrence = findOccurrences(text, termPatterns()).find(
    (o) => o.start === span.start && o.end === span.end,
  );
  if (!occurrence) {
    throw new HttpError(
      409,
      "That is no longer an occurrence of a term. The document or the term list has changed; reload the page.",
    );
  }
  return occurrence;
}

function upsert(
  documentId: number,
  occurrence: Occurrence,
  toneId: number,
  source: schema.AnnotationSource,
  reason: string | null,
): void {
  getDb()
    .insert(schema.annotations)
    .values({
      documentId,
      termId: occurrence.termId,
      start: occurrence.start,
      end: occurrence.end,
      toneId,
      source,
      reason,
    })
    .onConflictDoUpdate({
      target: [schema.annotations.documentId, schema.annotations.start, schema.annotations.end],
      set: { termId: occurrence.termId, toneId, source, reason },
    })
    .run();
}

/** Records the user's choice for one occurrence; a null tone clears the tag. */
export function setTone(documentId: number, span: Span, toneId: number | null): void {
  const document = getDocumentRow(documentId);
  const occurrence = occurrenceAt(document.text, span);
  if (toneId === null) {
    getDb()
      .delete(schema.annotations)
      .where(
        and(
          eq(schema.annotations.documentId, documentId),
          eq(schema.annotations.start, span.start),
          eq(schema.annotations.end, span.end),
        ),
      )
      .run();
    return;
  }
  if (!listTones().some((tone) => tone.id === toneId)) throw badRequest("That tone no longer exists.");
  upsert(documentId, occurrence, toneId, "user", null);
}

/** Turns every AI suggestion in the document into a confirmed tag. */
export function confirmSuggestions(documentId: number): { confirmed: number } {
  getDocumentRow(documentId);
  const result = getDb()
    .update(schema.annotations)
    .set({ source: "user" })
    .where(and(eq(schema.annotations.documentId, documentId), eq(schema.annotations.source, "ai")))
    .run();
  return { confirmed: result.changes };
}

/** Removes every AI suggestion in the document that has not been confirmed. */
export function discardSuggestions(documentId: number): { discarded: number } {
  getDocumentRow(documentId);
  const result = getDb()
    .delete(schema.annotations)
    .where(and(eq(schema.annotations.documentId, documentId), eq(schema.annotations.source, "ai")))
    .run();
  return { discarded: result.changes };
}

export interface AiToneResult {
  /** Occurrences that received a suggestion. */
  suggested: number;
  /** Occurrences left alone because the user had already set their tone. */
  skipped: number;
  /** Occurrences the model gave no usable answer for. */
  missed: number;
}

/**
 * Asks the AI for tones. With a span, only that occurrence is judged (and an
 * existing tag on it is replaced, since the user asked). Without one, every
 * occurrence the user has not tagged is judged.
 */
export async function suggestDocumentTones(documentId: number, span?: Span): Promise<AiToneResult> {
  const document = getDocumentRow(documentId);
  const tones = listTones();
  const settings = getSettings();
  const occurrences = findOccurrences(document.text, termPatterns());

  let targets: Occurrence[];
  let skipped = 0;
  if (span) {
    targets = [occurrenceAt(document.text, span)];
  } else {
    const userSet = new Set(
      listAnnotations(documentId)
        .filter((annotation) => annotation.source === "user")
        .map(spanKey),
    );
    targets = occurrences.filter((occurrence) => !userSet.has(spanKey(occurrence)));
    skipped = occurrences.length - targets.length;
  }
  if (targets.length === 0) return { suggested: 0, skipped, missed: 0 };

  const { suggestions, missed } = await suggestTones({
    provider: settings.analysisProvider,
    text: document.text,
    targets,
    tones,
    purpose: settings.analysisPurpose,
    plan: span ? { context: 2500 } : undefined,
  });

  // The request can take a while; make sure nothing moved underneath it.
  const current = getDocumentRow(documentId);
  if (current.text !== document.text) {
    throw new HttpError(409, "The document was edited while the AI was working. Run it again.");
  }
  const liveTones = new Set(listTones().map((tone) => tone.id));
  const byKey = new Map(findOccurrences(current.text, termPatterns()).map((o) => [spanKey(o), o]));
  const userSetNow = new Set(
    listAnnotations(documentId)
      .filter((annotation) => annotation.source === "user")
      .map(spanKey),
  );

  let suggested = 0;
  for (const suggestion of suggestions) {
    const occurrence = byKey.get(spanKey(suggestion));
    if (!occurrence || !liveTones.has(suggestion.toneId)) continue;
    if (!span && userSetNow.has(spanKey(suggestion))) {
      skipped += 1;
      continue;
    }
    upsert(documentId, occurrence, suggestion.toneId, "ai", suggestion.reason || null);
    suggested += 1;
  }
  return { suggested, skipped, missed };
}
