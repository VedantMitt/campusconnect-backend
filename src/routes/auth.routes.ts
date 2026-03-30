import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../db";
import { sendOTPEmail } from "../config/mailer";
import { OAuth2Client } from "google-auth-library";

const router = Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Helpers ────────────────────────────────────────
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Sanitize string inputs — strip HTML/script tags
const sanitize = (str: string) =>
  str.replace(/[<>"'`;(){}]/g, "").trim();

// Validate college email domains
const COLLEGE_EMAIL_PATTERNS = [
  /\.edu$/i,
  /\.edu\.[a-z]{2,}$/i,    // .edu.in, .edu.au, etc.
  /\.ac\.[a-z]{2,}$/i,     // .ac.in, .ac.uk, .ac.au, etc.
];

const isCollegeEmail = (email: string): boolean => {
  const domain = email.split("@")[1];
  if (!domain) return false;
  return COLLEGE_EMAIL_PATTERNS.some(pattern => pattern.test(domain));
};

// ─── GOOGLE AUTH ────────────────────────────────────
router.post("/google", async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ error: "Google credential missing" });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.status(400).json({ error: "Invalid Google token" });
    }

    const { email, name, picture } = payload;
    const cleanEmail = email.toLowerCase().trim();

    // Check if user already exists
    const result = await pool.query(
      "SELECT id, name, email, username, college, year, profile_pic FROM users WHERE email = $1",
      [cleanEmail]
    );

    let user;
    let isNewUser = false;

    if (result.rows.length > 0) {
      user = result.rows[0];
    } else {
      // Create a skeleton user for social login
      const college = cleanEmail.includes(".edu") 
        ? cleanEmail.split("@")[1].split(".")[0].toUpperCase() 
        : "UNKNOWN";

      const insertResult = await pool.query(
        `INSERT INTO users (name, email, profile_pic, college, is_verified)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, name, email, username, college, year, profile_pic`,
        [name, cleanEmail, picture, college]
      );
      user = insertResult.rows[0];
      isNewUser = true;
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    // If username or year is missing, tell the frontend to prompt for details
    const needsCompletion = !user.username || !user.year;

    res.json({ 
      token, 
      user, 
      isNewUser, 
      needsCompletion 
    });
  } catch (err: any) {
    console.error("GOOGLE AUTH ERROR:", err.message);
    res.status(500).json({ error: "Google Authentication failed" });
  }
});

