import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import { combineParts, joinPages, rebaseSpans, splitPart } from "../lib/text/documents";
import { badRequest, notFound } from "./http";
import { tagsByDocument } from "./taxonomy";
import { termPatterns } from "./terms";

export interface DocumentTagSummary {
  id: number;
  name: string;
}

export interface DocumentSummary {
  id: number;
  title: string;
  length: number;
  words: number;
  annotationCount: number;
  tags: DocumentTagSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface SourcePage {
  id: number;
  uploadId: number;
  pageNumber: number;
  filename: string;
  /** False when this page's text was read from a file and there is no scan to show. */
  hasImage: boolean;
}

export interface DocumentDetail {
  id: number;
  title: string;
  text: string;
  updatedAt: string;
  /** Scanned pages this text came from, for checking against the original. */
  sourcePages: SourcePage[];
  tags: DocumentTagSummary[];
}

type NewAnnotation = Omit<schema.Annotation, "id">;
const touch = sql`now()`;
const byTitle = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const db = await getDb();
  const counts = new Map(
    (
      await db
        .select({
          documentId: schema.annotations.documentId,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.annotations)
        .groupBy(schema.annotations.documentId)
    ).map((row) => [row.documentId, Number(row.count)]),
  );
  const documents = await db.select().from(schema.documents);
  const tags = await tagsByDocument();
  return documents
    .map((document) => ({
      id: document.id,
      title: document.title,
      length: document.text.length,
      words: countWords(document.text),
      annotationCount: counts.get(document.id) ?? 0,
      tags: (tags.get(document.id) ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }))
    .sort((a, b) => byTitle.compare(a.title, b.title) || a.id - b.id);
}

export async function getDocumentRow(id: number): Promise<schema.DocumentRow> {
  const db = await getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  if (!document) throw notFound("Document");
  return document;
}

/** Full rows for the given documents (all when ids is omitted), sorted by title. */
export async function getDocumentRows(ids?: number[]): Promise<schema.DocumentRow[]> {
  const db = await getDb();
  if (ids?.length === 0) return [];
  const rows = ids
    ? await db.select().from(schema.documents).where(inArray(schema.documents.id, ids))
    : await db.select().from(schema.documents);
  return rows.sort((a, b) => byTitle.compare(a.title, b.title) || a.id - b.id);
}

export async function getDocument(id: number): Promise<DocumentDetail> {
  const db = await getDb();
  const document = await getDocumentRow(id);
  const pages =
    document.sourcePageIds.length === 0
      ? []
      : await db
          .select({
            id: schema.pages.id,
            uploadId: schema.pages.uploadId,
            pageNumber: schema.pages.pageNumber,
            filename: schema.uploads.filename,
            storagePath: schema.pages.storagePath,
          })
          .from(schema.pages)
          .innerJoin(schema.uploads, eq(schema.uploads.id, schema.pages.uploadId))
          .where(inArray(schema.pages.id, document.sourcePageIds));
  const byId = new Map(
    pages.map((page) => [
      page.id,
      {
        id: page.id,
        uploadId: page.uploadId,
        pageNumber: page.pageNumber,
        filename: page.filename,
        hasImage: page.storagePath.length > 0,
      },
    ]),
  );
  const tags = (await tagsByDocument()).get(id) ?? [];
  return {
    id: document.id,
    title: document.title,
    text: document.text,
    updatedAt: document.updatedAt,
    sourcePages: document.sourcePageIds.flatMap((pageId) => byId.get(pageId) ?? []),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
  };
}

async function annotationsOf(tx: Db, documentId: number): Promise<schema.Annotation[]> {
  return tx
    .select()
    .from(schema.annotations)
    .where(eq(schema.annotations.documentId, documentId));
}

async function replaceAnnotations(
  tx: Db,
  documentId: number,
  annotations: NewAnnotation[],
): Promise<void> {
  await tx.delete(schema.annotations).where(eq(schema.annotations.documentId, documentId));
  if (annotations.length > 0) {
    await tx
      .insert(schema.annotations)
      .values(annotations.map((annotation) => ({ ...annotation, documentId })));
  }
}

const withoutId = (annotation: schema.Annotation): NewAnnotation => ({
  documentId: annotation.documentId,
  termId: annotation.termId,
  start: annotation.start,
  end: annotation.end,
  toneId: annotation.toneId,
  source: annotation.source,
  reason: annotation.reason,
});

export async function createDocumentFromUpload(
  uploadId: number,
  title?: string,
): Promise<{ id: number }> {
  const db = await getDb();
  const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!upload) throw notFound("Upload");
  const pages = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.uploadId, uploadId))
    .orderBy(schema.pages.pageNumber);
  const unfinished = pages.filter((page) => page.ocrStatus !== "done");
  if (unfinished.length > 0) {
    throw badRequest(
      `Page ${unfinished[0].pageNumber} has not been converted to text yet. ` +
        "Wait for conversion to finish, or run it again for pages that failed.",
    );
  }
  const text = joinPages(pages.map((page) => page.ocrText));
  if (!text) throw badRequest("None of the pages contain any text.");
  const fallback = upload.filename.replace(/\.[^.]+$/, "");
  const [created] = await db
    .insert(schema.documents)
    .values({
      title: title?.trim() || fallback,
      text,
      sourcePageIds: pages.map((page) => page.id),
    })
    .returning({ id: schema.documents.id });
  return created;
}

