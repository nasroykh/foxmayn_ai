import { redis } from "../config/redis";
import { resolvePublicSite } from "../services/public-site.service";
import { clientIpFromHeaders, toPublicChatError } from "../utils/public_site";
import { enforcePublicChatLimits } from "../utils/public_rate_limit";
import { publicProcedure, requireCredits } from "./middleware";

/**
 * No sign-in: the site comes from the request's Host header (Caddy forwards it
 * unchanged). An unknown or disabled hostname is a 404. The context carries the
 * site and its organization; the chat runs as `site.userId`.
 */
export const publicSiteProcedure = publicProcedure.use(
	async ({ context, next }) => {
		const site = await resolvePublicSite(context.headers.get("host"));
		return next({
			context: { ...context, site, organizationId: site.organizationId },
		});
	},
);

/**
 * A public chat spends the site organization's credits: rate limits first
 * (fail closed when Redis is down), then the same credits gate as the signed-in
 * chat. Both run before the stream starts, so refusals keep their HTTP status.
 */
export const publicChatProcedure = publicSiteProcedure
	.use(async ({ next }) => {
		// Outermost: credit and cap refusals of the gate below reach a visitor as
		// one generic error. Errors while streaming are mapped in the route.
		try {
			return await next();
		} catch (error) {
			throw toPublicChatError(error);
		}
	})
	.use(async ({ context, next }) => {
		await enforcePublicChatLimits(
			redis,
			context.site.hostname,
			clientIpFromHeaders(context.headers),
		);
		return next();
	})
	.use(requireCredits);
