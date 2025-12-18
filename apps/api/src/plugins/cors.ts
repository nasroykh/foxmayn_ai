import type { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../config/env";

export const registerCors = (app: Hono) => {
	app.use(
		"*",
		cors({
			origin: [env.APP_URL],
			allowHeaders: ["Content-Type", "Authorization"],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			exposeHeaders: ["Content-Length"],
			credentials: true,
			maxAge: 600,
		})
	);
};
