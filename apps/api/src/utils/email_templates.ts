export const INVITATION_EMAIL_HTML = (
	inviterName: string,
	organizationName: string,
	inviteLink: string
) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Organization Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e0e0e0;">
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h1 style="margin: 0 0 20px 0; font-size: 22px; font-weight: bold; color: #333333;">
                                You've been invited!
                            </h1>
                            <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 24px; color: #555555;">
                                <strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong>.
                            </p>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="background-color: #007BFF; border-radius: 6px;">
                                        <a href="${inviteLink}" style="display: inline-block; padding: 14px 28px; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px;">
                                            Accept Invitation
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 22px; color: #777777;">
                                This invitation will expire in 7 days.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
`;

export const OTP_EMAIL_HTML = (otp: string) => `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Your One-Time Password</title>
    <!--[if mso]>
    <noscript>
        <xml>
            <o:OfficeDocumentSettings>
                <o:PixelsPerInch>96</o:PixelsPerInch>
            </o:OfficeDocumentSettings>
        </xml>
    </noscript>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <!--[if mso]>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center">
                <tr>
                <td>
                <![endif]-->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e0e0e0;">
                    <tr>
                        <td style="padding: 40px 30px;">
                            <h1 style="margin: 0 0 20px 0; font-size: 22px; font-weight: bold; color: #333333; font-family: Arial, Helvetica, sans-serif;">
                                Your One-Time Password
                            </h1>
                            <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 24px; color: #555555; font-family: Arial, Helvetica, sans-serif;">
                                Use the code below to complete your sign-in:
                            </p>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="background-color: #f8f9fa; padding: 16px 32px; border-left: 4px solid #007BFF;">
                                        <span style="font-size: 32px; font-weight: bold; color: #007BFF; font-family: 'Courier New', monospace; letter-spacing: 4px;">
                                            ${otp}
                                        </span>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 22px; color: #777777; font-family: Arial, Helvetica, sans-serif;">
                                This code expires in 5 minutes. Do not share it with anyone.
                            </p>
                        </td>
                    </tr>
                </table>
                <!--[if mso]>
                </td>
                </tr>
                </table>
                <![endif]-->
            </td>
        </tr>
    </table>
</body>
</html>
`;
