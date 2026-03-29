import { Router } from "express";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// Get user's conversations
router.get("/conversations", authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(`
      SELECT c.id as conversation_id, c.last_message_at,
             u.id as other_user_id, u.name, u.username, u.profile_pic,
             COALESCE(SUM(CASE WHEN m.is_read = FALSE AND m.sender_id != $1 THEN 1 ELSE 0 END), 0) as unread_count
      FROM conversations c
      JOIN users u ON u.id = CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user1_id = $1 OR c.user2_id = $1
      GROUP BY c.id, u.id
      ORDER BY c.last_message_at DESC
    `, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get messages for a conversation
router.get("/:id/messages", authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    // Auth check config
    const verify = await pool.query("SELECT * FROM conversations WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)", [id, userId]);
    if (verify.rows.length === 0) return res.status(403).json({ error: "Not authorized for this chat" });

    const messages = await pool.query(`
      SELECT m.*, u.username as sender_username 
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
    `, [id]);
    
    // Mark as read
    await pool.query("UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id != $2 AND is_read = FALSE", [id, userId]);

    res.json(messages.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Post a message via REST (saves to DB, then socket.io client will push out the event too)
router.post("/:id/messages", authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { content } = req.body;
    
    if (!content) return res.status(400).json({ error: "Content is required" });

    const msg = await pool.query(`
      INSERT INTO messages (conversation_id, sender_id, content) 
      VALUES ($1, $2, $3) RETURNING *
    `, [id, userId, content]);

    await pool.query("UPDATE conversations SET last_message_at = NOW() WHERE id = $1", [id]);
    
    // Also return sender username for instant frontend display
    const userRow = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
    const finalMsg = { ...msg.rows[0], sender_username: userRow.rows[0].username };

    res.json(finalMsg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Initiate or fetch conversation by target user id
router.post("/initiate/:otherUserId", authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { otherUserId } = req.params;

    if (userId === otherUserId) return res.status(400).json({ error: "Cannot chat with yourself" });

    const existing = await pool.query(`
      SELECT id FROM conversations WHERE 
      (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
    `, [userId, otherUserId]);

    if (existing.rows.length > 0) {
      return res.json({ conversation_id: existing.rows[0].id });
    }

    // Create new
    const newConv = await pool.query(`
      INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING id
    `, [userId, otherUserId]);
    res.json({ conversation_id: newConv.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete a message
router.delete("/messages/:msgId", authMiddleware, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { msgId } = req.params;

    // Verify ownership
    const msg = await pool.query("SELECT * FROM messages WHERE id = $1 AND sender_id = $2", [msgId, userId]);
    if (msg.rows.length === 0) return res.status(403).json({ error: "Not authorized to delete this message" });

    const deleted = await pool.query("DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING conversation_id", [msgId, userId]);
    res.json({ message: "Message deleted successfully", id: msgId, conversation_id: deleted.rows[0].conversation_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