// ─── COMPLETE REGISTRATION ──────────────────────────
router.post("/complete-registration", async (req, res) => {
  const { userId, username, year } = req.body;

  if (!userId || !username || !year) {
    return res.status(400).json({ error: "All fields required" });
  }

  const cleanUsername = sanitize(username).toLowerCase().replace(/[^a-z0-9._-]/g, "");

  try {
    // Check if username is taken
    const usernameCheck = await pool.query(
      "SELECT id FROM users WHERE username = $1 AND id != $2",
      [cleanUsername, userId]
    );

    if (usernameCheck.rows.length > 0) {
      return res.status(400).json({ error: "Username already taken" });
    }

    const result = await pool.query(
      "UPDATE users SET username = $1, year = $2 WHERE id = $3 RETURNING id, name, email, username, college, year, profile_pic",
      [cleanUsername, year, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // Generate JWT so the user is logged in immediately
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.json({ message: "Registration completed", token, user });
  } catch (err: any) {
    console.error("COMPLETE REGISTRATION ERROR:", err.message);
    res.status(500).json({ error: "Failed to complete registration" });
  }
});

// ─── REGISTER ───────────────────────────────────────
router.post("/register", async (req, res) => {
  const { name, email, username, password, year } = req.body;

  if (!name || !email || !username || !password || !year) {
    return res.status(400).json({ error: "All fields required" });
  }

  // Sanitize inputs
  const cleanName = sanitize(name);
  const cleanUsername = sanitize(username).toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const cleanEmail = email.toLowerCase().trim();

  // Validate college email
  if (!isCollegeEmail(cleanEmail)) {
    return res.status(400).json({
      error: "Only college/university emails are allowed (e.g. .edu, .edu.in, .ac.in, .ac.au)"
    });
  }

  // Username validation
  if (cleanUsername.length < 3 || cleanUsername.length > 30) {
    return res.status(400).json({ error: "Username must be 3-30 characters" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    // Check if email already exists and is verified
    const existing = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (existing.rows.length > 0 && existing.rows[0].is_verified) {
      return res.status(400).json({ error: "Email already registered. Please login." });
    }

    // Check if username is taken by a different verified user
    const usernameCheck = await pool.query(
      "SELECT id, email FROM users WHERE username = $1",
      [cleanUsername]
    );

    if (
      usernameCheck.rows.length > 0 &&
      usernameCheck.rows[0].email !== cleanEmail
    ) {
      return res.status(400).json({ error: "Username already taken" });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    const college = cleanEmail.split("@")[1].split(".")[0].toUpperCase();

    if (existing.rows.length > 0) {
      // Update existing unverified user
      await pool.query(
        `UPDATE users SET name=$1, username=$2, password_hash=$3, college=$4, year=$5
         WHERE email=$6`,
        [cleanName, cleanUsername, password_hash, college, year, cleanEmail]
      );
    } else {
      // Create new unverified user
      await pool.query(
        `INSERT INTO users (name, email, username, password_hash, college, year, is_verified)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
        [cleanName, cleanEmail, cleanUsername, password_hash, college, year]
      );
    }

    // Delete old OTPs for this email
    await pool.query("DELETE FROM otp_codes WHERE email = $1", [cleanEmail]);

    // Generate & store OTP (10 min expiry)
    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [cleanEmail, otp, expires_at]
    );

    // Send OTP email in background
    sendOTPEmail(cleanEmail, otp).catch((emailErr: any) => {
      console.error("BACKGROUND EMAIL SEND ERROR:", emailErr.message);
    });

    res.status(200).json({ message: "OTP sent to your email", email: cleanEmail });
  } catch (err: any) {
    console.error("REGISTER ERROR:", err.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ─── VERIFY OTP ─────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP required" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM otp_codes WHERE email = $1 AND code = $2`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    const record = result.rows[0];

    if (new Date() > new Date(record.expires_at)) {
      return res
        .status(400)
        .json({ error: "OTP expired. Please register again." });
    }

    // Mark user as verified
    const userResult = await pool.query(
      `UPDATE users SET is_verified = TRUE WHERE email = $1
       RETURNING id, name, email, username, college`,
      [email]
    );

    // Delete used OTP
    await pool.query("DELETE FROM otp_codes WHERE email = $1", [email]);

    const user = userResult.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.json({ token, user });
  } catch (err: any) {
    console.error("VERIFY OTP ERROR:", err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ─── LOGIN ──────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: "Username/email and password required" });
  }

  try {
    // Try finding by email or username
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [identifier.toLowerCase(), identifier.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "No account found" });
    }

    const user = result.rows[0];

    if (!user.is_verified) {
      return res
        .status(400)
        .json({ error: "Email not verified. Please register first." });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Incorrect password" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
      },
    });
  } catch (err: any) {
    console.error("LOGIN ERROR:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─── FORGOT PASSWORD ────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND is_verified = TRUE",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "No verified account found with this email" });
    }

    // Delete old OTPs
    await pool.query("DELETE FROM otp_codes WHERE email = $1", [email]);

    // Generate & store OTP
    const otp = generateOTP();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, otp, expires_at]
    );

    // Send OTP email in background
    sendOTPEmail(email, otp).catch((emailErr: any) => {
      console.error("BACKGROUND EMAIL SEND ERROR FORGOT PASSWORD:", emailErr.message);
    });

    res.json({ message: "OTP sent to your email", email });
  } catch (err: any) {
    console.error("FORGOT PASSWORD ERROR:", err.message);
    res.status(500).json({ error: "Failed to send reset OTP" });
  }
});

// ─── RESET PASSWORD ─────────────────────────────────
router.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: "All fields required" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const result = await pool.query(
      `SELECT * FROM otp_codes WHERE email = $1 AND code = $2`,
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > new Date(result.rows[0].expires_at)) {
      return res.status(400).json({ error: "OTP expired" });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [
      password_hash,
      email,
    ]);

    await pool.query("DELETE FROM otp_codes WHERE email = $1", [email]);

    res.json({ message: "Password reset successful. You can now sign in." });
  } catch (err: any) {
    console.error("RESET PASSWORD ERROR:", err.message);
    res.status(500).json({ error: "Password reset failed" });
  }
});

export default router;
