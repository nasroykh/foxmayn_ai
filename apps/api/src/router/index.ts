import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { userRoutes } from "./routes/user";

export const router = {
	user: userRoutes,
};

export type AppRouter = typeof router;

const generator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
});

generator
	.generate(router, {
		info: {
			title: "App Template API",
			version: "1.0.0",
		},
	})
	.then((spec) => console.log(JSON.stringify(spec, null, 2)))
	.catch((error) => console.error(error));
