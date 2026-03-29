import { Router } from "express";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// Ensure the friends table exists
const initFriendsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_id1 UUID REFERENCES users(id) ON DELETE CASCADE,
        user_id2 UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending', -- 'pending' or 'accepted'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id1, user_id2)
      );
    `);
    console.log("Friends table verified/created");
  } catch (err) {
    console.error("Failed to initialize friends table:", err);
  }
};
initFriendsTable();

// ─── SEND FRIEND REQUEST ────────────────────────────
router.post("/request/:userId", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;
  const targetUserId = req.params.userId;

  if (!currentUserId || !targetUserId) {
    return res.status(400).json({ error: "Missing user IDs" });
  }

  if (currentUserId === targetUserId) {
    return res.status(400).json({ error: "Cannot add yourself" });
  }

  try {
    // Check if a relationship already exists in either direction
    const checkQuery = await pool.query(
      `SELECT * FROM friends 
       WHERE (user_id1 = $1 AND user_id2 = $2) 
          OR (user_id1 = $2 AND user_id2 = $1)`,
      [currentUserId, targetUserId]
    );

    if (checkQuery.rows.length > 0) {
      const rel = checkQuery.rows[0];
      if (rel.status === "accepted") {
        return res.status(400).json({ error: "Already friends" });
      }
      if (rel.user_id1 === currentUserId) {
        return res.status(400).json({ error: "Request already sent" });
      } else {
        return res.status(400).json({ error: "They already sent you a request, please accept it." });
      }
    }

    // Insert the new pending request
    const { rows } = await pool.query(
      `INSERT INTO friends (user_id1, user_id2, status) 
       VALUES ($1, $2, 'pending') RETURNING *`,
      [currentUserId, targetUserId]
    );

    res.json({ message: "Friend request sent", request: rows[0] });
  } catch (err) {
    console.error("ADD FRIEND ERROR:", err);
    res.status(500).json({ error: "Failed to send friend request" });
  }
});

// ─── ACCEPT FRIEND REQUEST ──────────────────────────
router.post("/accept/:userId", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id; // the one accepting
  const requesterId = req.params.userId; // the one who sent it

  if (!currentUserId || !requesterId) {
    return res.status(400).json({ error: "Missing user IDs" });
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE friends SET status = 'accepted' 
       WHERE user_id1 = $1 AND user_id2 = $2 AND status = 'pending'`,
      [requesterId, currentUserId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: "No pending request found" });
    }

    // Insert a notification for the person who originally sent the request
    await pool.query(
      `INSERT INTO notifications (user_id, sender_id, type)
       VALUES ($1, $2, 'friend_accepted')`,
      [requesterId, currentUserId]
    );

    res.json({ message: "Friend request accepted" });
  } catch (err) {
    console.error("ACCEPT FRIEND ERROR:", err);
    res.status(500).json({ error: "Failed to accept friend request" });
  }
});

// ─── REJECT/REMOVE FRIEND ───────────────────────────
router.delete("/remove/:userId", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;
  const targetUserId = req.params.userId;

  if (!currentUserId || !targetUserId) {
    return res.status(400).json({ error: "Missing user IDs" });
  }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM friends 
       WHERE (user_id1 = $1 AND user_id2 = $2) 
          OR (user_id1 = $2 AND user_id2 = $1)`,
      [currentUserId, targetUserId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: "Friendship/request not found" });
    }

    res.json({ message: "Friend removed/request cancelled" });
  } catch (err) {
    console.error("REMOVE FRIEND ERROR:", err);
    res.status(500).json({ error: "Failed to remove friend" });
  }
});

// ─── GET PENDING REQUESTS (Incoming) ────────────────
router.get("/pending", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;

  if (!currentUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get users who sent a request to the current user
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.username, u.profile_pic, u.college, u.year, f.created_at
       FROM friends f
       JOIN users u ON f.user_id1 = u.id
       WHERE f.user_id2 = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [currentUserId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET PENDING ERROR:", err);
    res.status(500).json({ error: "Failed to load pending requests" });
  }
});

// ─── GET ACCEPTED FRIENDS ───────────────────────────
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;

  if (!currentUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT 
         u.id, 
         u.name, 
         u.username, 
         u.profile_pic,
         u.college,
         u.year,
         u.bio,
         u.vibe_tags,
         u.current_status,
         u.interests,
         CASE
           WHEN u.status_updated_at IS NOT NULL
             AND u.status_updated_at > NOW() - INTERVAL '24 hours'
           THEN TRUE
           ELSE FALSE
         END AS online
       FROM friends f
       JOIN users u ON (f.user_id1 = u.id OR f.user_id2 = u.id)
       WHERE (f.user_id1 = $1 OR f.user_id2 = $1)
         AND f.status = 'accepted'
         AND u.id != $1
       ORDER BY online DESC, u.name ASC`,
      [currentUserId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET FRIENDS ERROR:", err);
    res.status(500).json({ error: "Failed to load friends" });
  }
});

// ─── CHECK FRIENDSHIP STATUS (For Profile Page) ─────
router.get("/status/:targetUserId", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;
  const targetUserId = req.params.targetUserId;

  if (!currentUserId || !targetUserId) {
    return res.json({ status: "none" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id1, user_id2, status FROM friends 
       WHERE (user_id1 = $1 AND user_id2 = $2) 
          OR (user_id1 = $2 AND user_id2 = $1)`,
      [currentUserId, targetUserId]
    );

    if (rows.length === 0) {
      return res.json({ status: "none" });
    }

    const rel = rows[0];
    if (rel.status === "accepted") {
      return res.json({ status: "friends" });
    }
    
    // Status is pending
    if (rel.user_id1 === currentUserId) {
      return res.json({ status: "request_sent" });
    } else {
      return res.json({ status: "request_received" });
    }

  } catch (err) {
    console.error("CHECK STATUS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
