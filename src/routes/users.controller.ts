import { Request, Response } from "express";

import pool from "../db";

export const getUserByUsername = async (req: Request, res: Response) => {
  const { username } = req.params;

  console.log("USERNAME RECEIVED:", username);

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("DB ERROR:", err);
    return res.status(500).json({ message: "Server error" });
  }
};