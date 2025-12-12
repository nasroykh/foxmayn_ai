import { z } from "zod";
import {
	createInsertSchema,
	createSelectSchema,
	createUpdateSchema,
} from "drizzle-zod";
import {
	user,
	account,
	session,
	verification,
	invitation,
	member,
	organization,
} from "./schema";

export const userSelectSchema = createSelectSchema(user);
export type User = z.infer<typeof userSelectSchema>;

export const accountSelectSchema = createSelectSchema(account);
export type Account = z.infer<typeof accountSelectSchema>;

export const sessionSelectSchema = createSelectSchema(session);
export type Session = z.infer<typeof sessionSelectSchema>;

export const verificationSelectSchema = createSelectSchema(verification);
export type Verification = z.infer<typeof verificationSelectSchema>;

export const invitationSelectSchema = createSelectSchema(invitation);
export type Invitation = z.infer<typeof invitationSelectSchema>;

export const memberSelectSchema = createSelectSchema(member);
export type Member = z.infer<typeof memberSelectSchema>;

export const organizationSelectSchema = createSelectSchema(organization);
export type Organization = z.infer<typeof organizationSelectSchema>;
