import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { OpenAPIGenerator } from "@orpc/openapi";
import { router } from "../router";
import { env } from "../config/env";

const specEndpoint = `/spec.json`;

export const registerScalar = (app: Hono) => {
	app.get(specEndpoint, async (c) => {
		const generator = new OpenAPIGenerator({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		});

		const spec = await generator.generate(router, {
			info: {
				title: "Foxmayn AI API",
				version: "0.0.0",
			},
		});

		return c.json(spec);
	});

	app.get(
		`/scalar`,
		Scalar({
			url: `${env.API_V1_PREFIX}${specEndpoint}`,
		})
	);
};
