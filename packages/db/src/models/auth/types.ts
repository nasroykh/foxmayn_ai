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
	apikey,
} from "./schema";

export const userSelectSchema = createSelectSchema(user);
export type User = z.infer<typeof userSelectSchema>;

export const userInsertSchema = createInsertSchema(user);
export type UserInsert = z.infer<typeof userInsertSchema>;

export const userUpdateSchema = createUpdateSchema(user);
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const accountSelectSchema = createSelectSchema(account);
export type Account = z.infer<typeof accountSelectSchema>;

export const accountInsertSchema = createInsertSchema(account);
export type AccountInsert = z.infer<typeof accountInsertSchema>;

export const accountUpdateSchema = createUpdateSchema(account);
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;

export const sessionSelectSchema = createSelectSchema(session);
export type Session = z.infer<typeof sessionSelectSchema>;

export const sessionInsertSchema = createInsertSchema(session);
export type SessionInsert = z.infer<typeof sessionInsertSchema>;

export const sessionUpdateSchema = createUpdateSchema(session);
export type SessionUpdate = z.infer<typeof sessionUpdateSchema>;

export const verificationSelectSchema = createSelectSchema(verification);
export type Verification = z.infer<typeof verificationSelectSchema>;

export const verificationInsertSchema = createInsertSchema(verification);
export type VerificationInsert = z.infer<typeof verificationInsertSchema>;

export const verificationUpdateSchema = createUpdateSchema(verification);
export type VerificationUpdate = z.infer<typeof verificationUpdateSchema>;

export const invitationSelectSchema = createSelectSchema(invitation);
export type Invitation = z.infer<typeof invitationSelectSchema>;

export const invitationInsertSchema = createInsertSchema(invitation);
export type InvitationInsert = z.infer<typeof invitationInsertSchema>;

export const invitationUpdateSchema = createUpdateSchema(invitation);
export type InvitationUpdate = z.infer<typeof invitationUpdateSchema>;

export const memberSelectSchema = createSelectSchema(member);
export type Member = z.infer<typeof memberSelectSchema>;

export const memberInsertSchema = createInsertSchema(member);
export type MemberInsert = z.infer<typeof memberInsertSchema>;

export const memberUpdateSchema = createUpdateSchema(member);
export type MemberUpdate = z.infer<typeof memberUpdateSchema>;

export const organizationSelectSchema = createSelectSchema(organization);
export type Organization = z.infer<typeof organizationSelectSchema>;

export const organizationInsertSchema = createInsertSchema(organization);
export type OrganizationInsert = z.infer<typeof organizationInsertSchema>;

export const organizationUpdateSchema = createUpdateSchema(organization);
export type OrganizationUpdate = z.infer<typeof organizationUpdateSchema>;

export const apiKeySelectSchema = createSelectSchema(apikey);
export type ApiKey = z.infer<typeof apiKeySelectSchema>;

export const apiKeyInsertSchema = createInsertSchema(apikey);
export type ApiKeyInsert = z.infer<typeof apiKeyInsertSchema>;

export const apiKeyUpdateSchema = createUpdateSchema(apikey);
export type ApiKeyUpdate = z.infer<typeof apiKeyUpdateSchema>;
