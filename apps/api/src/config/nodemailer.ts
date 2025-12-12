import nodemailer from "nodemailer";

const getSMTPEnvConfig = () => {
	const SMTP_HOST = process.env.SMTP_HOST;
	const SMTP_PORT = process.env.SMTP_PORT;
	const SMTP_USER = process.env.SMTP_USER;
	const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
	const SMTP_FROM = process.env.SMTP_FROM;

	if (!SMTP_HOST) {
		throw new Error("SMTP_HOST is not set");
	}
	if (!SMTP_PORT) {
		throw new Error("SMTP_PORT is not set");
	}
	if (!SMTP_USER) {
		throw new Error("SMTP_USER is not set");
	}
	if (!SMTP_PASSWORD) {
		throw new Error("SMTP_PASSWORD is not set");
	}
	if (!SMTP_FROM) {
		throw new Error("SMTP_FROM is not set");
	}
	return {
		SMTP_HOST,
		SMTP_PORT,
		SMTP_USER,
		SMTP_PASSWORD,
		SMTP_FROM,
	};
};

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } =
	getSMTPEnvConfig();

export const transporter = nodemailer.createTransport({
	host: SMTP_HOST,
	port: +SMTP_PORT,
	auth: {
		user: SMTP_USER,
		pass: SMTP_PASSWORD,
	},
	from: SMTP_FROM,
});
