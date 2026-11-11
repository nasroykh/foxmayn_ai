/** True for the no-auth public site routes (OpenAPI path or RPC path). */
export const isPublicSitePath = (path: string): boolean =>
	/\/(rpc\/)?public\/(site|chat\/stream|chatStream)$/.test(path);
