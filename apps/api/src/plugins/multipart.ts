import multipart from "@fastify/multipart";
import { FastifyInstance } from "fastify";

export const registerMultipart = async (server: FastifyInstance) => {
	await server.register(multipart, {
		limits: {
			fileSize: 10 * 1024 * 1024, // 10MB max file size
			files: 1, // 1 file at a time
		},
	});
};
