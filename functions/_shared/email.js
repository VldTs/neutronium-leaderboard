/**
 * Email utilities using Resend API
 * https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Send an email via Resend
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} options.text - Plain text content (optional)
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} - Resend API response
 */
export async function sendEmail({ to, subject, html, text }, env) {
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'Neutronium <noreply@resend.dev>',
      to: [to],
      subject,
      html,
      text,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Resend API error:', JSON.stringify(data));
    throw new Error(data.message || data.error?.message || 'Failed to send email');
  }

  return data;
}

/**
 * Generate a cryptographically secure random token
 * @param {number} length - Token length in bytes (will be hex encoded, so final length is 2x)
 * @returns {string} - Hex-encoded token
 */
export function generateToken(length = 32) {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Send a magic link email for authentication
 * @param {string} email - Recipient email
 * @param {string} token - Magic link token
 * @param {Object} env - Environment variables
 * @returns {Promise<Object>} - Resend API response
 */
export async function sendMagicLinkEmail(email, token, env) {
  const appUrl = env.APP_URL || 'http://localhost:8788';
  const magicLink = `${appUrl}/api/auth/verify?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to Neutronium</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a1a; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 480px; width: 100%; border-collapse: collapse;">
          <!-- Logo/Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <h1 style="margin: 0; font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 700; color: #00f0ff; letter-spacing: 2px;">
                NEUTRONIUM
              </h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #8892b0; letter-spacing: 1px;">
                LEADERBOARD
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px 32px; border: 1px solid rgba(0, 240, 255, 0.2);">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #e6f1ff;">
                Sign in to your account
              </h2>
              <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #8892b0;">
                Click the button below to securely sign in to Neutronium Leaderboard. This link will expire in 15 minutes.
              </p>

              <!-- CTA Button -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 8px 0 24px;">
                    <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #00f0ff 0%, #0080ff 100%); color: #0a0a1a; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; letter-spacing: 0.5px;">
                      Sign In
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #5a6a8a;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; word-break: break-all; color: #00f0ff;">
                ${magicLink}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <p style="margin: 0; font-size: 12px; color: #5a6a8a;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
Sign in to Neutronium Leaderboard

Click the link below to sign in (expires in 15 minutes):
${magicLink}

If you didn't request this email, you can safely ignore it.
  `.trim();

  return sendEmail({
    to: email,
    subject: 'Sign in to Neutronium Leaderboard',
    html,
    text,
  }, env);
}