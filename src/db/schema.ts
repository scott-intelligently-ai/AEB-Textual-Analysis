import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow();

export const UPLOAD_STATUSES = [
  "awaiting_file",
  "queued",
  "rendering",
  "ready",
  "error",
] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  /** Object key of the original file in the scans bucket. */
  storagePath: text("storage_path").notNull(),
  status: text("status", { enum: UPLOAD_STATUSES }).notNull().default("awaiting_file"),
  error: text("error"),
  createdAt: createdAt(),
});

export const OCR_STATUSES = ["pending", "processing", "done", "error"] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

export const pages = pgTable(
  "pages",
  {
    id: serial("id").primaryKey(),
    uploadId: integer("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    storagePath: text("storage_path").notNull(),
    ocrText: text("ocr_text").notNull().default(""),
    ocrStatus: text("ocr_status", { enum: OCR_STATUSES }).notNull().default("pending"),
    ocrError: text("ocr_error"),
    ocrModel: text("ocr_model"),
    /** Provider asked to convert this page. The worker reads it when it runs. */
    ocrProvider: text("ocr_provider"),
    edited: boolean("edited").notNull().default(false),
  },
  (t) => [index("pages_upload_idx").on(t.uploadId, t.pageNumber)],
);

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  sourcePageIds: jsonb("source_page_ids")
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});

export const terms = pgTable("terms", {
  id: serial("id").primaryKey(),
  text: text("text").notNull(),
  variants: jsonb("variants").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
});

export const tones = pgTable(
  "tones",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull(),
    score: real("score").notNull().default(0),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [uniqueIndex("tones_name_idx").on(t.name)],
);

export const ANNOTATION_SOURCES = ["user", "ai"] as const;
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];

export const annotations = pgTable(
  "annotations",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    termId: integer("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    start: integer("start").notNull(),
    end: integer("end").notNull(),
    toneId: integer("tone_id")
      .notNull()
      .references(() => tones.id, { onDelete: "cascade" }),
    source: text("source", { enum: ANNOTATION_SOURCES }).notNull(),
    reason: text("reason"),
  },
  (t) => [uniqueIndex("annotations_span_idx").on(t.documentId, t.start, t.end)],
);

export const SUGGESTION_STATUSES = ["pending", "accepted", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const termSuggestions = pgTable(
  "term_suggestions",
  {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    normalized: text("normalized").notNull(),
    rationale: text("rationale").notNull().default(""),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("term_suggestions_normalized_idx").on(t.normalized)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Upload = typeof uploads.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Term = typeof terms.$inferSelect;
export type Tone = typeof tones.$inferSelect;
export type Annotation = typeof annotations.$inferSelect;
export type TermSuggestion = typeof termSuggestions.$inferSelect;
