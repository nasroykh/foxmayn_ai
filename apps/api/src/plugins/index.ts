import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { registerCors } from "./cors";
import { registerORPC } from "./orpc";
import { registerORPCOpenAPI } from "./orpc-openapi";
import { registerScalar } from "./scalar";
import { registerAuth } from "./auth";
import { registerBullBoard } from "./bull-board";

// 10MB upload cap (see MAX_FILE_SIZE) plus 1MB for multipart framing and form fields
const MAX_REQUEST_BODY_SIZE = 11 * 1024 * 1024;

export const registerPlugins = (app: Hono) => {
	registerCors(app);
	app.use(
		"*",
		bodyLimit({
			maxSize: MAX_REQUEST_BODY_SIZE,
			onError: (c) => c.json({ message: "Request body too large" }, 413),
		}),
	);
	registerORPC(app);
	registerORPCOpenAPI(app);
	registerScalar(app);
	registerAuth(app);
	registerBullBoard(app);
};
