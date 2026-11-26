import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { buildMatcher, normalizeTerm, spanKey, type TermPattern } from "../lib/text/match";
import { badRequest, notFound } from "./http";
import {
  createCategory,
  createEquivalence,
  deleteEquivalence,
  listCategories,
  listEquivalences,
  setTermCategories,
  setTermEquivalence,
} from "./taxonomy";

export interface TermInput {
  text: string;
  variants?: string[];
  /** Category names to assign to this term. Missing categories are created. */
  categories?: string[];
  /** Other terms that should share an equivalence group with this one. */
  equivalents?: string[];
  /** Name of an equivalence group. Empty means the term stands alone unless equivalents are listed. */
  equivalence?: string | null;
  /** When true, only this capitalization of the term and its variants is counted. */
  caseSensitive?: boolean;
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
  return (await listTerms()).map(({ id, text, variants, caseSensitive }) => ({
    id,
    text,
    variants,
    caseSensitive,
  }));
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
): Promise<{ text: string; variants: string[]; caseSensitive: boolean }> {
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
  return { text, variants, caseSensitive: input.caseSensitive === true };
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
  const prepared = await prepare(input, id);
  const [term] = await db
    .update(schema.terms)
    .set({
      ...prepared,
      caseSensitive: input.caseSensitive ?? existing.caseSensitive,
    })
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
  /** Categories named in the file, with the terms assigned to each one. */
  categories: { name: string; terms: string[] }[];
}

export async function importTerms(inputs: TermInput[]): Promise<ImportResult> {
  const db = await getDb();
  const result: ImportResult = { added: [], skipped: [], groups: [], categories: [] };
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
  await assignImportedCategories(inputs, result);
  await ensureImportedEquivalents(inputs, result);
  await assignImportedGroups(inputs, result);
  await pruneOrphanAnnotations();
  return result;
}

/** Creates categories named in the file and assigns them without removing ones a term already has. */
async function assignImportedCategories(inputs: TermInput[], result: ImportResult): Promise<void> {
  const wanted = inputs.filter((input) => (input.categories ?? []).some((item) => tidy(item)));
  if (wanted.length === 0) return;
  const placed = new Map<string, { name: string; terms: string[] }>();

  for (const input of wanted) {
    const terms = await listTerms();
    const term = terms.find((item) => normalizeTerm(item.text) === normalizeTerm(tidy(input.text)));
    if (!term) continue;
    const ids = new Set(term.categoryIds);
    for (const raw of input.categories ?? []) {
      const name = tidy(raw);
      if (!name) continue;
      const category = await findOrCreateCategory(name);
      ids.add(category.id);
      const entry = placed.get(normalizeTerm(category.name)) ?? { name: category.name, terms: [] };
      if (!entry.terms.some((text) => normalizeTerm(text) === normalizeTerm(term.text))) {
        entry.terms.push(term.text);
      }
      placed.set(normalizeTerm(category.name), entry);
    }
    const next = [...ids];
    const same =
      next.length === term.categoryIds.length && next.every((id) => term.categoryIds.includes(id));
    if (!same) await setTermCategories(term.id, next);
  }
  result.categories = [...placed.values()];
}

/** Reuses a category of the same name, including a subcategory, before creating a top-level one. */
async function findOrCreateCategory(name: string): Promise<schema.TermCategory> {
  const categories = await listCategories();
  const key = normalizeTerm(name);
  const top = categories.find((category) => category.parentId === null && normalizeTerm(category.name) === key);
  if (top) return top;
  const existing = categories.find((category) => normalizeTerm(category.name) === key);
  if (existing) return existing;
  return createCategory(name);
}

/** Adds equivalent terms that are not already on the list. A wording already taken is reported. */
async function ensureImportedEquivalents(inputs: TermInput[], result: ImportResult): Promise<void> {
  const db = await getDb();
  for (const input of inputs) {
    for (const raw of input.equivalents ?? []) {
      const text = tidy(raw);
      if (!text) continue;
      try {
        const [term] = await db.insert(schema.terms).values(await prepare({ text })).returning();
        result.added.push(term);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already on the term list/.test(message)) continue;
        const key = normalizeTerm(text);
        if (result.skipped.some((item) => normalizeTerm(item.text) === key)) continue;
        result.skipped.push({ text, reason: message });
      }
    }
  }
}

/**
 * Places a term and the equivalents named beside it into one group. A term can
 * belong to only one group, so the term keeps its current group and the
 * equivalents join it. A term with no group joins an equivalent that already
 * has one. A named group is reused or created first.
 */
async function assignImportedGroups(inputs: TermInput[], result: ImportResult): Promise<void> {
  const wanted = inputs.filter(
    (input) => tidy(input.equivalence ?? "") || (input.equivalents ?? []).some((item) => tidy(item)),
  );
  if (wanted.length === 0) return;
  const placed = new Map<string, { name: string; terms: string[] }>();
  const emptied = new Set<number>();

  for (const input of wanted) {
    const terms = await listTerms();
    const byText = new Map(terms.map((term) => [normalizeTerm(term.text), term]));
    const primary = byText.get(normalizeTerm(tidy(input.text)));
    if (!primary) continue;

    const members = [primary];
    for (const raw of input.equivalents ?? []) {
      const peer = byText.get(normalizeTerm(tidy(raw)));
      if (!peer || peer.id === primary.id || members.some((item) => item.id === peer.id)) continue;
      members.push(peer);
    }

    const named = tidy(input.equivalence ?? "");
    if (!named && members.length < 2) continue;

    const groups = await listEquivalences();
    const byName = new Map(groups.map((group) => [normalizeTerm(group.name), group]));
    let group = named ? byName.get(normalizeTerm(named)) : undefined;
    if (named && !group) group = await createEquivalence(named, []);
    if (!group) {
      const preferredId =
        primary.equivalenceId ??
        members.find((member) => member.equivalenceId !== null)?.equivalenceId ??
        null;
      group = preferredId === null ? undefined : groups.find((item) => item.id === preferredId);
    }
    if (!group) {
      group = byName.get(normalizeTerm(primary.text)) ?? (await createEquivalence(primary.text, []));
    }

    for (const member of members) {
      if (member.equivalenceId === group.id) continue;
      if (member.equivalenceId !== null) emptied.add(member.equivalenceId);
      await setTermEquivalence(member.id, group.id);
      member.equivalenceId = group.id;
    }

    const entry = placed.get(group.name) ?? { name: group.name, terms: [] };
    for (const member of members) {
      if (!entry.terms.some((text) => normalizeTerm(text) === normalizeTerm(member.text))) {
        entry.terms.push(member.text);
      }
    }
    placed.set(group.name, entry);

    const skipped = result.skipped.find((item) => normalizeTerm(item.text) === normalizeTerm(primary.text));
    if (skipped && !skipped.reason.includes(`equivalence group "${group.name}"`)) {
      skipped.reason = `${skipped.reason} It was placed in the equivalence group "${group.name}".`;
    }
  }

  if (emptied.size > 0) {
    const used = new Set(
      (await listTerms()).map((term) => term.equivalenceId).filter((id): id is number => id !== null),
    );
    for (const id of emptied) {
      if (!used.has(id)) await deleteEquivalence(id);
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
