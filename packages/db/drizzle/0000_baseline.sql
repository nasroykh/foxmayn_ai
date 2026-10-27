CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('topup', 'usage', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."operation_type" AS ENUM('chat', 'embedding');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 300000,
	"rate_limit_max" integer DEFAULT 100,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	"credits_balance" numeric(18, 8) DEFAULT '0' NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text,
	"title" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"source" text,
	"embedding_model" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"chunk_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"content" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"token_count" integer,
	"qdrant_point_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rag_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"embedding_model" text DEFAULT 'openai/text-embedding-3-small' NOT NULL,
	"chunk_size" integer DEFAULT 500 NOT NULL,
	"chunk_overlap" integer DEFAULT 50 NOT NULL,
	"separators" jsonb DEFAULT '["\n\n","\n",". ","! ","? ","; ",", "," ",""]'::jsonb NOT NULL,
	"score_threshold" real DEFAULT 0.3 NOT NULL,
	"top_k" integer DEFAULT 5 NOT NULL,
	"model" text DEFAULT 'google/gemini-2.5-flash-lite' NOT NULL,
	"temperature" real DEFAULT 0.7 NOT NULL,
	"top_p" real DEFAULT 1 NOT NULL,
	"max_tokens" integer DEFAULT 2048 NOT NULL,
	"reasoning_effort" text DEFAULT 'none' NOT NULL,
	"assistant_name" text DEFAULT 'Assistant' NOT NULL,
	"company_name" text,
	"domain" text,
	"tone" text DEFAULT 'friendly' NOT NULL,
	"response_length" text DEFAULT 'balanced' NOT NULL,
	"language" text DEFAULT 'English' NOT NULL,
	"enable_citations" boolean DEFAULT true NOT NULL,
	"system_prompt" text,
	"custom_instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"operation_type" "operation_type" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"cost_credits" numeric(18, 8) DEFAULT '0' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"balance_after" numeric(18, 8) NOT NULL,
	"description" text NOT NULL,
	"reference_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_profile_id_rag_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."rag_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_profile_id_rag_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."rag_profile"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk" ADD CONSTRAINT "document_chunk_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_profile" ADD CONSTRAINT "rag_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "apikey_configId_idx" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "apikey_referenceId_idx" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "conversation_profile_idx" ON "conversation" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "conversation_userId_idx" ON "conversation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "document_status_idx" ON "document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "document_profile_idx" ON "document" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "document_userId_idx" ON "document" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chunk_documentId_idx" ON "document_chunk" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "chunk_qdrantPointId_idx" ON "document_chunk" USING btree ("qdrant_point_id");--> statement-breakpoint
CREATE INDEX "message_conversation_createdAt_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "rag_profile_userId_idx" ON "rag_profile" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rag_profile_one_default_per_user_uidx" ON "rag_profile" USING btree ("user_id") WHERE "rag_profile"."is_default";--> statement-breakpoint
CREATE INDEX "ai_usage_log_userId_idx" ON "ai_usage_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_log_createdAt_idx" ON "ai_usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_log_operationType_idx" ON "ai_usage_log" USING btree ("operation_type");--> statement-breakpoint
CREATE INDEX "ai_usage_log_org_createdAt_idx" ON "ai_usage_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_tx_orgId_idx" ON "credit_transaction" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "credit_tx_createdAt_idx" ON "credit_transaction" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "credit_tx_referenceId_idx" ON "credit_transaction" USING btree ("reference_id");