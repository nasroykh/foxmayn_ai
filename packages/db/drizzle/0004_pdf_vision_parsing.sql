ALTER TYPE "public"."operation_type" ADD VALUE 'transcription';--> statement-breakpoint
CREATE TABLE "document_file" (
	"document_id" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rag_profile" ADD COLUMN "pdf_parsing" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_file" ADD CONSTRAINT "document_file_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;