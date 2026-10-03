function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function staffCredentialsEmail(input: {
  name: string;
  email: string;
  password: string;
  role: string;
  loginUrl: string;
}) {
  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const password = escapeHtml(input.password);
  const role = escapeHtml(input.role.charAt(0).toUpperCase() + input.role.slice(1));
  const loginUrl = escapeHtml(input.loginUrl);
  return {
    subject: "Your Safer Support account is ready",
    text: [
      `Hello ${input.name},`,
      "",
      "A Safer Support account has been created for you.",
      `Login: ${input.loginUrl}`,
      `Email: ${input.email}`,
      `Initial password: ${input.password}`,
      `Role: ${input.role}`,
      "",
      "Keep these credentials private and sign in only through the link above.",
      "",
      "Safer Support",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000000;font-family:Arial,Helvetica,sans-serif;color:#000000">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#000000">
    <tr><td align="center" style="padding:28px 14px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:5px">
        <tr><td align="center" style="padding:34px 28px 18px">
          <img src="https://media.saference.com/branding/safer-email-logo.png" width="560" alt="SAFER" style="display:block;width:100%;max-width:560px;height:auto;border:0">
        </td></tr>
        <tr><td style="padding:0 48px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#000000;border-radius:6px;color:#ffffff">
            <tr><td align="center" style="padding:18px 20px 4px;font-size:16px;line-height:24px">Safer Support account</td></tr>
            <tr><td align="center" style="padding:4px 20px 24px;font-size:26px;line-height:34px;font-weight:800">${role.toUpperCase()} ACCESS</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:36px 48px 10px">
          <h1 style="margin:0 0 12px;font-size:21px;line-height:28px;font-weight:800">Your login details</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:24px">Hello ${name}, your Safer Support account is ready.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;font-size:15px;line-height:23px">
            <tr><td valign="top" style="padding:7px 12px 7px 0">Email address</td><td valign="top" align="right" style="padding:7px 0 7px 12px;font-weight:700;word-break:break-all">${email}</td></tr>
            <tr><td valign="top" style="padding:7px 12px 7px 0">Initial password</td><td valign="top" align="right" style="padding:7px 0 7px 12px;font-family:Courier New,monospace;font-weight:700;word-break:break-all">${password}</td></tr>
            <tr><td valign="top" style="padding:7px 12px 7px 0">Role</td><td valign="top" align="right" style="padding:7px 0 7px 12px">${role}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 48px 10px">
          <h2 style="margin:0 0 18px;font-size:21px;line-height:28px;font-weight:800">Access Safer Support</h2>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;font-size:15px;line-height:23px">
            <tr><td valign="top" style="padding:7px 12px 14px 0;border-bottom:1px solid #c7c7c7">Login address</td><td valign="top" align="right" style="padding:7px 0 14px 12px;border-bottom:1px solid #c7c7c7"><a href="${loginUrl}" style="color:#000000;text-decoration:underline;font-weight:700">${loginUrl}</a></td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:25px 48px 0">
          <a href="${loginUrl}" style="display:block;padding:15px 22px;background:#000000;border-radius:5px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800">SIGN IN TO SAFER SUPPORT</a>
        </td></tr>
        <tr><td align="center" style="padding:34px 48px 10px">
          <h2 style="margin:0;font-size:19px;line-height:27px;font-weight:800">KEEP YOUR ACCOUNT SECURE</h2>
        </td></tr>
        <tr><td align="center" style="padding:10px 54px 34px;font-size:12px;line-height:19px">
          <p style="margin:0 0 20px">Keep these credentials private and sign in only through the link in this email. If the credentials are exposed, ask an administrator to resend your login details; this immediately invalidates the old password.</p>
          <p style="margin:0;color:#555555;font-size:14px;line-height:22px">If you did not expect this account, contact support at <a href="mailto:support@saference.com" style="color:#000000;text-decoration:underline">support@saference.com</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
