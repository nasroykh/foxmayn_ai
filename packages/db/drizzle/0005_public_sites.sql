CREATE TABLE "public_site" (
	"hostname" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_site_hostname_lower" CHECK ("public_site"."hostname" = lower("public_site"."hostname"))
);
--> statement-breakpoint
ALTER TABLE "public_site" ADD CONSTRAINT "public_site_profile_id_rag_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."rag_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site" ADD CONSTRAINT "public_site_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site" ADD CONSTRAINT "public_site_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_site_organization_id_idx" ON "public_site" USING btree ("organization_id");