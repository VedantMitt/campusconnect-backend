import { Router, Request, Response } from "express";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// Rooms table is now initialized in migrations.ts

// ─── GET ACTIVE ROOMS ──────────────────────────────────────────
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.username as host_username, u.name as host_name, u.profile_pic as host_profile_pic 
      FROM rooms r
      JOIN users u ON u.id = r.host_id
      ORDER BY r.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch Rooms error:", err);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// ─── GET SINGLE ROOM ───────────────────────────────────────────
router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT r.*, u.username as host_username, u.name as host_name, u.profile_pic as host_profile_pic 
      FROM rooms r
      JOIN users u ON u.id = r.host_id
      WHERE r.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch Room error:", err);
    res.status(500).json({ error: "Failed to fetch room" });
  }
});

// ─── CREATE ROOM ───────────────────────────────────────────────
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  const hostId = req.user?.id;
  const { name, type, media_url } = req.body;

  if (!hostId || !name || !type) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO rooms (name, type, host_id, media_url) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, type, hostId, media_url || ""]
      );
      const room = result.rows[0];
      
      // Auto-add host as approved member
      await client.query(
        `INSERT INTO room_members (room_id, user_id, status) 
         VALUES ($1, $2, $3)`,
        [room.id, hostId, 'approved']
      );
      
      await client.query("COMMIT");
      res.json(room);
    } catch (err: any) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("Create Room error:", err);
    res.status(500).json({ error: err.message || "Failed to create room" });
  }
});

// ─── DELETE ROOM (Host only) ───────────────────────────────────
router.delete("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  const hostId = req.user?.id;
  const { id } = req.params;

  try {
    const verify = await pool.query("SELECT * FROM rooms WHERE id = $1 AND host_id = $2", [id, hostId]);
    if (verify.rows.length === 0) {
      return res.status(403).json({ error: "Not authorized to delete this room" });
    }

    await pool.query("DELETE FROM rooms WHERE id = $1", [id]);
    res.json({ message: "Room deleted successfully" });
  } catch (err) {
    console.error("Delete Room error:", err);
    res.status(500).json({ error: "Failed to delete room" });
  }
});

// Helper for determining user role
const getRole = (room: any, userId: string): "ADMIN" | "CONTRIBUTOR" | "VIEWER" => {
  if (room.host_id === userId) return "ADMIN";
  return room.roles?.[userId] || "VIEWER";
};

// ─── UPDATE ROOM MEDIA (Admins Only) ───────────────────────────
router.put("/:id/media", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params;
  const { media_url } = req.body;

  try {
    const verify = await pool.query("SELECT * FROM rooms WHERE id = $1", [id]);
    if (verify.rows.length === 0) return res.status(404).json({ error: "Room not found" });
    const room = verify.rows[0];

    // Only Admins can forcibly change the playing media
    if (getRole(room, userId) !== "ADMIN") {
      return res.status(403).json({ error: "Only admins can change the active media" });
    }

    const updated = await pool.query("UPDATE rooms SET media_url = $1 WHERE id = $2 RETURNING *", [media_url, id]);
    req.app.get('io')?.to(`media_${id}`).emit("room_update", updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("Update Room Media error:", err);
    res.status(500).json({ error: "Failed to update room media" });
  }
});

// ─── ADD TO QUEUE (Admins & Contributors) ──────────────────────
router.post("/:id/queue", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params;
  const { url, title } = req.body;

  try {
    const verify = await pool.query("SELECT * FROM rooms WHERE id = $1", [id]);
    if (verify.rows.length === 0) return res.status(404).json({ error: "Room not found" });
    const room = verify.rows[0];

    const role = getRole(room, userId);
    if (role === "VIEWER") {
      return res.status(403).json({ error: "Viewers cannot add to the queue." });
    }

    const newItem = { id: Date.now().toString(), url, title: title || url, addedBy: req.user?.name };
    const newQueue = [...(room.queue || []), newItem];

    const updated = await pool.query("UPDATE rooms SET queue = $1 WHERE id = $2 RETURNING *", [JSON.stringify(newQueue), id]);
    req.app.get('io')?.to(`media_${id}`).emit("room_update", updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("Queue Add error:", err);
    res.status(500).json({ error: "Failed to add to queue" });
  }
});

// ─── REMOVE FROM QUEUE (Admins Only) ───────────────────────────
router.delete("/:id/queue/:itemId", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { id, itemId } = req.params;

  try {
    const verify = await pool.query("SELECT * FROM rooms WHERE id = $1", [id]);
    if (verify.rows.length === 0) return res.status(404).json({ error: "Room not found" });
    const room = verify.rows[0];

    if (getRole(room, userId) !== "ADMIN") {
      return res.status(403).json({ error: "Only admins can remove items from the queue." });
    }

    const newQueue = (room.queue || []).filter((q: any) => q.id !== itemId);
    const updated = await pool.query("UPDATE rooms SET queue = $1 WHERE id = $2 RETURNING *", [JSON.stringify(newQueue), id]);
    req.app.get('io')?.to(`media_${id}`).emit("room_update", updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("Queue Remove error:", err);
    res.status(500).json({ error: "Failed to remove from queue" });
  }
});

// ─── SET ROLES (Host Only) ─────────────────────────────────────
router.put("/:id/roles", authMiddleware, async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;
  const { id } = req.params;
  const { targetUserId, role } = req.body; // role: ADMIN, CONTRIBUTOR, VIEWER

  try {
    const verify = await pool.query("SELECT * FROM rooms WHERE id = $1", [id]);
    if (verify.rows.length === 0) return res.status(404).json({ error: "Room not found" });
    const room = verify.rows[0];

    if (room.host_id !== userId) {
      return res.status(403).json({ error: "Only the room host can assign roles." });
    }

    const currentRoles = room.roles || {};
    if (role === "VIEWER") {
      delete currentRoles[targetUserId];
    } else {
      currentRoles[targetUserId] = role;
    }

    const updated = await pool.query("UPDATE rooms SET roles = $1 WHERE id = $2 RETURNING *", [JSON.stringify(currentRoles), id]);
    req.app.get('io')?.to(`media_${id}`).emit("room_update", updated.rows[0]);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error("Set Role error:", err);
    res.status(500).json({ error: "Failed to update roles" });
  }
});

export default router;
