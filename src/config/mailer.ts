export const sendOTPEmail = async (to: string, otp: string) => {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is not set in environment variables");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: "CampusConnect",
        email: process.env.EMAIL_USER, // The Gmail address you verified in Brevo
      },
      to: [{ email: to }],
      subject: "Verify your CampusConnect account",
      htmlContent: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #1d4ed8;">CampusConnect</h2>
          <p>Your verification code is:</p>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1d4ed8; padding: 20px 0;">
            ${otp}
          </div>
          <p style="color: #666;">This code expires in <strong>10 minutes</strong>.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to send email via Brevo");
  }
};