import { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

const HealthResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

export const registerHealthRoutes = (server: FastifyInstance) => {
	server.withTypeProvider<ZodTypeProvider>().get("/health", {
		schema: {
			response: {
				200: HealthResponseSchema,
			},
		},
		handler: () => {
			return { success: true, message: "OK" };
		},
	});
};
