CREATE TABLE "document_tag_members" (
	"document_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "document_tag_members_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "document_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_category_members" (
	"term_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "term_category_members_term_id_category_id_pk" PRIMARY KEY("term_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "term_equivalences" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "equivalence_id" integer;--> statement-breakpoint
ALTER TABLE "document_tag_members" ADD CONSTRAINT "document_tag_members_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tag_members" ADD CONSTRAINT "document_tag_members_tag_id_document_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."document_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_categories" ADD CONSTRAINT "term_categories_parent_id_term_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."term_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_category_members" ADD CONSTRAINT "term_category_members_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_category_members" ADD CONSTRAINT "term_category_members_category_id_term_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."term_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_tags_name_idx" ON "document_tags" USING btree ("name");--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_equivalence_id_term_equivalences_id_fk" FOREIGN KEY ("equivalence_id") REFERENCES "public"."term_equivalences"("id") ON DELETE set null ON UPDATE no action;