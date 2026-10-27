/**
 * Mask an email address for logs: keeps the first character of the local part
 * and the domain, e.g. "jane.doe@example.com" -> "j***@example.com".
 */
export const maskEmail = (email: string | null | undefined): string => {
	if (!email) return "<none>";
	const at = email.lastIndexOf("@");
	if (at < 1) return "***";
	return `${email[0]}***${email.slice(at)}`;
};

export const maskEmails = (to: string | string[]): string =>
	(Array.isArray(to) ? to : [to]).map(maskEmail).join(", ");
