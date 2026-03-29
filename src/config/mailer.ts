import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password
  },
});

export const sendOTPEmail = async (to: string, otp: string) => {
  await transporter.sendMail({
    from: `"CampusConnect" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Verify your CampusConnect account",
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
        <h2 style="color: #1d4ed8;">CampusConnect</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1d4ed8; padding: 20px 0;">
          ${otp}
        </div>
        <p style="color: #666;">This code expires in <strong>10 minutes</strong>.</p>
      </div>
    `,
  });
};