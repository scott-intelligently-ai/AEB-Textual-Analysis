import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { normalizeTerm } from "../lib/text/match";
import { badRequest, notFound } from "./http";

const tidy = (value: string) => value.trim().split(/\s+/).join(" ");

function sameName(a: string, b: string): boolean {
  return normalizeTerm(a) === normalizeTerm(b);
}

export async function listCategories(): Promise<schema.TermCategory[]> {
  const db = await getDb();
  return db.select().from(schema.termCategories).orderBy(asc(schema.termCategories.sortOrder), asc(schema.termCategories.id));
}

export async function createCategory(name: string, parentId?: number | null): Promise<schema.TermCategory> {
  const db = await getDb();
  const label = tidy(name);
  if (!label) throw badRequest("A category needs a name.");
  const categories = await listCategories();
  let parent: schema.TermCategory | undefined;
  if (parentId !== undefined && parentId !== null) {
    parent = categories.find((category) => category.id === parentId);
    if (!parent) throw notFound("Category");
    if (parent.parentId !== null) throw badRequest("A subcategory cannot contain another subcategory.");
  }
  const siblings = categories.filter((category) => category.parentId === (parent?.id ?? null));
  if (siblings.some((category) => sameName(category.name, label))) {
    throw badRequest(
      parent
        ? `"${label}" is already a subcategory of "${parent.name}".`
        : `"${label}" is already a category.`,
    );
  }
  const sortOrder = siblings.reduce((max, category) => Math.max(max, category.sortOrder), -1) + 1;
  const [created] = await db
    .insert(schema.termCategories)
    .values({ name: label, parentId: parent?.id ?? null, sortOrder })
    .returning();
  return created;
}

export async function renameCategory(id: number, name: string): Promise<schema.TermCategory> {
  const db = await getDb();
  const categories = await listCategories();
  const current = categories.find((category) => category.id === id);
  if (!current) throw notFound("Category");
  const label = tidy(name);
  if (!label) throw badRequest("A category needs a name.");
  const siblings = categories.filter(
    (category) => category.id !== id && category.parentId === current.parentId,
  );
  if (siblings.some((category) => sameName(category.name, label))) {
    throw badRequest(`"${label}" is already used at this level.`);
  }
  const [updated] = await db
    .update(schema.termCategories)
    .set({ name: label })
    .where(eq(schema.termCategories.id, id))
    .returning();
  return updated;
}

export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  const deleted = await db
    .delete(schema.termCategories)
    .where(eq(schema.termCategories.id, id))
    .returning({ id: schema.termCategories.id });
  if (deleted.length === 0) throw notFound("Category");
}

export async function setTermCategories(termId: number, categoryIds: number[]): Promise<number[]> {
  const db = await getDb();
  const [term] = await db.select({ id: schema.terms.id }).from(schema.terms).where(eq(schema.terms.id, termId));
  if (!term) throw notFound("Term");
  const known = new Set((await listCategories()).map((category) => category.id));
  const unique = [...new Set(categoryIds)];
  if (unique.some((id) => !known.has(id))) throw badRequest("Choose a category that exists.");
  await db.delete(schema.termCategoryMembers).where(eq(schema.termCategoryMembers.termId, termId));
  if (unique.length > 0) {
    await db
      .insert(schema.termCategoryMembers)
      .values(unique.map((categoryId) => ({ termId, categoryId })));
  }
  return unique;
}

export async function setTermEquivalence(termId: number, equivalenceId: number | null): Promise<void> {
  const db = await getDb();
  const [term] = await db
    .select({ id: schema.terms.id })
    .from(schema.terms)
    .where(eq(schema.terms.id, termId));
  if (!term) throw notFound("Term");
  if (equivalenceId !== null) {
    const groups = await listEquivalences();
    if (!groups.some((group) => group.id === equivalenceId)) throw notFound("Equivalence group");
  }
  await db.update(schema.terms).set({ equivalenceId }).where(eq(schema.terms.id, termId));
}

export async function listEquivalences(): Promise<schema.TermEquivalence[]> {
  const db = await getDb();
  return db.select().from(schema.termEquivalences).orderBy(asc(schema.termEquivalences.id));
}

export async function createEquivalence(name: string, termIds: number[]): Promise<schema.TermEquivalence> {
  const db = await getDb();
  const label = tidy(name);
  if (!label) throw badRequest("An equivalence group needs a name.");
  const groups = await listEquivalences();
  if (groups.some((group) => sameName(group.name, label))) {
    throw badRequest(`"${label}" is already an equivalence group.`);
  }
  const [created] = await db.insert(schema.termEquivalences).values({ name: label }).returning();
  await setEquivalenceMembers(created.id, termIds);
  return created;
}

