import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import {
  combineParts,
  joinPages,
  rebaseSpans,
  splitPart,
} from "../lib/text/documents";
import { badRequest, notFound } from "./http";
import { termPatterns } from "./terms";

export interface DocumentSummary {
  id: number;
  title: string;
  length: number;
  words: number;
  annotationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourcePage {
  id: number;
  uploadId: number;
  pageNumber: number;
  filename: string;
}

export interface DocumentDetail {
  id: number;
  title: string;
  text: string;
  updatedAt: string;
  /** Scanned pages this text came from, for checking against the original. */
  sourcePages: SourcePage[];
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type NewAnnotation = Omit<schema.Annotation, "id">;

const now = sql`(CURRENT_TIMESTAMP)`;
const byTitle = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

export function listDocuments(): DocumentSummary[] {
  const db = getDb();
  const counts = new Map(
    db
      .select({ documentId: schema.annotations.documentId, count: sql<number>`count(*)` })
      .from(schema.annotations)
      .groupBy(schema.annotations.documentId)
      .all()
      .map((row) => [row.documentId, row.count]),
  );
  return db
    .select()
    .from(schema.documents)
    .all()
    .map((document) => ({
      id: document.id,
      title: document.title,
      length: document.text.length,
      words: countWords(document.text),
      annotationCount: counts.get(document.id) ?? 0,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }))
    .sort((a, b) => byTitle.compare(a.title, b.title) || a.id - b.id);
}

export function getDocumentRow(id: number): schema.DocumentRow {
  const document = getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .get();
  if (!document) throw notFound("Document");
  return document;
}

/** Full rows for the given documents (all when ids is omitted), sorted by title. */
export function getDocumentRows(ids?: number[]): schema.DocumentRow[] {
  const db = getDb();
  if (ids?.length === 0) return [];
  const rows = ids
    ? db.select().from(schema.documents).where(inArray(schema.documents.id, ids)).all()
    : db.select().from(schema.documents).all();
  return rows.sort((a, b) => byTitle.compare(a.title, b.title) || a.id - b.id);
}

export function getDocument(id: number): DocumentDetail {
  const db = getDb();
  const document = getDocumentRow(id);
  const pages =
    document.sourcePageIds.length === 0
      ? []
      : db
          .select({
            id: schema.pages.id,
            uploadId: schema.pages.uploadId,
            pageNumber: schema.pages.pageNumber,
            filename: schema.uploads.filename,
          })
          .from(schema.pages)
          .innerJoin(schema.uploads, eq(schema.uploads.id, schema.pages.uploadId))
          .where(inArray(schema.pages.id, document.sourcePageIds))
          .all();
  const byId = new Map(pages.map((page) => [page.id, page]));
  return {
    id: document.id,
    title: document.title,
    text: document.text,
    updatedAt: document.updatedAt,
    sourcePages: document.sourcePageIds.flatMap((pageId) => byId.get(pageId) ?? []),
  };
}

function annotationsOf(tx: Tx | Db, documentId: number): schema.Annotation[] {
  return tx
    .select()
    .from(schema.annotations)
    .where(eq(schema.annotations.documentId, documentId))
    .all();
}

function replaceAnnotations(tx: Tx, documentId: number, annotations: NewAnnotation[]): void {
  tx.delete(schema.annotations).where(eq(schema.annotations.documentId, documentId)).run();
  if (annotations.length > 0) {
    tx.insert(schema.annotations)
      .values(annotations.map((annotation) => ({ ...annotation, documentId })))
      .run();
  }
}

const withoutId = (a: schema.Annotation): NewAnnotation => ({
  documentId: a.documentId,
  termId: a.termId,
  start: a.start,
  end: a.end,
  toneId: a.toneId,
  source: a.source,
  reason: a.reason,
});

export function createDocumentFromUpload(uploadId: number, title?: string): { id: number } {
  const db = getDb();
  const upload = db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId)).get();
  if (!upload) throw notFound("Upload");
  const pages = db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.uploadId, uploadId))
    .orderBy(schema.pages.pageNumber)
    .all();
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
  return db
    .insert(schema.documents)
    .values({
      title: title?.trim() || fallback,
      text,
      sourcePageIds: pages.map((page) => page.id),
    })
    .returning({ id: schema.documents.id })
    .get();
}

export function renameDocument(id: number, title: string): void {
  const tidy = title.trim();
  if (!tidy) throw badRequest("A document needs a title.");
  getDocumentRow(id);
  getDb()
    .update(schema.documents)
    .set({ title: tidy, updatedAt: now })
    .where(eq(schema.documents.id, id))
    .run();
}

/** Saves edited text and reports how many tone tags the edit cleared. */
export function updateDocumentText(id: number, text: string): { cleared: number } {
  const db = getDb();
  const document = getDocumentRow(id);
  const next = text.replace(/\r\n?/g, "\n");
  if (!next.trim()) throw badRequest("A document cannot be empty.");
  if (next === document.text) return { cleared: 0 };
  return db.transaction((tx) => {
    const { kept, dropped } = rebaseSpans(
      document.text,
      next,
      annotationsOf(tx, id),
      termPatterns(),
    );
    replaceAnnotations(tx, id, kept.map(withoutId));
    tx.update(schema.documents)
      .set({ text: next, updatedAt: now })
      .where(eq(schema.documents.id, id))
      .run();
    return { cleared: dropped.length };
  });
}

export function deleteDocument(id: number): void {
  const result = getDb().delete(schema.documents).where(eq(schema.documents.id, id)).run();
  if (result.changes === 0) throw notFound("Document");
}

/**
 * Joins documents, in the order given, into one new document and removes the
 * originals. Tone tags move with their text.
 */
export function combineDocuments(ids: number[], title?: string): { id: number } {
  if (ids.length < 2) throw badRequest("Choose at least two documents to combine.");
  if (new Set(ids).size !== ids.length) throw badRequest("A document can only be combined once.");
  const db = getDb();
  const documents = ids.map(getDocumentRow);
  return db.transaction((tx) => {
    const combined = combineParts(
      documents.map((document) => ({
        text: document.text,
        spans: annotationsOf(tx, document.id),
      })),
    );
    const sourcePageIds = [...new Set(documents.flatMap((document) => document.sourcePageIds))];
    const created = tx
      .insert(schema.documents)
      .values({
        title: title?.trim() || documents[0].title,
        text: combined.text,
        sourcePageIds,
      })
      .returning({ id: schema.documents.id })
      .get();
    tx.delete(schema.documents).where(inArray(schema.documents.id, ids)).run();
    replaceAnnotations(tx, created.id, combined.spans.map(withoutId));
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
export function splitDocument(
  id: number,
  offset: number,
  titles: SplitTitles = {},
): { first: number; second: number; cleared: number } {
  const db = getDb();
  const document = getDocumentRow(id);
  return db.transaction((tx) => {
    const { first, second, dropped } = splitPart(document.text, annotationsOf(tx, id), offset);
    tx.update(schema.documents)
      .set({
        title: titles.first?.trim() || `${document.title} (part 1)`,
        text: first.text,
        updatedAt: now,
      })
      .where(eq(schema.documents.id, id))
      .run();
    replaceAnnotations(tx, id, first.spans.map(withoutId));
    const created = tx
      .insert(schema.documents)
      .values({
        title: titles.second?.trim() || `${document.title} (part 2)`,
        text: second.text,
        sourcePageIds: document.sourcePageIds,
      })
      .returning({ id: schema.documents.id })
      .get();
    replaceAnnotations(tx, created.id, second.spans.map(withoutId));
    return { first: id, second: created.id, cleared: dropped.length };
  });
}
