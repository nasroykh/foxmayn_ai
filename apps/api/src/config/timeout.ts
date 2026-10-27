/**
 * Reject if `promise` does not settle within `ms`. The underlying work is not
 * cancelled; callers use this to bound how long they wait on it.
 */
export const withTimeout = <T>(
	promise: Promise<T>,
	ms: number,
	label = "operation",
): Promise<T> => {
	let timer: NodeJS.Timeout;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} timed out after ${ms}ms`)),
			ms,
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
