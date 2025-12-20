import { Hono } from "hono";

import { registerCors } from "./cors";
import { registerORPC } from "./orpc";
import { registerORPCOpenAPI } from "./orpc-openapi";
import { registerScalar } from "./scalar";
import { registerBullBoard } from "./bull-board";
import { registerAuth } from "./auth";

export const registerPlugins = (app: Hono) => {
	registerCors(app);
	registerORPC(app);
	registerORPCOpenAPI(app);
	registerScalar(app);
	registerAuth(app);
	registerBullBoard(app);
};
