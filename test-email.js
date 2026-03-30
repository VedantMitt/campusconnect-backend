require("dotenv").config();
const nodemailer = require("nodemailer");

console.log("USER:", process.env.EMAIL_USER);
console.log("PASS:", process.env.EMAIL_PASS);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function run() {
  try {
    let info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: "Test Mail",
      text: "This is a test",
    });
    console.log("SUCCESS:", info.messageId);
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

run();
