DROP INDEX "credit_tx_orgId_idx";--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "credits_monthly_cap" numeric(18, 8);--> statement-breakpoint
CREATE INDEX "credit_tx_org_createdAt_idx" ON "credit_transaction" USING btree ("organization_id","created_at");