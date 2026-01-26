import { Router } from "express";
import jwt from "jsonwebtoken";
import pool from "../db";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const college = email.split("@")[1]; // REQUIRED by schema

    const result = await pool.query(
      `
      insert into users (name, email, college)
      values ($1, $2, $3)
      on conflict (email)
      do update set name = excluded.name
      returning id, name, email, college
      `,
      [name, email, college]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id },   // UUID SAFE
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.json({ token, user });
  } catch (err: any) {
    console.error("REGISTER ERROR:", err.message);
    res.status(500).json({
      error: "Internal server error",
      message: err.message
    });
  }
});

export default router;
