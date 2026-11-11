import { z } from "zod";
import { queryRAGStream } from "../../services/rag.service";
import { toPublicChatError, toPublicSources } from "../../utils/public_site";
import { getPublicSiteInfo } from "../../services/public-site.service";
import { publicChatProcedure, publicSiteProcedure } from "../public-middleware";
import { env } from "../../config/env";

export const PREFIX = env.API_V1_PREFIX as `/${string}`;

// Public chats keep a short history, sent by the browser. No `system` role.
export const PUBLIC_QUERY_MAX_CHARS = 1000;
export const PUBLIC_MESSAGES_MAX_COUNT = 10;
export const PUBLIC_MESSAGE_MAX_CHARS = 4000;

export const publicChatBodySchema = z.object({
	query: z.string().trim().min(1).max(PUBLIC_QUERY_MAX_CHARS),
	messages: z
		.array(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string().max(PUBLIC_MESSAGE_MAX_CHARS),
			}),
		)
		.max(PUBLIC_MESSAGES_MAX_COUNT)
		.optional(),
});

export const publicRoutes = {
	site: publicSiteProcedure
		.route({
			method: "GET",
			path: `${PREFIX}/public/site`,
			description:
				"The public site of the request's Host header: names and UI text only. 404 when there is none.",
		})
		.handler(async ({ context }) => getPublicSiteInfo(context.site)),

	chatStream: publicChatProcedure
		.route({
			method: "POST",
			path: `${PREFIX}/public/chat/stream`,
			description:
				"Streaming chat of the public site named by the Host header. Same events as /chat/query/stream, except `usage`. Nothing is stored; tools are not offered. Rate limited per IP and per site.",
		})
		.input(publicChatBodySchema)
		.handler(async function* ({ input, context }) {
			const { site } = context;

			// The site fixes the knowledge base, the user the chat runs as and the
			// organization billed; nothing comes from the request. Billing is the
			// shared reserve/settle path of queryRAGStream.
			const stream = queryRAGStream(input.query, {
				profileId: site.profileId,
				messages: input.messages ?? [],
				organizationId: site.organizationId,
				userId: site.userId,
				// Like a chat-only key: only documents explicitly in the profile
				strictProfile: true,
				disableTools: true,
				apiKeyId: null,
				apiKeyProfileId: null,
				conversation: {
					serverManaged: false,
					conversationId: null,
					profileId: site.profileId,
					userQuery: input.query,
				},
			});

			// Same events as the signed-in chat, except that `sources` are reduced to
			// what a visitor may see. A visitor that leaves closes this generator;
			// the finally then closes the stream so its billing still settles.
			try {
				let step = await stream.next();
				while (!step.done) {
					const event = step.value;
					// Token counts and cost are for the owner, not for visitors
					if (event.type !== "usage") {
						yield event.type === "sources"
							? { type: "sources" as const, data: toPublicSources(event.data) }
							: event;
					}
					step = await stream.next();
				}
				yield {
					type: "done" as const,
					data: { finishReason: step.value.finishReason },
				};
			} catch (error) {
				throw toPublicChatError(error);
			} finally {
				await stream.return(undefined as never);
			}
		}),
};
