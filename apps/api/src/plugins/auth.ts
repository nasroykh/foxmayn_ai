import { Hono } from "hono";

import { auth } from "../config/auth";
import { env } from "../config/env";

export const registerAuth = (app: Hono) => {
	app.on(["POST", "GET"], `/auth/*`, (c) => {
		return auth.handler(c.req.raw);
	});
};
