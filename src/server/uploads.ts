import fs from "node:fs";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { getDb, schema, uploadsDir } from "../db";
import type { OcrStatus } from "../db/schema";
import { transcribePage } from "../lib/ai/ocr";
import type { Provider } from "../lib/ai/models";
import { cleanTranscription } from "../lib/text/transcription";
import { badRequest, notFound } from "./http";
import { getSettings } from "./settings";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".tif", ".tiff", ".avif"]);

/** Longest edge of a stored page image; plenty for typed text and within model limits. */
const MAX_EDGE = 2000;
const PDF_SCALE = 3;
const OCR_CONCURRENCY = 3;

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
  createdAt: string;
  pages: PageSummary[];
  /** Documents whose text came from this upload's pages. */
  documents: { id: number; title: string }[];
}

function uploadDir(uploadId: number): string {
  return path.join(uploadsDir(), String(uploadId));
}

async function toPageJpeg(input: Buffer, page = 0): Promise<Buffer> {
  return sharp(input, { page })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function renderPages(buffer: Buffer, extension: string): Promise<Buffer[]> {
  if (extension === ".pdf") {
    const { pdf } = await import("pdf-to-img");
    const document = await pdf(buffer, { scale: PDF_SCALE });
    try {
      const pages: Buffer[] = [];
      for await (const image of document) pages.push(await toPageJpeg(image));
      return pages;
    } finally {
      await document.destroy();
    }
  }
  const { pages = 1 } = await sharp(buffer).metadata();
  const frames = extension === ".gif" ? 1 : pages;
  const images: Buffer[] = [];
  for (let page = 0; page < frames; page += 1) images.push(await toPageJpeg(buffer, page));
  return images;
}

export async function createUpload(file: File): Promise<UploadSummary> {
  const extension = path.extname(file.name).toLowerCase();
  if (extension !== ".pdf" && !IMAGE_EXTENSIONS.has(extension)) {
    throw badRequest(
      `${file.name} is not a supported file. Upload a PDF or an image (PNG, JPEG, WebP, GIF, TIFF, AVIF).`,
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let images: Buffer[];
  try {
    images = await renderPages(buffer, extension);
  } catch (error) {
    throw badRequest(
      `${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (images.length === 0) throw badRequest(`${file.name} has no pages.`);

  const db = getDb();
  const upload = db
    .insert(schema.uploads)
    .values({ filename: file.name, mimeType: file.type || "application/octet-stream", filePath: "" })
    .returning()
    .get();
  const dir = uploadDir(upload.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `original${extension}`);
  fs.writeFileSync(filePath, buffer);
  db.update(schema.uploads).set({ filePath }).where(eq(schema.uploads.id, upload.id)).run();

  const pageIds: number[] = [];
  images.forEach((image, i) => {
    const imagePath = path.join(dir, `page-${i + 1}.jpg`);
    fs.writeFileSync(imagePath, image);
    const page = db
      .insert(schema.pages)
      .values({ uploadId: upload.id, pageNumber: i + 1, imagePath })
      .returning({ id: schema.pages.id })
      .get();
    pageIds.push(page.id);
  });

  enqueueOcr(pageIds, getSettings().ocrProvider);
  return getUpload(upload.id);
}

function linkedDocuments(): Map<number, { id: number; title: string }[]> {
  const byPage = new Map<number, { id: number; title: string }[]>();
  const documents = getDb()
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      sourcePageIds: schema.documents.sourcePageIds,
    })
    .from(schema.documents)
    .all();
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

function pagesOf(uploadId: number): schema.Page[] {
  return getDb()
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.uploadId, uploadId))
    .orderBy(asc(schema.pages.pageNumber))
    .all();
}

export function listUploads(): UploadSummary[] {
  const links = linkedDocuments();
  return getDb()
    .select()
    .from(schema.uploads)
    .orderBy(asc(schema.uploads.id))
    .all()
    .map((upload) => summarize(upload, pagesOf(upload.id), links));
}

export function getUpload(id: number): UploadSummary {
  const upload = getDb().select().from(schema.uploads).where(eq(schema.uploads.id, id)).get();
  if (!upload) throw notFound("Upload");
  return summarize(upload, pagesOf(id), linkedDocuments());
}

export function deleteUpload(id: number): void {
  const db = getDb();
  const upload = db.select().from(schema.uploads).where(eq(schema.uploads.id, id)).get();
  if (!upload) throw notFound("Upload");
  db.delete(schema.uploads).where(eq(schema.uploads.id, id)).run();
  fs.rmSync(uploadDir(id), { recursive: true, force: true });
}

export function getPage(id: number): schema.Page {
  const page = getDb().select().from(schema.pages).where(eq(schema.pages.id, id)).get();
  if (!page) throw notFound("Page");
  return page;
}

export function updatePageText(id: number, text: string): void {
  getPage(id);
  getDb()
    .update(schema.pages)
    .set({ ocrText: cleanTranscription(text), edited: true, ocrStatus: "done", ocrError: null })
    .where(eq(schema.pages.id, id))
    .run();
}

// ---------------------------------------------------------------------------
// OCR queue. Work runs inside the server process, a few pages at a time, and
// the browser polls for progress.

interface OcrQueue {
  waiting: { pageId: number; provider: Provider }[];
  active: number;
}

const globalForQueue = globalThis as unknown as { __ocrQueue?: OcrQueue };
const queue = (globalForQueue.__ocrQueue ??= { waiting: [], active: 0 });

export function enqueueOcr(pageIds: number[], provider: Provider): void {
  if (pageIds.length === 0) return;
  getDb()
    .update(schema.pages)
    .set({ ocrStatus: "pending", ocrError: null })
    .where(inArray(schema.pages.id, pageIds))
    .run();
  const queued = new Set(queue.waiting.map((job) => job.pageId));
  for (const pageId of pageIds) {
    if (!queued.has(pageId)) queue.waiting.push({ pageId, provider });
  }
  pump();
}

function pump(): void {
  while (queue.active < OCR_CONCURRENCY && queue.waiting.length > 0) {
    const job = queue.waiting.shift()!;
    queue.active += 1;
    void runJob(job.pageId, job.provider).finally(() => {
      queue.active -= 1;
      pump();
    });
  }
}

async function runJob(pageId: number, provider: Provider): Promise<void> {
  const db = getDb();
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  if (!page) return;
  db.update(schema.pages)
    .set({ ocrStatus: "processing" })
    .where(eq(schema.pages.id, pageId))
    .run();
  try {
    const image = await fs.promises.readFile(page.imagePath);
    const { text, model } = await transcribePage(image, provider);
    db.update(schema.pages)
      .set({ ocrText: text, ocrStatus: "done", ocrError: null, ocrModel: model, edited: false })
      .where(eq(schema.pages.id, pageId))
      .run();
  } catch (error) {
    db.update(schema.pages)
      .set({
        ocrStatus: "error",
        ocrError: error instanceof Error ? error.message : String(error),
      })
      .where(eq(schema.pages.id, pageId))
      .run();
  }
}
