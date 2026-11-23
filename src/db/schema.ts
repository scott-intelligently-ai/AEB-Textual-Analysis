import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`);

export const uploads = sqliteTable("uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  filePath: text("file_path").notNull(),
  createdAt: createdAt(),
});

export const OCR_STATUSES = ["pending", "processing", "done", "error"] as const;
export type OcrStatus = (typeof OCR_STATUSES)[number];

export const pages = sqliteTable(
  "pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: integer("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    imagePath: text("image_path").notNull(),
    ocrText: text("ocr_text").notNull().default(""),
    ocrStatus: text("ocr_status", { enum: OCR_STATUSES })
      .notNull()
      .default("pending"),
    ocrError: text("ocr_error"),
    ocrModel: text("ocr_model"),
    // True once the user has corrected the transcription by hand.
    edited: integer("edited", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("pages_upload_idx").on(t.uploadId, t.pageNumber)],
);

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  text: text("text").notNull(),
  sourcePageIds: text("source_page_ids", { mode: "json" })
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: createdAt(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

export const terms = sqliteTable("terms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  variants: text("variants", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: createdAt(),
});

export const tones = sqliteTable("tones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
  score: real("score").notNull().default(0),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const ANNOTATION_SOURCES = ["user", "ai"] as const;
export type AnnotationSource = (typeof ANNOTATION_SOURCES)[number];

export const annotations = sqliteTable(
  "annotations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
    // The model's one-line justification, kept only for AI suggestions.
    reason: text("reason"),
  },
  (t) => [
    uniqueIndex("annotations_span_idx").on(t.documentId, t.start, t.end),
  ],
);

export const SUGGESTION_STATUSES = ["pending", "accepted", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const termSuggestions = sqliteTable(
  "term_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    text: text("text").notNull(),
    // Lower-cased, whitespace-collapsed form used to stop repeat proposals.
    normalized: text("normalized").notNull(),
    rationale: text("rationale").notNull().default(""),
    status: text("status", { enum: SUGGESTION_STATUSES })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("term_suggestions_normalized_idx").on(t.normalized)],
);

export const settings = sqliteTable("settings", {
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
