import { Router } from "express";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// ─── GET UNREAD NOTIFICATIONS ────────────────────────
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;

  if (!currentUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.type, n.metadata, n.is_read, n.created_at, u.name, u.username, u.profile_pic, u.college, u.year
       FROM notifications n
       JOIN users u ON n.sender_id = u.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 10`,
      [currentUserId]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET NOTIFICATIONS ERROR:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// ─── MARK NOTIFICATION AS READ ───────────────────────
router.put("/:id/read", authMiddleware, async (req: AuthRequest, res) => {
  const currentUserId = req.user?.id;
  const notifId = req.params.id;

  if (!currentUserId || !notifId) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE notifications SET is_read = TRUE 
       WHERE id = $1 AND user_id = $2`,
      [notifId, currentUserId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("MARK READ ERROR:", err);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

export default router;
