console.log("Users routes loaded");

import { Router } from "express";
import pool from "../db";
import { getUserByUsername } from "./users.controller";

import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// ─── BLOCK USER ──────────────────────────────────────────────
router.post("/:id/block", authMiddleware, async (req: AuthRequest, res) => {
  const blockerId = req.user?.id;
  const blockedId = req.params.id;

  if (!blockerId || !blockedId) {
    return res.status(400).json({ error: "Missing IDs" });
  }
  if (blockerId === blockedId) {
    return res.status(400).json({ error: "Cannot block yourself" });
  }

  try {
    // 1. Delete any existing friendship or pending request
    await pool.query(
      `DELETE FROM friends 
       WHERE (user_id1 = $1 AND user_id2 = $2) 
          OR (user_id1 = $2 AND user_id2 = $1)`,
      [blockerId, blockedId]
    );

    // 2. Insert into blocks
    await pool.query(
      `INSERT INTO blocks (blocker_id, blocked_id) 
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [blockerId, blockedId]
    );

    res.json({ message: "User blocked successfully" });
  } catch (err) {
    console.error("BLOCK ERROR:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

// ─── REPORT USER ─────────────────────────────────────────────
router.post("/:id/report", authMiddleware, async (req: AuthRequest, res) => {
  const reporterId = req.user?.id;
  const reportedId = req.params.id;
  const { reason } = req.body;

  if (!reporterId || !reportedId || !reason) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  try {
    await pool.query(
      `INSERT INTO reports (reporter_id, reported_id, reason) 
       VALUES ($1, $2, $3)`,
      [reporterId, reportedId, reason]
    );
    res.json({ message: "User reported successfully" });
  } catch (err) {
    console.error("REPORT ERROR:", err);
    res.status(500).json({ error: "Failed to report user" });
  }
});

/* 🔹 Discover people — search & filter */
router.get("/discover", async (req, res) => {
  const { search, college, year, interest, vibe } = req.query;

  // Optional: exclude the logged-in user
  let currentUserId: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const jwt = await import("jsonwebtoken");
      const decoded: any = jwt.default.verify(
        authHeader.split(" ")[1],
        process.env.JWT_SECRET as string
      );
      currentUserId = decoded.id;
    } catch {}
  }

  try {
    const conditions: string[] = ["is_verified = TRUE"];
    const values: any[] = [];
    let idx = 1;

    if (currentUserId) {
      // Exclusion of blocked users
      conditions.push(`u.id NOT IN (
        SELECT blocked_id FROM blocks WHERE blocker_id = $${idx}
        UNION
        SELECT blocker_id FROM blocks WHERE blocked_id = $${idx}
      )`);
      values.push(currentUserId);
      idx++;

      // Only exclude self and existing friends from general recommendations
      if (!search || (typeof search === "string" && !search.trim())) {
        // Exclude self
        conditions.push(`u.id != $${idx}`);
        values.push(currentUserId);
        idx++;

        // Exclude friends/requests
        conditions.push(`u.id NOT IN (
          SELECT user_id2 FROM friends WHERE user_id1 = $${idx}
          UNION
          SELECT user_id1 FROM friends WHERE user_id2 = $${idx}
        )`);
        values.push(currentUserId);
        idx++;
      }
    }

    if (search && typeof search === "string" && search.trim()) {
      conditions.push(`(u.name ILIKE $${idx} OR u.username ILIKE $${idx})`);
      values.push(`%${search.trim()}%`);
      idx++;
    }

    if (college && typeof college === "string" && college.trim()) {
      conditions.push(`u.college ILIKE $${idx}`);
      values.push(college.trim());
      idx++;
    }

    if (year && typeof year === "string" && year.trim()) {
      conditions.push(`u.year = $${idx}`);
      values.push(year.trim());
      idx++;
    }

    if (interest && typeof interest === "string" && interest.trim()) {
      conditions.push(`$${idx} = ANY(u.interests)`);
      values.push(interest.trim());
      idx++;
    }

    if (vibe && typeof vibe === "string" && vibe.trim()) {
      conditions.push(`$${idx} = ANY(u.vibe_tags)`);
      values.push(vibe.trim());
      idx++;
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // Always pass currentUserId as the last parameter to avoid $null syntax errors
    const queryArr = [...values, currentUserId];
    const mIdx = queryArr.length;

    const { rows } = await pool.query(
      `
      SELECT
        u.id, u.name, u.username, u.bio, u.college, u.year,
        u.interests, u.vibe_tags,
        CASE
          WHEN u.status_updated_at IS NOT NULL
            AND u.status_updated_at > NOW() - INTERVAL '24 hours'
          THEN u.current_status
          ELSE NULL
        END AS current_status,
        u.status_updated_at,
        u.friends_if, u.profile_pic,
        COALESCE((
          SELECT COUNT(*)
          FROM (
            SELECT user_id1 as f_id FROM friends WHERE user_id2 = u.id AND status = 'accepted'
            UNION
            SELECT user_id2 as f_id FROM friends WHERE user_id1 = u.id AND status = 'accepted'
          ) u_friends
          JOIN (
            SELECT user_id1 as f_id FROM friends WHERE user_id2 = $${mIdx} AND status = 'accepted'
            UNION
            SELECT user_id2 as f_id FROM friends WHERE user_id1 = $${mIdx} AND status = 'accepted'
          ) my_friends ON u_friends.f_id = my_friends.f_id
        ), 0) AS mutual_count
      FROM users u
      ${whereClause}
      ORDER BY 
        CASE WHEN $${mIdx} IS NOT NULL THEN (
          SELECT COUNT(*)
          FROM (
            SELECT user_id1 as f_id FROM friends WHERE user_id2 = u.id AND status = 'accepted'
            UNION
            SELECT user_id2 as f_id FROM friends WHERE user_id1 = u.id AND status = 'accepted'
          ) u_friends
          JOIN (
            SELECT user_id1 as f_id FROM friends WHERE user_id2 = $${mIdx} AND status = 'accepted'
            UNION
            SELECT user_id2 as f_id FROM friends WHERE user_id1 = $${mIdx} AND status = 'accepted'
          ) my_friends ON u_friends.f_id = my_friends.f_id
        ) ELSE 0 END DESC,
        u.created_at DESC NULLS LAST
      LIMIT 50
      `,
      queryArr
    );

    res.json(rows);
  } catch (err) {
    console.error("DISCOVER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* 🔹 Get user by username */
router.get("/:username", async (req, res) => {
  const { username } = req.params;

  // Optional auth to check for blocks
  let currentUserId: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const jwt = await import("jsonwebtoken");
      const decoded: any = jwt.default.verify(
        authHeader.split(" ")[1],
        process.env.JWT_SECRET as string
      );
      currentUserId = decoded.id;
    } catch {}
  }

  try {
    let blockCheck = "";
    const values: any[] = [username.toLowerCase()];
    if (currentUserId) {
      blockCheck = `AND id NOT IN (
        SELECT blocked_id FROM blocks WHERE blocker_id = $2
        UNION
        SELECT blocker_id FROM blocks WHERE blocked_id = $2
      )`;
      values.push(currentUserId);
    }

    const { rows } = await pool.query(
      `
      SELECT 
        id,
        name,
        username,
        bio,
        college,
        branch,
        year,
        interests,
        vibe_tags,
        CASE
          WHEN status_updated_at IS NOT NULL
            AND status_updated_at > NOW() - INTERVAL '24 hours'
          THEN current_status
          ELSE NULL
        END AS current_status,
        status_updated_at,
        friends_if,
        profile_pic,
        instagram,
        linkedin,
        is_private
      FROM users
      WHERE username = $1 ${blockCheck}
      `,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("GET USER ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* 🔹 Update own profile */
router.put("/:id", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const paramId = req.params.id;

  if (!userId || userId !== paramId) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const {
    username,
    bio,
    branch,
    year,
    interests,
    vibe_tags,
    current_status,
    friends_if,
    instagram,
    linkedin,
    profile_pic,
  } = req.body;

  try {
    const fields = [
      "username", "bio", "branch", "year", "interests", "vibe_tags",
      "current_status", "friends_if", "instagram", "linkedin", "profile_pic", "is_invisible"
    ];
    
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        let val = req.body[field];
        if (field === "username") val = val?.toLowerCase();
        if ((field === "interests" || field === "vibe_tags") && !val) val = [];
        
        updates.push(`${field} = $${idx}`);
        values.push(val);
        idx++;

        if (field === "current_status") {
          updates.push(`status_updated_at = CASE WHEN CAST($${idx-1} AS TEXT) IS NOT NULL AND CAST($${idx-1} AS TEXT) != '' THEN NOW() ELSE status_updated_at END`);
        }
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(userId);
    const query = `
      UPDATE users
      SET ${updates.join(", ")}
      WHERE id = $${idx}
      RETURNING *
    `;

    const { rows } = await pool.query(query, values);
    res.json(rows[0]);
  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

export default router;