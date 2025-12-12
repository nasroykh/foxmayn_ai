import { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";

export const registerWS = async (server: FastifyInstance) => {
	await server.register(websocket);
};
