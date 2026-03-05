import { z } from "zod";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { aiUsageLog, creditTransaction } from "./schema";

// AI Usage Log schemas
export const aiUsageLogSelectSchema = createSelectSchema(aiUsageLog);
export type AiUsageLog = z.infer<typeof aiUsageLogSelectSchema>;

export const aiUsageLogInsertSchema = createInsertSchema(aiUsageLog);
export type AiUsageLogInsert = z.infer<typeof aiUsageLogInsertSchema>;

// Credit Transaction schemas
export const creditTransactionSelectSchema =
	createSelectSchema(creditTransaction);
export type CreditTransaction = z.infer<typeof creditTransactionSelectSchema>;

export const creditTransactionInsertSchema =
	createInsertSchema(creditTransaction);
export type CreditTransactionInsert = z.infer<
	typeof creditTransactionInsertSchema
>;
