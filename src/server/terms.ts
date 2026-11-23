import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { buildMatcher, normalizeTerm, spanKey, type TermPattern } from "../lib/text/match";
import { badRequest, notFound } from "./http";

export interface TermInput {
  text: string;
  variants?: string[];
}

const tidy = (value: string) => value.trim().split(/\s+/).join(" ");

export function listTerms(): schema.Term[] {
  return getDb().select().from(schema.terms).orderBy(asc(schema.terms.id)).all();
}

export function termPatterns(): TermPattern[] {
  return listTerms().map(({ id, text, variants }) => ({ id, text, variants }));
}

/** Every pattern in use, mapped to the term that owns it. */
function patternOwners(excludeTermId?: number): Map<string, schema.Term> {
  const owners = new Map<string, schema.Term>();
  for (const term of listTerms()) {
    if (term.id === excludeTermId) continue;
    for (const pattern of [term.text, ...term.variants]) {
      owners.set(normalizeTerm(pattern), term);
    }
  }
  return owners;
}

/** Cleans a term and rejects it if any of its wording is already taken. */
function prepare(input: TermInput, excludeTermId?: number): { text: string; variants: string[] } {
  const text = tidy(input.text);
  if (!text) throw badRequest("A term cannot be empty.");
  const owners = patternOwners(excludeTermId);
  const taken = (pattern: string) => {
    const owner = owners.get(normalizeTerm(pattern));
    if (owner) {
      throw badRequest(
        normalizeTerm(owner.text) === normalizeTerm(pattern)
          ? `"${pattern}" is already on the term list.`
          : `"${pattern}" is already covered by the term "${owner.text}".`,
      );
    }
  };
  taken(text);

  const seen = new Set([normalizeTerm(text)]);
  const variants: string[] = [];
  for (const raw of input.variants ?? []) {
    const variant = tidy(raw);
    const key = normalizeTerm(variant);
    if (!variant || seen.has(key)) continue;
    taken(variant);
    seen.add(key);
    variants.push(variant);
  }
  return { text, variants };
}

export function createTerm(input: TermInput): schema.Term {
  const term = getDb().insert(schema.terms).values(prepare(input)).returning().get();
  pruneOrphanAnnotations();
  return term;
}

export function updateTerm(id: number, input: TermInput): schema.Term {
  const db = getDb();
  if (!db.select().from(schema.terms).where(eq(schema.terms.id, id)).get()) throw notFound("Term");
  const term = db
    .update(schema.terms)
    .set(prepare(input, id))
    .where(eq(schema.terms.id, id))
    .returning()
    .get();
  pruneOrphanAnnotations();
  return term;
}

export function deleteTerm(id: number): void {
  const result = getDb().delete(schema.terms).where(eq(schema.terms.id, id)).run();
  if (result.changes === 0) throw notFound("Term");
  pruneOrphanAnnotations();
}

export interface ImportResult {
  added: schema.Term[];
  skipped: { text: string; reason: string }[];
}

export function importTerms(inputs: TermInput[]): ImportResult {
  const db = getDb();
  const result: ImportResult = { added: [], skipped: [] };
  for (const input of inputs) {
    try {
      result.added.push(db.insert(schema.terms).values(prepare(input)).returning().get());
    } catch (error) {
      result.skipped.push({
        text: input.text,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  pruneOrphanAnnotations();
  return result;
}

/**
 * Removes tone tags that no longer sit on an occurrence of their term. Changing
 * the term list can change what matches where (adding "tax cut" takes those
 * words away from "tax"), and a stale tag must not reappear later.
 */
export function pruneOrphanAnnotations(): number {
  const db = getDb();
  const matcher = buildMatcher(termPatterns());
  const annotations = db.select().from(schema.annotations).all();
  if (annotations.length === 0) return 0;

  const byDocument = new Map<number, schema.Annotation[]>();
  for (const annotation of annotations) {
    const list = byDocument.get(annotation.documentId) ?? [];
    list.push(annotation);
    byDocument.set(annotation.documentId, list);
  }

  const orphans: number[] = [];
  for (const [documentId, list] of byDocument) {
    const document = db
      .select({ text: schema.documents.text })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .get();
    const live = new Map(
      matcher.find(document?.text ?? "").map((occurrence) => [spanKey(occurrence), occurrence.termId]),
    );
    for (const annotation of list) {
      if (live.get(spanKey(annotation)) !== annotation.termId) orphans.push(annotation.id);
    }
  }
  if (orphans.length > 0) {
    db.delete(schema.annotations).where(inArray(schema.annotations.id, orphans)).run();
  }
  return orphans.length;
}
