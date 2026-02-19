import { transporter } from "../config/nodemailer";
import {
	OTP_EMAIL_HTML,
	INVITATION_EMAIL_HTML,
} from "../utils/email_templates";

export const sendOTPEmail = async (to: string, otp: string) => {
	const mailOptions = {
		to,
		subject: "Your One-Time Password (OTP)",
		html: OTP_EMAIL_HTML(otp),
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`OTP email sent to ${to}`);
	} catch (error) {
		console.error(`Error sending OTP email to ${to}:`, error);
		throw new Error("Failed to send OTP email");
	}
};

export const sendInvitationEmail = async (
	to: string,
	inviterName: string,
	organizationName: string,
	inviteLink: string
) => {
	const mailOptions = {
		to,
		subject: `You've been invited to join ${organizationName}`,
		html: INVITATION_EMAIL_HTML(inviterName, organizationName, inviteLink),
	};

	try {
		await transporter.sendMail(mailOptions);
		console.log(`Invitation email sent to ${to}`);
	} catch (error) {
		console.error(`Error sending invitation email to ${to}:`, error);
		throw new Error("Failed to send invitation email");
	}
};