export async function updateEquivalence(
  id: number,
  input: { name?: string; termIds?: number[] },
): Promise<schema.TermEquivalence> {
  const db = await getDb();
  const groups = await listEquivalences();
  const current = groups.find((group) => group.id === id);
  if (!current) throw notFound("Equivalence group");
  let name = current.name;
  if (input.name !== undefined) {
    name = tidy(input.name);
    if (!name) throw badRequest("An equivalence group needs a name.");
    if (groups.some((group) => group.id !== id && sameName(group.name, name))) {
      throw badRequest(`"${name}" is already an equivalence group.`);
    }
    await db.update(schema.termEquivalences).set({ name }).where(eq(schema.termEquivalences.id, id));
  }
  if (input.termIds) await setEquivalenceMembers(id, input.termIds);
  return { ...current, name };
}

export async function deleteEquivalence(id: number): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.terms)
    .set({ equivalenceId: null })
    .where(eq(schema.terms.equivalenceId, id));
  const deleted = await db
    .delete(schema.termEquivalences)
    .where(eq(schema.termEquivalences.id, id))
    .returning({ id: schema.termEquivalences.id });
  if (deleted.length === 0) throw notFound("Equivalence group");
}

async function setEquivalenceMembers(id: number, termIds: number[]): Promise<void> {
  const db = await getDb();
  const unique = [...new Set(termIds)];
  const terms = await db.select({ id: schema.terms.id }).from(schema.terms);
  const known = new Set(terms.map((term) => term.id));
  if (unique.some((termId) => !known.has(termId))) throw badRequest("Choose a term that exists.");
  await db.update(schema.terms).set({ equivalenceId: null }).where(eq(schema.terms.equivalenceId, id));
  if (unique.length === 0) return;
  for (const termId of unique) {
    await db.update(schema.terms).set({ equivalenceId: id }).where(eq(schema.terms.id, termId));
  }
}

export async function listDocumentTags(): Promise<schema.DocumentTag[]> {
  const db = await getDb();
  return db.select().from(schema.documentTags).orderBy(asc(schema.documentTags.name), asc(schema.documentTags.id));
}

export async function createDocumentTag(name: string): Promise<schema.DocumentTag> {
  const db = await getDb();
  const label = tidy(name);
  if (!label) throw badRequest("A tag needs a name.");
  const tags = await listDocumentTags();
  if (tags.some((tag) => sameName(tag.name, label))) throw badRequest(`"${label}" is already a tag.`);
  const [created] = await db.insert(schema.documentTags).values({ name: label }).returning();
  return created;
}

export async function renameDocumentTag(id: number, name: string): Promise<schema.DocumentTag> {
  const db = await getDb();
  const tags = await listDocumentTags();
  const current = tags.find((tag) => tag.id === id);
  if (!current) throw notFound("Tag");
  const label = tidy(name);
  if (!label) throw badRequest("A tag needs a name.");
  if (tags.some((tag) => tag.id !== id && sameName(tag.name, label))) {
    throw badRequest(`"${label}" is already a tag.`);
  }
  const [updated] = await db
    .update(schema.documentTags)
    .set({ name: label })
    .where(eq(schema.documentTags.id, id))
    .returning();
  return updated;
}

export async function deleteDocumentTag(id: number): Promise<void> {
  const db = await getDb();
  const deleted = await db
    .delete(schema.documentTags)
    .where(eq(schema.documentTags.id, id))
    .returning({ id: schema.documentTags.id });
  if (deleted.length === 0) throw notFound("Tag");
}

export async function setDocumentTags(documentId: number, tagIds: number[]): Promise<number[]> {
  const db = await getDb();
  const [document] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!document) throw notFound("Document");
  const known = new Set((await listDocumentTags()).map((tag) => tag.id));
  const unique = [...new Set(tagIds)];
  if (unique.some((id) => !known.has(id))) throw badRequest("Choose a tag that exists.");
  await db.delete(schema.documentTagMembers).where(eq(schema.documentTagMembers.documentId, documentId));
  if (unique.length > 0) {
    await db
      .insert(schema.documentTagMembers)
      .values(unique.map((tagId) => ({ documentId, tagId })));
  }
  return unique;
}

export async function tagsByDocument(): Promise<Map<number, schema.DocumentTag[]>> {
  const db = await getDb();
  const tags = await listDocumentTags();
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const members = await db.select().from(schema.documentTagMembers);
  const result = new Map<number, schema.DocumentTag[]>();
  for (const member of members) {
    const tag = byId.get(member.tagId);
    if (!tag) continue;
    const list = result.get(member.documentId) ?? [];
    list.push(tag);
    result.set(member.documentId, list);
  }
  for (const list of result.values()) list.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return result;
}
