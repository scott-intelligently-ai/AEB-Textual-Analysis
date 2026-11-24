import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { buildMatcher, normalizeTerm, spanKey, type TermPattern } from "../lib/text/match";
import { badRequest, notFound } from "./http";
import { createEquivalence, listEquivalences, setTermEquivalence } from "./taxonomy";

export interface TermInput {
  text: string;
  variants?: string[];
  /** Name of an equivalence group. Empty means the term stands alone. */
  equivalence?: string | null;
}

const tidy = (value: string) => value.trim().split(/\s+/).join(" ");

export interface TermView extends schema.Term {
  categoryIds: number[];
}

export async function listTerms(): Promise<TermView[]> {
  const db = await getDb();
  const rows = await db.select().from(schema.terms).orderBy(asc(schema.terms.id));
  const memberships = await db.select().from(schema.termCategoryMembers);
  const byTerm = new Map<number, number[]>();
  for (const membership of memberships) {
    const list = byTerm.get(membership.termId) ?? [];
    list.push(membership.categoryId);
    byTerm.set(membership.termId, list);
  }
  return rows.map((term) => ({ ...term, categoryIds: byTerm.get(term.id) ?? [] }));
}

export async function termPatterns(): Promise<TermPattern[]> {
  return (await listTerms()).map(({ id, text, variants }) => ({ id, text, variants }));
}

/** Every pattern in use, mapped to the term that owns it. */
async function patternOwners(excludeTermId?: number): Promise<Map<string, schema.Term>> {
  const owners = new Map<string, schema.Term>();
  for (const term of await listTerms()) {
    if (term.id === excludeTermId) continue;
    for (const pattern of [term.text, ...term.variants]) {
      owners.set(normalizeTerm(pattern), term);
    }
  }
  return owners;
}

/** Cleans a term and rejects it if any of its wording is already taken. */
async function prepare(
  input: TermInput,
  excludeTermId?: number,
): Promise<{ text: string; variants: string[] }> {
  const text = tidy(input.text);
  if (!text) throw badRequest("A term cannot be empty.");
  const owners = await patternOwners(excludeTermId);
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

export async function createTerm(input: TermInput): Promise<schema.Term> {
  const db = await getDb();
  const [term] = await db.insert(schema.terms).values(await prepare(input)).returning();
  await pruneOrphanAnnotations();
  return term;
}

export async function updateTerm(id: number, input: TermInput): Promise<schema.Term> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.terms).where(eq(schema.terms.id, id));
  if (!existing) throw notFound("Term");
  const [term] = await db
    .update(schema.terms)
    .set(await prepare(input, id))
    .where(eq(schema.terms.id, id))
    .returning();
  await pruneOrphanAnnotations();
  return term;
}

export async function deleteTerm(id: number): Promise<void> {
  const db = await getDb();
  const deleted = await db
    .delete(schema.terms)
    .where(eq(schema.terms.id, id))
    .returning({ id: schema.terms.id });
  if (deleted.length === 0) throw notFound("Term");
  await pruneOrphanAnnotations();
}

export interface ImportResult {
  added: schema.Term[];
  skipped: { text: string; reason: string }[];
  /** Equivalence groups named in the file, with the terms placed in each one. */
  groups: { name: string; terms: string[] }[];
}

export async function importTerms(inputs: TermInput[]): Promise<ImportResult> {
  const db = await getDb();
  const result: ImportResult = { added: [], skipped: [], groups: [] };
  for (const input of inputs) {
    try {
      const [term] = await db.insert(schema.terms).values(await prepare(input)).returning();
      result.added.push(term);
    } catch (error) {
      result.skipped.push({
        text: input.text,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await assignImportedGroups(inputs, result);
  await pruneOrphanAnnotations();
  return result;
}

/** Places imported terms into the equivalence groups named in the file. */
async function assignImportedGroups(inputs: TermInput[], result: ImportResult): Promise<void> {
  const wanted = inputs.filter((input) => tidy(input.equivalence ?? ""));
  if (wanted.length === 0) return;
  const terms = await listTerms();
  const byText = new Map(terms.map((term) => [normalizeTerm(term.text), term]));
  const groups = await listEquivalences();
  const byGroup = new Map(groups.map((group) => [normalizeTerm(group.name), group]));
  const placed = new Map<string, { name: string; terms: string[] }>();

  for (const input of wanted) {
    const term = byText.get(normalizeTerm(tidy(input.text)));
    if (!term) continue;
    const groupName = tidy(input.equivalence ?? "");
    let group = byGroup.get(normalizeTerm(groupName));
    if (!group) {
      group = await createEquivalence(groupName, []);
      byGroup.set(normalizeTerm(group.name), group);
    }
    if (term.equivalenceId !== group.id) await setTermEquivalence(term.id, group.id);
    term.equivalenceId = group.id;
    const entry = placed.get(group.name) ?? { name: group.name, terms: [] };
    entry.terms.push(term.text);
    placed.set(group.name, entry);
    const skipped = result.skipped.find((item) => normalizeTerm(item.text) === normalizeTerm(term.text));
    if (skipped) {
      skipped.reason = `${skipped.reason} It was placed in the equivalence group "${group.name}".`;
    }
  }
  result.groups = [...placed.values()];
}

/**
 * Removes tone tags that no longer sit on an occurrence of their term. Changing
 * the term list can change what matches where (adding "tax cut" takes those
 * words away from "tax"), and a stale tag must not reappear later.
 */
export async function pruneOrphanAnnotations(): Promise<number> {
  const db = await getDb();
  const matcher = buildMatcher(await termPatterns());
  const annotations = await db.select().from(schema.annotations);
  if (annotations.length === 0) return 0;

  const byDocument = new Map<number, schema.Annotation[]>();
  for (const annotation of annotations) {
    const list = byDocument.get(annotation.documentId) ?? [];
    list.push(annotation);
    byDocument.set(annotation.documentId, list);
  }

  const orphans: number[] = [];
  for (const [documentId, list] of byDocument) {
    const [document] = await db
      .select({ text: schema.documents.text })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const live = new Map(
      matcher
        .find(document?.text ?? "")
        .map((occurrence) => [spanKey(occurrence), occurrence.termId]),
    );
    for (const annotation of list) {
      if (live.get(spanKey(annotation)) !== annotation.termId) orphans.push(annotation.id);
    }
  }
  if (orphans.length > 0) {
    await db.delete(schema.annotations).where(inArray(schema.annotations.id, orphans));
  }
  return orphans.length;
}
