import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "../db";
import { transcribePage } from "../lib/ai/ocr";
import { isProvider } from "../lib/ai/models";
import { extractDocumentText } from "../lib/text/extract";
import { isTextExtension } from "../lib/text/fileKinds";
import { getSettings } from "../server/settings";
import { getObject, putObject, removeFolder } from "../server/storage";
import { renderPages } from "./render";

const OCR_CONCURRENCY = 3;

async function claimUpload(): Promise<schema.Upload | undefined> {
  const db = await getDb();
  const [next] = await db
    .select()
    .from(schema.uploads)
    .where(eq(schema.uploads.status, "queued"))
    .orderBy(asc(schema.uploads.id))
    .limit(1);
  if (!next) return undefined;
  const [claimed] = await db
    .update(schema.uploads)
    .set({ status: "rendering", error: null })
    .where(and(eq(schema.uploads.id, next.id), eq(schema.uploads.status, "queued")))
    .returning();
  return claimed;
}

/** Prepares one queued upload: a scan becomes page images, a text file is read directly. */
export async function renderNextUpload(): Promise<boolean> {
  const upload = await claimUpload();
  if (!upload) return false;
  const db = await getDb();
  try {
    const original = await getObject(upload.storagePath);
    const extension = path.extname(upload.storagePath).toLowerCase();
    if (isTextExtension(extension)) await storeExtractedText(db, upload, original, extension);
    else await storeRenderedPages(db, upload, original, extension);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not prepare ${upload.filename}: ${message}`);
    await db.delete(schema.pages).where(eq(schema.pages.uploadId, upload.id));
    await db
      .update(schema.uploads)
      .set({ status: "error", error: message })
      .where(eq(schema.uploads.id, upload.id));
  }
  return true;
}

/** Stores the file's own text as one finished page, with no image and no OCR. */
async function storeExtractedText(
  db: Db,
  upload: schema.Upload,
  original: Buffer,
  extension: string,
): Promise<void> {
  const text = await extractDocumentText(original, extension);
  await db.delete(schema.pages).where(eq(schema.pages.uploadId, upload.id));
  await removeFolder(`uploads/${upload.id}/pages`);
  await db.insert(schema.pages).values({
    uploadId: upload.id,
    pageNumber: 1,
    storagePath: "",
    ocrText: text,
    ocrStatus: "done",
  });
  await db
    .update(schema.uploads)
    .set({ status: "ready", error: null })
    .where(eq(schema.uploads.id, upload.id));
  console.log(`Read text from ${upload.filename}`);
}

/** Renders a scan into page images and queues each page for OCR. */
async function storeRenderedPages(
  db: Db,
  upload: schema.Upload,
  original: Buffer,
  extension: string,
): Promise<void> {
  const images = await renderPages(original, extension);
  if (images.length === 0) throw new Error("The file has no pages.");
  await db.delete(schema.pages).where(eq(schema.pages.uploadId, upload.id));
  await removeFolder(`uploads/${upload.id}/pages`);
  const settings = await getSettings();
  for (let i = 0; i < images.length; i += 1) {
    const storagePath = `uploads/${upload.id}/pages/page-${i + 1}.jpg`;
    await putObject(storagePath, images[i], "image/jpeg");
    await db.insert(schema.pages).values({
      uploadId: upload.id,
      pageNumber: i + 1,
      storagePath,
      ocrStatus: "pending",
      ocrProvider: settings.ocrProvider,
    });
  }
  await db
    .update(schema.uploads)
    .set({ status: "ready", error: null })
    .where(eq(schema.uploads.id, upload.id));
  console.log(`Rendered ${images.length} page${images.length === 1 ? "" : "s"} of ${upload.filename}`);
}

async function claimPage(): Promise<schema.Page | undefined> {
  const db = await getDb();
  const [next] = await db
    .select()
    .from(schema.pages)
    .where(eq(schema.pages.ocrStatus, "pending"))
    .orderBy(asc(schema.pages.id))
    .limit(1);
  if (!next) return undefined;
  const [claimed] = await db
    .update(schema.pages)
    .set({ ocrStatus: "processing" })
    .where(and(eq(schema.pages.id, next.id), eq(schema.pages.ocrStatus, "pending")))
    .returning();
  return claimed;
}

async function convertPage(page: schema.Page): Promise<void> {
  const db = await getDb();
  if (!page.storagePath) {
    await db
      .update(schema.pages)
      .set({ ocrStatus: "done", ocrError: null })
      .where(eq(schema.pages.id, page.id));
    return;
  }
  try {
    const image = await getObject(page.storagePath);
    const provider = isProvider(page.ocrProvider)
      ? page.ocrProvider
      : (await getSettings()).ocrProvider;
    const { text, model } = await transcribePage(image, provider);
    await db
      .update(schema.pages)
      .set({ ocrText: text, ocrStatus: "done", ocrError: null, ocrModel: model, edited: false })
      .where(eq(schema.pages.id, page.id));
    console.log(`Converted page ${page.pageNumber} of upload ${page.uploadId} with ${model}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Could not convert page ${page.id}: ${message}`);
    await db
      .update(schema.pages)
      .set({ ocrStatus: "error", ocrError: message })
      .where(eq(schema.pages.id, page.id));
  }
}

/** Converts up to a few pending pages at once. Returns how many were taken. */
export async function convertPendingPages(): Promise<number> {
  const claimed: schema.Page[] = [];
  for (let i = 0; i < OCR_CONCURRENCY; i += 1) {
    const page = await claimPage();
    if (!page) break;
    claimed.push(page);
  }
  await Promise.all(claimed.map(convertPage));
  return claimed.length;
}

/** Puts work interrupted by a restart back on the queue. One worker only. */
export async function resumeInterrupted(): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.uploads)
    .set({ status: "queued" })
    .where(eq(schema.uploads.status, "rendering"));
  await db
    .update(schema.pages)
    .set({ ocrStatus: "pending" })
    .where(eq(schema.pages.ocrStatus, "processing"));
}
