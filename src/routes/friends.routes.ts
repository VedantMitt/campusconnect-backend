import { Router } from "express";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

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
          u.status_updated_at,
          u.interests,
          CASE
            WHEN u.status_updated_at IS NOT NULL
              AND u.status_updated_at > NOW() - INTERVAL '24 hours'
            THEN TRUE
           ELSE FALSE
          END AS online,
          u.is_invisible,
          (
            SELECT CASE WHEN u.is_invisible THEN NULL ELSE json_agg(json_build_object('id', r.id, 'name', r.name)) END
            FROM rooms r
            JOIN room_members rm ON rm.room_id = r.id
            WHERE rm.user_id = u.id AND rm.status = 'approved'
          ) as active_rooms,
          (
            SELECT CASE WHEN u.is_invisible THEN NULL ELSE json_agg(json_build_object('id', p.id, 'title', p.title)) END
            FROM dm_roulette_pools p
            JOIN dm_roulette_entries e ON e.pool_id = p.id
            WHERE e.user_id = u.id AND p.status = 'open'
          ) as active_pools,
          (
            SELECT CASE WHEN u.is_invisible THEN NULL ELSE json_agg(json_build_object('id', g.id, 'title', g.title)) END
            FROM gtl_games g
            JOIN gtl_members m ON m.game_id = g.id
            WHERE m.user_id = u.id AND g.status != 'finished' AND m.status = 'approved'
          ) as active_gtl,
          (
            SELECT CASE WHEN u.is_invisible THEN NULL ELSE json_agg(json_build_object('id', a.id, 'title', a.title)) END
            FROM activities a
            JOIN activity_members am ON am.activity_id = a.id
            WHERE am.user_id = u.id AND a.deleted_at IS NULL AND a.date > NOW() - INTERVAL '12 hours'
          ) as active_activities
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
