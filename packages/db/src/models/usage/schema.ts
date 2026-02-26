import { relations } from "drizzle-orm";
import {
	pgTable,
	text,
	timestamp,
	integer,
	real,
	jsonb,
	pgEnum,
	index,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth/schema";

// Enums
export const operationTypeEnum = pgEnum("operation_type", [
	"chat",
	"embedding",
]);

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
	"topup",
	"usage",
	"refund",
	"adjustment",
]);

// AI Usage Log - every AI API call gets a row
export const aiUsageLog = pgTable(
	"ai_usage_log",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		operationType: operationTypeEnum("operation_type").notNull(),
		model: text("model").notNull(),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
		totalTokens: integer("total_tokens").notNull().default(0),
		costCredits: real("cost_credits").notNull().default(0),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("ai_usage_log_orgId_idx").on(table.organizationId),
		index("ai_usage_log_userId_idx").on(table.userId),
		index("ai_usage_log_createdAt_idx").on(table.createdAt),
		index("ai_usage_log_operationType_idx").on(table.operationType),
	],
);

// Credit Transaction - audit log for every credit balance change
export const creditTransaction = pgTable(
	"credit_transaction",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: creditTransactionTypeEnum("type").notNull(),
		amount: real("amount").notNull(), // positive for additions, negative for deductions
		balanceAfter: real("balance_after").notNull(),
		description: text("description").notNull(),
		referenceId: text("reference_id"), // links to ai_usage_log.id or Stripe payment ID
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("credit_tx_orgId_idx").on(table.organizationId),
		index("credit_tx_createdAt_idx").on(table.createdAt),
	],
);

// Relations
export const aiUsageLogRelations = relations(aiUsageLog, ({ one }) => ({
	organization: one(organization, {
		fields: [aiUsageLog.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [aiUsageLog.userId],
		references: [user.id],
	}),
}));

export const creditTransactionRelations = relations(
	creditTransaction,
	({ one }) => ({
		organization: one(organization, {
			fields: [creditTransaction.organizationId],
			references: [organization.id],
		}),
		createdByUser: one(user, {
			fields: [creditTransaction.createdBy],
			references: [user.id],
		}),
	}),
);
