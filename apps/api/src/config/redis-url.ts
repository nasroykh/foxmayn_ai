export type ParsedRedisUrl = {
	host: string;
	port: number;
	username?: string;
	password?: string;
	db?: number;
	tls?: { servername: string };
};

/**
 * Split a redis:// or rediss:// URL into ioredis connection options, keeping
 * username, password, db index and TLS (which the host/port-only parsing lost).
 */
export const parseRedisUrl = (urlString: string): ParsedRedisUrl => {
	const url = new URL(urlString);
	if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
		throw new Error(`Unsupported Redis URL protocol: ${url.protocol}`);
	}

	const host = url.hostname.replace(/^\[|\]$/g, "");
	const dbIndex = Number.parseInt(url.pathname.replace(/^\//, ""), 10);

	return {
		host,
		port: url.port ? Number.parseInt(url.port, 10) : 6379,
		username: url.username ? decodeURIComponent(url.username) : undefined,
		password: url.password ? decodeURIComponent(url.password) : undefined,
		db: Number.isNaN(dbIndex) ? undefined : dbIndex,
		tls: url.protocol === "rediss:" ? { servername: host } : undefined,
	};
};
