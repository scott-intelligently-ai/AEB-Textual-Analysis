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

export async function listAnnotations(documentId: number): Promise<schema.Annotation[]> {
  await getDocumentRow(documentId);
  const db = await getDb();
  return db
    .select()
    .from(schema.annotations)
    .where(eq(schema.annotations.documentId, documentId));
}

async function occurrenceAt(text: string, span: Span): Promise<Occurrence> {
  const occurrence = findOccurrences(text, await termPatterns()).find(
    (item) => item.start === span.start && item.end === span.end,
  );
  if (!occurrence) {
    throw new HttpError(
      409,
      "That is no longer an occurrence of a term. The document or the term list has changed; reload the page.",
    );
  }
  return occurrence;
}

async function upsert(
  documentId: number,
  occurrence: Occurrence,
  toneId: number,
  source: schema.AnnotationSource,
  reason: string | null,
): Promise<void> {
  const db = await getDb();
  await db
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
    });
}

/** Records the user's choice for one occurrence; a null tone clears the tag. */
export async function setTone(
  documentId: number,
  span: Span,
  toneId: number | null,
): Promise<void> {
  const document = await getDocumentRow(documentId);
  const occurrence = await occurrenceAt(document.text, span);
  const db = await getDb();
  if (toneId === null) {
    await db
      .delete(schema.annotations)
      .where(
        and(
          eq(schema.annotations.documentId, documentId),
          eq(schema.annotations.start, span.start),
          eq(schema.annotations.end, span.end),
        ),
      );
    return;
  }
  if (!(await listTones()).some((tone) => tone.id === toneId)) {
    throw badRequest("That tone no longer exists.");
  }
  await upsert(documentId, occurrence, toneId, "user", null);
}

/** Turns every AI suggestion in the document into a confirmed tag. */
export async function confirmSuggestions(documentId: number): Promise<{ confirmed: number }> {
  await getDocumentRow(documentId);
  const db = await getDb();
  const rows = await db
    .update(schema.annotations)
    .set({ source: "user" })
    .where(and(eq(schema.annotations.documentId, documentId), eq(schema.annotations.source, "ai")))
    .returning({ id: schema.annotations.id });
  return { confirmed: rows.length };
}

/** Removes every AI suggestion in the document that has not been confirmed. */
export async function discardSuggestions(documentId: number): Promise<{ discarded: number }> {
  await getDocumentRow(documentId);
  const db = await getDb();
  const rows = await db
    .delete(schema.annotations)
    .where(and(eq(schema.annotations.documentId, documentId), eq(schema.annotations.source, "ai")))
    .returning({ id: schema.annotations.id });
  return { discarded: rows.length };
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
export async function suggestDocumentTones(
  documentId: number,
  span?: Span,
): Promise<AiToneResult> {
  const document = await getDocumentRow(documentId);
  const tones = await listTones();
  const settings = await getSettings();
  const patterns = await termPatterns();
  const occurrences = findOccurrences(document.text, patterns);

  let targets: Occurrence[];
  let skipped = 0;
  if (span) {
    targets = [await occurrenceAt(document.text, span)];
  } else {
    const userSet = new Set(
      (await listAnnotations(documentId))
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
  const current = await getDocumentRow(documentId);
  if (current.text !== document.text) {
    throw new HttpError(409, "The document was edited while the AI was working. Run it again.");
  }
  const liveTones = new Set((await listTones()).map((tone) => tone.id));
  const byKey = new Map(
    findOccurrences(current.text, await termPatterns()).map((occurrence) => [
      spanKey(occurrence),
      occurrence,
    ]),
  );
  const userSetNow = new Set(
    (await listAnnotations(documentId))
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
    await upsert(documentId, occurrence, suggestion.toneId, "ai", suggestion.reason || null);
    suggested += 1;
  }
  return { suggested, skipped, missed };
}