export async function renameDocument(id: number, title: string): Promise<void> {
  const tidy = title.trim();
  if (!tidy) throw badRequest("A document needs a title.");
  await getDocumentRow(id);
  const db = await getDb();
  await db
    .update(schema.documents)
    .set({ title: tidy, updatedAt: touch })
    .where(eq(schema.documents.id, id));
}

/** Saves edited text and reports how many tone tags the edit cleared. */
export async function updateDocumentText(id: number, text: string): Promise<{ cleared: number }> {
  const db = await getDb();
  const document = await getDocumentRow(id);
  const next = text.replace(/\r\n?/g, "\n");
  if (!next.trim()) throw badRequest("A document cannot be empty.");
  if (next === document.text) return { cleared: 0 };
  const patterns = await termPatterns();
  return db.transaction(async (tx) => {
    const { kept, dropped } = rebaseSpans(
      document.text,
      next,
      await annotationsOf(tx as unknown as Db, id),
      patterns,
    );
    await replaceAnnotations(tx as unknown as Db, id, kept.map(withoutId));
    await tx
      .update(schema.documents)
      .set({ text: next, updatedAt: touch })
      .where(eq(schema.documents.id, id));
    return { cleared: dropped.length };
  });
}

export async function deleteDocument(id: number): Promise<void> {
  const db = await getDb();
  const deleted = await db
    .delete(schema.documents)
    .where(eq(schema.documents.id, id))
    .returning({ id: schema.documents.id });
  if (deleted.length === 0) throw notFound("Document");
}

/**
 * Joins documents, in the order given, into one new document and removes the
 * originals. Tone tags move with their text.
 */
export async function combineDocuments(ids: number[], title?: string): Promise<{ id: number }> {
  if (ids.length < 2) throw badRequest("Choose at least two documents to combine.");
  if (new Set(ids).size !== ids.length) throw badRequest("A document can only be combined once.");
  const db = await getDb();
  const documents = await Promise.all(ids.map(getDocumentRow));
  return db.transaction(async (tx) => {
    const querier = tx as unknown as Db;
    const combined = combineParts(
      await Promise.all(
        documents.map(async (document) => ({
          text: document.text,
          spans: await annotationsOf(querier, document.id),
        })),
      ),
    );
    const sourcePageIds = [...new Set(documents.flatMap((document) => document.sourcePageIds))];
    const [created] = await tx
      .insert(schema.documents)
      .values({
        title: title?.trim() || documents[0].title,
        text: combined.text,
        sourcePageIds,
      })
      .returning({ id: schema.documents.id });
    await tx.delete(schema.documents).where(inArray(schema.documents.id, ids));
    await replaceAnnotations(querier, created.id, combined.spans.map(withoutId));
    return created;
  });
}

export interface SplitTitles {
  first?: string;
  second?: string;
}

/**
 * Cuts a document in two at a character offset. The original keeps the first
 * part; the second part becomes a new document.
 */
export async function splitDocument(
  id: number,
  offset: number,
  titles: SplitTitles = {},
): Promise<{ first: number; second: number; cleared: number }> {
  const db = await getDb();
  const document = await getDocumentRow(id);
  return db.transaction(async (tx) => {
    const querier = tx as unknown as Db;
    const { first, second, dropped } = splitPart(
      document.text,
      await annotationsOf(querier, id),
      offset,
    );
    await tx
      .update(schema.documents)
      .set({
        title: titles.first?.trim() || `${document.title} (part 1)`,
        text: first.text,
        updatedAt: touch,
      })
      .where(eq(schema.documents.id, id));
    await replaceAnnotations(querier, id, first.spans.map(withoutId));
    const [created] = await tx
      .insert(schema.documents)
      .values({
        title: titles.second?.trim() || `${document.title} (part 2)`,
        text: second.text,
        sourcePageIds: document.sourcePageIds,
      })
      .returning({ id: schema.documents.id });
    await replaceAnnotations(querier, created.id, second.spans.map(withoutId));
    return { first: id, second: created.id, cleared: dropped.length };
  });
}
