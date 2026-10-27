/**
 * First instant (00:00:00.000 UTC) of the UTC calendar month containing `now`.
 * The monthly spending cap resets at this boundary.
 */
export function startOfUtcMonth(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
