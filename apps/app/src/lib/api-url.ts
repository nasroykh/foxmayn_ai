/**
 * Base URL of the API. Same-origin by default (`/api/v1`): in production the
 * reverse proxy forwards it, in dev the Vite proxy does. Always returned
 * absolute because the better-auth client and fetch links need a full origin.
 */
const configured = import.meta.env.VITE_API_URL || "/api/v1";

export const API_URL: string = new URL(
	configured,
	window.location.origin,
).toString().replace(/\/+$/, "");
