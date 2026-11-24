import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { suggestTerms } from "../lib/ai/suggestTerms";
import { buildMatcher, normalizeTerm } from "../lib/text/match";
import { getDocumentRows } from "./documents";
import { badRequest, notFound } from "./http";
import { getSettings } from "./settings";
import { createTerm, listTerms } from "./terms";

export interface PendingSuggestion {
  id: number;
  text: string;
  rationale: string;
  total: number;
  /** Occurrence counts keyed by document id; documents with none are omitted. */
  perDocument: Record<number, number>;
}

export interface SuggestionsResponse {
  pending: PendingSuggestion[];
  rejected: { id: number; text: string }[];
}

async function allSuggestions(): Promise<schema.TermSuggestion[]> {
  const db = await getDb();
  return db.select().from(schema.termSuggestions).orderBy(asc(schema.termSuggestions.id));
}

export async function listSuggestions(): Promise<SuggestionsResponse> {
  const suggestions = await allSuggestions();
  const pending = suggestions.filter((suggestion) => suggestion.status === "pending");
  const matcher = buildMatcher(pending.map(({ id, text }) => ({ id, text })));
  const counts = new Map<number, Record<number, number>>(pending.map(({ id }) => [id, {}]));
  for (const document of await getDocumentRows()) {
    for (const occurrence of matcher.find(document.text)) {
      const perDocument = counts.get(occurrence.termId)!;
      perDocument[document.id] = (perDocument[document.id] ?? 0) + 1;
    }
  }
  return {
    pending: pending
      .map(({ id, text, rationale }) => {
        const perDocument = counts.get(id)!;
        const total = Object.values(perDocument).reduce((sum, n) => sum + n, 0);
        return { id, text, rationale, total, perDocument };
      })
      .sort((a, b) => b.total - a.total || a.id - b.id),
    rejected: suggestions
      .filter((suggestion) => suggestion.status === "rejected")
      .map(({ id, text }) => ({ id, text })),
  };
}

export interface GenerateResult {
  added: number;
  /** Proposals dropped because the wording does not occur in the documents. */
  notFound: string[];
  /** Proposals dropped because they are already listed, pending, or rejected. */
  alreadyKnown: string[];
}

export async function generateSuggestions(documentIds?: number[]): Promise<GenerateResult> {
  const documents = await getDocumentRows(documentIds);
  if (documents.length === 0) throw badRequest("There are no documents to read yet.");

  const settings = await getSettings();
  const terms = await listTerms();
  const before = await allSuggestions();
  const candidates = await suggestTerms({
    provider: settings.analysisProvider,
    purpose: settings.analysisPurpose,
    existingTerms: terms.flatMap((term) => [term.text, ...term.variants]),
    rejectedTerms: before
      .filter((suggestion) => suggestion.status !== "accepted")
      .map((suggestion) => suggestion.text),
    documents: documents.map(({ title, text }) => ({ title, text })),
  });

  // Re-read after the request: the lists may have changed while it ran.
  const known = new Set([
    ...(await listTerms()).flatMap((term) => [term.text, ...term.variants].map(normalizeTerm)),
    ...(await allSuggestions()).map((suggestion) => suggestion.normalized),
  ]);
  const result: GenerateResult = { added: 0, notFound: [], alreadyKnown: [] };
  const fresh = candidates.filter((candidate) => {
    const key = normalizeTerm(candidate.term);
    if (known.has(key)) {
      result.alreadyKnown.push(candidate.term);
      return false;
    }
    known.add(key);
    return true;
  });

  // The model is not trusted to quote accurately: keep only wording that occurs.
  const matcher = buildMatcher(fresh.map((candidate, i) => ({ id: i, text: candidate.term })));
  const found = new Set<number>();
  for (const document of documents) {
    for (const occurrence of matcher.find(document.text)) found.add(occurrence.termId);
  }

  const db = await getDb();
  for (const [i, candidate] of fresh.entries()) {
    if (!found.has(i)) {
      result.notFound.push(candidate.term);
      continue;
    }
    await db
      .insert(schema.termSuggestions)
      .values({
        text: candidate.term,
        normalized: normalizeTerm(candidate.term),
        rationale: candidate.reason,
      })
      .onConflictDoNothing();
    result.added += 1;
  }
  return result;
}

/**
 * Accepting adds the term to the term list; rejecting records it so it is not
 * proposed again. Either way the suggestion stops being pending, which removes
 * its highlight from every document at once. A rejection can be undone.
 */
export async function decideSuggestion(
  id: number,
  status: schema.SuggestionStatus,
): Promise<void> {
  const db = await getDb();
  const [suggestion] = await db
    .select()
    .from(schema.termSuggestions)
    .where(eq(schema.termSuggestions.id, id));
  if (!suggestion) throw notFound("Suggestion");
  if (suggestion.status === "accepted") {
    throw badRequest("That suggestion is already on the term list. Remove it from Terms instead.");
  }
  if (status === "accepted") {
    const key = normalizeTerm(suggestion.text);
    const covered = (await listTerms()).some((term) =>
      [term.text, ...term.variants].some((pattern) => normalizeTerm(pattern) === key),
    );
    if (!covered) await createTerm({ text: suggestion.text });
  }
  await db
    .update(schema.termSuggestions)
    .set({ status })
    .where(eq(schema.termSuggestions.id, id));
}
