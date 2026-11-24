CREATE TABLE "annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"term_id" integer NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"tone_id" integer NOT NULL,
	"source" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"source_page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"upload_id" integer NOT NULL,
	"page_number" integer NOT NULL,
	"storage_path" text NOT NULL,
	"ocr_text" text DEFAULT '' NOT NULL,
	"ocr_status" text DEFAULT 'pending' NOT NULL,
	"ocr_error" text,
	"ocr_model" text,
	"ocr_provider" text,
	"edited" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"normalized" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tones" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" integer NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'awaiting_file' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_tone_id_tones_id_fk" FOREIGN KEY ("tone_id") REFERENCES "public"."tones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annotations_span_idx" ON "annotations" USING btree ("document_id","start","end");--> statement-breakpoint
CREATE INDEX "pages_upload_idx" ON "pages" USING btree ("upload_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "term_suggestions_normalized_idx" ON "term_suggestions" USING btree ("normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "tones_name_idx" ON "tones" USING btree ("name");