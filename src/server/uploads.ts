import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { OcrStatus, UploadStatus } from "../db/schema";
import type { Provider } from "../lib/ai/models";
import { cleanTranscription } from "../lib/text/transcription";
import { badRequest, notFound } from "./http";
import { createUploadTicket, objectExists, removeFolder } from "./storage";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".avif",
]);

/** Large scans are uploaded straight to storage, so this only guards accidents. */
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export interface PageSummary {
  id: number;
  pageNumber: number;
  ocrStatus: OcrStatus;
  ocrError: string | null;
  ocrModel: string | null;
  ocrText: string;
  edited: boolean;
}

export interface UploadSummary {
  id: number;
  filename: string;
  status: UploadStatus;
  error: string | null;
  createdAt: string;
  pages: PageSummary[];
  /** Documents whose text came from this upload's pages. */
  documents: { id: number; title: string }[];
}

export interface UploadTicket {
  id: number;
  path: string;
  token: string;
}

function extensionOf(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension !== ".pdf" && !IMAGE_EXTENSIONS.has(extension)) {
    throw badRequest(
      `${filename} is not a supported file. Upload a PDF or an image (PNG, JPEG, WebP, GIF, TIFF, AVIF).`,
    );
  }
  return extension;
}

export async function prepareUpload(input: {
  filename: string;
  mimeType: string;
  size: number;
}): Promise<UploadTicket> {
  const filename = input.filename.trim();
  if (!filename) throw badRequest("The file needs a name.");
  if (!Number.isFinite(input.size) || input.size <= 0) throw badRequest(`${filename} is empty.`);
  if (input.size > MAX_UPLOAD_BYTES) {
    throw badRequest(`${filename} is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`);
  }
  const extension = extensionOf(filename);
  const db = await getDb();
  const [upload] = await db
    .insert(schema.uploads)
    .values({
      filename,
      mimeType: input.mimeType || "application/octet-stream",
      storagePath: "pending",
      status: "awaiting_file",
    })
    .returning();
  const storagePath = `uploads/${upload.id}/original${extension}`;
  await db
    .update(schema.uploads)
    .set({ storagePath })
    .where(eq(schema.uploads.id, upload.id));
  try {
    const ticket = await createUploadTicket(storagePath);
    return { id: upload.id, path: ticket.path, token: ticket.token };
  } catch (error) {
    await db.delete(schema.uploads).where(eq(schema.uploads.id, upload.id));
    throw error;
  }
}

/** Marks an upload ready for the worker once its file is in storage. */
export async function queueUpload(id: number): Promise<UploadSummary> {
  const db = await getDb();
  const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
  if (!upload) throw notFound("Upload");
  if (upload.status === "queued" || upload.status === "rendering" || upload.status === "ready") {
    return getUpload(id);
  }
  if (!(await objectExists(upload.storagePath))) {
    throw badRequest("The file did not arrive. Choose it again.");
  }
  await db
    .update(schema.uploads)
    .set({ status: "queued", error: null })
    .where(eq(schema.uploads.id, id));
  return getUpload(id);
}

async function linkedDocuments(): Promise<Map<number, { id: number; title: string }[]>> {
  const db = await getDb();
  const byPage = new Map<number, { id: number; title: string }[]>();
  const documents = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      sourcePageIds: schema.documents.sourcePageIds,
    })
    .from(schema.documents);
  for (const { id, title, sourcePageIds } of documents) {
    for (const pageId of sourcePageIds) {
      const list = byPage.get(pageId) ?? [];
      list.push({ id, title });
      byPage.set(pageId, list);
    }
  }
  return byPage;
}

function summarize(
  upload: schema.Upload,
  pages: schema.Page[],
  links: Map<number, { id: number; title: string }[]>,
): UploadSummary {
  const documents = new Map<number, { id: number; title: string }>();
  for (const page of pages) {
    for (const document of links.get(page.id) ?? []) documents.set(document.id, document);
  }
  return {
    id: upload.id,
    filename: upload.filename,
    status: upload.status,
    error: upload.error,
    createdAt: upload.createdAt,
    pages: pages.map((page) => ({
      id: page.id,
      pageNumber: page.pageNumber,
      ocrStatus: page.ocrStatus,
      ocrError: page.ocrError,
      ocrModel: page.ocrModel,
      ocrText: page.ocrText,
      edited: page.edited,
    })),
    documents: [...documents.values()],
  };
}

async function pagesOf(uploadId: number): Promise<schema.Page[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.uploadId, uploadId))
    .orderBy(asc(schema.pages.pageNumber));
}

export async function listUploads(): Promise<UploadSummary[]> {
  const db = await getDb();
  const links = await linkedDocuments();
  const uploads = await db.select().from(schema.uploads).orderBy(asc(schema.uploads.id));
  return Promise.all(uploads.map(async (upload) => summarize(upload, await pagesOf(upload.id), links)));
}

export async function getUpload(id: number): Promise<UploadSummary> {
  const db = await getDb();
  const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
  if (!upload) throw notFound("Upload");
  return summarize(upload, await pagesOf(id), await linkedDocuments());
}

export async function deleteUpload(id: number): Promise<void> {
  const db = await getDb();
  const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
  if (!upload) throw notFound("Upload");
  await removeFolder(`uploads/${id}`);
  await db.delete(schema.uploads).where(eq(schema.uploads.id, id));
}

export async function getPage(id: number): Promise<schema.Page> {
  const db = await getDb();
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, id));
  if (!page) throw notFound("Page");
  return page;
}

export async function updatePageText(id: number, text: string): Promise<void> {
  await getPage(id);
  const db = await getDb();
  await db
    .update(schema.pages)
    .set({ ocrText: cleanTranscription(text), edited: true, ocrStatus: "done", ocrError: null })
    .where(eq(schema.pages.id, id));
}

/**
 * Asks the worker to convert these pages. The provider is stored on each page
 * so a later change of the default does not redirect work already queued.
 */
export async function enqueueOcr(pageIds: number[], provider: Provider): Promise<void> {
  if (pageIds.length === 0) return;
  const db = await getDb();
  await db
    .update(schema.pages)
    .set({ ocrStatus: "pending", ocrError: null, ocrProvider: provider })
    .where(inArray(schema.pages.id, pageIds));
}
