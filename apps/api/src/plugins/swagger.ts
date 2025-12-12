import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { FastifyInstance } from "fastify";

export const registerSwagger = async (server: FastifyInstance) => {
	await server.register(swagger, {
		openapi: {
			info: {
				title: "",
				description: "",
				version: "1.0.0",
			},
			servers: [{ url: "http://localhost:3001" }],
			tags: [
				{ name: "users", description: "User related endpoints" },
				{ name: "auth", description: "Auth related endpoints" },
				{ name: "health", description: "Health check endpoints" },
			],
		},
	});

	await server.register(swaggerUi, {
		routePrefix: "/docs",
		uiConfig: {
			docExpansion: "full",
			deepLinking: false,
		},
	});
};
