import { Router } from "express";
import pool from "../db";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// ─────────────────────────────────────────────
// GET /activities — list with filters, search, tabs
// ─────────────────────────────────────────────
router.get("/", authMiddleware, async (req: any, res) => {
  const userId = req.user.id;
  const { type, status, search, tab } = req.query;

  try {
    let conditions = ["a.deleted_at IS NULL"];
    let params: any[] = [userId];
    let paramIdx = 2;

    // Category filter
    if (type && type !== "all") {
      conditions.push(`LOWER(a.type) = LOWER($${paramIdx})`);
      params.push(type);
      paramIdx++;
    }

    // Time-based status filter
    if (status === "live") {
      conditions.push(`a.date <= NOW() AND (a.submission_deadline IS NULL OR a.submission_deadline >= NOW())`);
    } else if (status === "upcoming") {
      conditions.push(`a.date > NOW()`);
    } else if (status === "past") {
      conditions.push(`(a.submission_deadline IS NOT NULL AND a.submission_deadline < NOW()) OR (a.submission_deadline IS NULL AND a.date < NOW() - INTERVAL '24 hours')`);
    }

    // Search
    if (search) {
      conditions.push(`(LOWER(a.title) LIKE LOWER($${paramIdx}) OR LOWER(a.description) LIKE LOWER($${paramIdx}))`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    // Tab: "my" = only activities user has joined/RSVP'd to
    let joinClause = "";
    if (tab === "my") {
      joinClause = `INNER JOIN (
        SELECT activity_id FROM activity_members WHERE user_id = $1
        UNION
        SELECT activity_id FROM activity_rsvps WHERE user_id = $1
      ) my ON my.activity_id = a.id`;
    }

    const whereStr = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const { rows } = await pool.query(
      `
      SELECT
        a.*,
        u.name AS host_name,
        u.username AS host_username,
        u.profile_pic AS host_pic,
        COUNT(DISTINCT am.user_id) AS member_count,
        (SELECT COUNT(*) FROM activity_rsvps r WHERE r.activity_id = a.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM activity_rsvps r WHERE r.activity_id = a.id AND r.status = 'interested') AS interested_count,
        (SELECT status FROM activity_rsvps r WHERE r.activity_id = a.id AND r.user_id = $1) AS my_rsvp,
        EXISTS (
          SELECT 1 FROM activity_members am2
          WHERE am2.activity_id = a.id AND am2.user_id = $1
        ) AS joined,
        (SELECT COUNT(*) FROM submissions s WHERE s.activity_id = a.id) AS submission_count,
        (SELECT json_agg(json_build_object('name', pu.name, 'profile_pic', pu.profile_pic))
         FROM (
           SELECT DISTINCT u2.name, u2.profile_pic
           FROM activity_members am3
           JOIN users u2 ON u2.id = am3.user_id
           WHERE am3.activity_id = a.id
           LIMIT 5
         ) pu
        ) AS participant_previews
      FROM activities a
      JOIN users u ON u.id = a.host_id
      LEFT JOIN activity_members am ON am.activity_id = a.id
      ${joinClause}
      ${whereStr}
      GROUP BY a.id, u.name, u.username, u.profile_pic
      ORDER BY
        CASE WHEN a.date > NOW() THEN 0 ELSE 1 END,
        ABS(EXTRACT(EPOCH FROM (a.date - NOW()))) ASC
      `,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error("GET ACTIVITIES ERROR:", err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

// ─────────────────────────────────────────────
// POST /activities — create new activity
// ─────────────────────────────────────────────
router.post("/", authMiddleware, async (req: any, res) => {
  const userId = req.user.id;
  const { title, type, date, location, description, banner, mode, max_participants, join_deadline, submission_deadline, allow_submissions, format, social_links } = req.body;

  if (!title || !type || !date || !location) {
    return res.status(400).json({ error: "title, type, date, location are required" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO activities (title, type, date, location, description, banner, mode, host_id, max_participants, join_deadline, submission_deadline, allow_submissions, format, social_links)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [title, type, date, location, description || null, banner || null, mode || null, userId, max_participants || null, join_deadline || null, submission_deadline || null, allow_submissions === undefined ? true : allow_submissions, format || 'Event', JSON.stringify(social_links || [])]
    );

    // Auto-join the host as a member
    await pool.query(
      `INSERT INTO activity_members (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [rows[0].id, userId]
    );

    // Auto-RSVP as going
    await pool.query(
      `INSERT INTO activity_rsvps (activity_id, user_id, status) VALUES ($1, $2, 'going') ON CONFLICT (activity_id, user_id) DO UPDATE SET status = 'going'`,
      [rows[0].id, userId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("CREATE ACTIVITY ERROR:", err);
    res.status(500).json({ error: "Failed to create activity" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id — single activity detail
// ─────────────────────────────────────────────
router.get("/:id", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;

  try {
    // Increment view count
    await pool.query(`UPDATE activities SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1`, [activityId]);

    const { rows } = await pool.query(
      `
      SELECT
        a.*,
        u.name AS host_name,
        u.username AS host_username,
        u.profile_pic AS host_pic,
        u.id AS host_user_id,
        COUNT(DISTINCT am.user_id) AS member_count,
        (SELECT COUNT(*) FROM activity_rsvps r WHERE r.activity_id = a.id AND r.status = 'going') AS going_count,
        (SELECT COUNT(*) FROM activity_rsvps r WHERE r.activity_id = a.id AND r.status = 'interested') AS interested_count,
        (SELECT status FROM activity_rsvps r WHERE r.activity_id = a.id AND r.user_id = $2) AS my_rsvp,
        EXISTS (
          SELECT 1 FROM activity_members am2
          WHERE am2.activity_id = a.id AND am2.user_id = $2
        ) AS has_joined,
        (SELECT COUNT(*) FROM submissions s WHERE s.activity_id = a.id) AS submission_count,
        (SELECT COUNT(*) FROM activity_comments c WHERE c.activity_id = a.id) AS comment_count
      FROM activities a
      JOIN users u ON u.id = a.host_id
      LEFT JOIN activity_members am ON am.activity_id = a.id
      WHERE a.id = $1
      GROUP BY a.id, u.name, u.username, u.profile_pic, u.id
      `,
      [activityId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Activity not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("GET ACTIVITY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// ─────────────────────────────────────────────
// POST /activities/:id/rsvp — set RSVP status
// ─────────────────────────────────────────────
router.post("/:id/rsvp", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;
  const { status } = req.body; // 'going' | 'interested' | 'not_going'

  if (!["going", "interested", "not_going"].includes(status)) {
    return res.status(400).json({ error: "Status must be going, interested, or not_going" });
  }

  try {
    if (status === "not_going") {
      // Remove RSVP
      await pool.query(`DELETE FROM activity_rsvps WHERE activity_id = $1 AND user_id = $2`, [activityId, userId]);
      // Also remove from activity_members
      await pool.query(`DELETE FROM activity_members WHERE activity_id = $1 AND user_id = $2`, [activityId, userId]);
    } else {
      // Upsert RSVP
      await pool.query(
        `INSERT INTO activity_rsvps (activity_id, user_id, status) VALUES ($1, $2, $3)
         ON CONFLICT (activity_id, user_id) DO UPDATE SET status = $3`,
        [activityId, userId, status]
      );

      // Also add to activity_members for backward compatibility
      if (status === "going") {
        await pool.query(
          `INSERT INTO activity_members (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [activityId, userId]
        );

        // Also handle room creation/join
        const room = await pool.query(
          `INSERT INTO rooms (activity_id) VALUES ($1)
           ON CONFLICT (activity_id) DO UPDATE SET activity_id = EXCLUDED.activity_id
           RETURNING id`,
          [activityId]
        );
        await pool.query(
          `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [room.rows[0].id, userId]
        );
      }
    }

    // Return updated counts
    const counts = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM activity_rsvps WHERE activity_id = $1 AND status = 'going') AS going_count,
        (SELECT COUNT(*) FROM activity_rsvps WHERE activity_id = $1 AND status = 'interested') AS interested_count,
        (SELECT status FROM activity_rsvps WHERE activity_id = $1 AND user_id = $2) AS my_rsvp
      `,
      [activityId, userId]
    );

    res.json(counts.rows[0]);
  } catch (err) {
    console.error("RSVP ERROR:", err);
    res.status(500).json({ error: "RSVP failed" });
  }
});

// ─────────────────────────────────────────────
// POST /activities/:id/join — legacy join (backward compat)
// ─────────────────────────────────────────────
router.post("/:id/join", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user?.id;

  try {
    await pool.query(
      `INSERT INTO activity_members (activity_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [activityId, userId]
    );

    // Also set RSVP as going
    await pool.query(
      `INSERT INTO activity_rsvps (activity_id, user_id, status) VALUES ($1, $2, 'going')
       ON CONFLICT (activity_id, user_id) DO UPDATE SET status = 'going'`,
      [activityId, userId]
    );

    const room = await pool.query(
      `INSERT INTO rooms (activity_id) VALUES ($1)
       ON CONFLICT (activity_id) DO UPDATE SET activity_id = EXCLUDED.activity_id
       RETURNING id`,
      [activityId]
    );

    await pool.query(
      `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [room.rows[0].id, userId]
    );

    res.json({ roomId: room.rows[0].id });
  } catch (err: any) {
    console.error("JOIN ACTIVITY ERROR:", err.message);
    res.status(500).json({ error: "Join failed" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id/comments — get comments
// ─────────────────────────────────────────────
router.get("/:id/comments", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.name, u.username, u.profile_pic
       FROM activity_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.activity_id = $1
       ORDER BY c.created_at ASC`,
      [activityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET COMMENTS ERROR:", err);
    res.status(500).json({ error: "Failed to load comments" });
  }
});

// ─────────────────────────────────────────────
// POST /activities/:id/comments — add comment
// ─────────────────────────────────────────────
router.post("/:id/comments", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;
  const { content } = req.body;

  if (!content?.trim()) {
    return res.status(400).json({ error: "Comment content is required" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO activity_comments (activity_id, user_id, content) VALUES ($1, $2, $3) RETURNING *`,
      [activityId, userId, content.trim()]
    );

    // Fetch user info to return with comment
    const user = await pool.query(`SELECT name, username, profile_pic FROM users WHERE id = $1`, [userId]);

    res.json({ ...rows[0], ...user.rows[0] });
  } catch (err) {
    console.error("POST COMMENT ERROR:", err);
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// ─────────────────────────────────────────────
// POST /activities/:id/invite — invite a friend
// ─────────────────────────────────────────────
router.post("/:id/invite", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const inviterId = req.user.id;
  const { invitee_id } = req.body;

  if (!invitee_id) {
    return res.status(400).json({ error: "invitee_id is required" });
  }

  try {
    // Check they're friends
    const friendCheck = await pool.query(
      `SELECT 1 FROM friends WHERE status = 'accepted' AND
       ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))`,
      [inviterId, invitee_id]
    );

    if (friendCheck.rowCount === 0) {
      return res.status(403).json({ error: "You can only invite friends" });
    }

    await pool.query(
      `INSERT INTO activity_invites (activity_id, inviter_id, invitee_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [activityId, inviterId, invitee_id]
    );

    // Create notification
    const inviter = await pool.query(`SELECT name FROM users WHERE id = $1`, [inviterId]);
    const activity = await pool.query(`SELECT title FROM activities WHERE id = $1`, [activityId]);
    
    await pool.query(
      `INSERT INTO notifications (user_id, type, sender_id)
       VALUES ($1, 'activity_invite', $2)`,
      [invitee_id, inviterId]
    );

    res.json({ message: "Invite sent" });
  } catch (err) {
    console.error("INVITE ERROR:", err);
    res.status(500).json({ error: "Invite failed" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id/leaderboard — ranked submissions
// ─────────────────────────────────────────────
router.get("/:id/leaderboard", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        s.id, s.content_url, s.description, s.created_at,
        u.id AS user_id, u.name, u.username, u.profile_pic,
        COUNT(v.id) AS vote_count,
        EXISTS (SELECT 1 FROM votes WHERE submission_id = s.id AND user_id = $2) AS has_voted
      FROM submissions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN votes v ON v.submission_id = s.id
      WHERE s.activity_id = $1
      GROUP BY s.id, u.id, u.name, u.username, u.profile_pic
      ORDER BY vote_count DESC, s.created_at ASC
      `,
      [activityId, userId]
    );

    // Add rank
    const ranked = rows.map((r: any, i: number) => ({ ...r, rank: i + 1 }));
    res.json(ranked);
  } catch (err) {
    console.error("LEADERBOARD ERROR:", err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// ─────────────────────────────────────────────
// POST /activities/:id/submit — submit entry
// ─────────────────────────────────────────────
router.post("/:id/submit", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;
  const { content_url, description } = req.body;

  if (!content_url) {
    return res.status(400).json({ error: "content_url required" });
  }

  try {
    const joined = await pool.query(
      `SELECT 1 FROM activity_members WHERE activity_id = $1 AND user_id = $2`,
      [activityId, userId]
    );
    if (joined.rowCount === 0) {
      return res.status(403).json({ error: "Join activity first" });
    }

    const { rows } = await pool.query(
      `INSERT INTO submissions (activity_id, user_id, content_url, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (activity_id, user_id) DO UPDATE SET content_url = EXCLUDED.content_url, description = EXCLUDED.description
       RETURNING *`,
      [activityId, userId, content_url, description]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("SUBMIT ERROR:", err);
    res.status(500).json({ error: "Submission failed" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id/submissions
// ─────────────────────────────────────────────
router.get("/:id/submissions", async (req, res) => {
  const activityId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.content_url, s.description, s.created_at,
              u.id AS user_id, u.name, u.profile_pic
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.activity_id = $1
       ORDER BY s.created_at DESC`,
      [activityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET SUBMISSIONS ERROR:", err);
    res.status(500).json({ error: "Failed to load submissions" });
  }
});

// ─────────────────────────────────────────────
// PUT /activities/:id — edit activity (host only)
// ─────────────────────────────────────────────
router.put("/:id", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;
  const { title, type, date, location, description, banner, mode, max_participants, join_deadline, submission_deadline, allow_submissions, format, social_links } = req.body;

  try {
    // Verify host
    const activity = await pool.query(`SELECT host_id FROM activities WHERE id = $1`, [activityId]);
    if (activity.rows.length === 0) return res.status(404).json({ error: "Activity not found" });
    if (activity.rows[0].host_id !== userId) return res.status(403).json({ error: "Only the host can edit" });

    const { rows } = await pool.query(
      `UPDATE activities SET
        title = COALESCE($1, title),
        type = COALESCE($2, type),
        date = COALESCE($3, date),
        location = COALESCE($4, location),
        description = COALESCE($5, description),
        banner = COALESCE($6, banner),
        mode = COALESCE($7, mode),
        max_participants = $8,
        join_deadline = $9,
        submission_deadline = $10,
        allow_submissions = COALESCE($11, allow_submissions),
        format = COALESCE($12, format),
        social_links = COALESCE($13, social_links)
       WHERE id = $14
       RETURNING *`,
      [title, type, date, location, description, banner, mode, max_participants || null, join_deadline || null, submission_deadline || null, allow_submissions, format, social_links ? JSON.stringify(social_links) : null, activityId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("EDIT ACTIVITY ERROR:", err);
    res.status(500).json({ error: "Edit failed" });
  }
});

// ─────────────────────────────────────────────
// DELETE /activities/:id — delete activity (host only)
// ─────────────────────────────────────────────
router.delete("/:id", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;

  try {
    const activity = await pool.query(`SELECT host_id FROM activities WHERE id = $1`, [activityId]);
    if (activity.rows.length === 0) return res.status(404).json({ error: "Activity not found" });
    if (activity.rows[0].host_id !== userId) return res.status(403).json({ error: "Only the host can delete" });

    // Soft delete
    await pool.query(`UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [activityId]);

    res.json({ message: "Activity deleted" });
  } catch (err) {
    console.error("DELETE ACTIVITY ERROR:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id/analytics — host analytics
// ─────────────────────────────────────────────
router.get("/:id/analytics", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;

  try {
    const activity = await pool.query(`SELECT host_id, view_count FROM activities WHERE id = $1`, [activityId]);
    if (activity.rows.length === 0) return res.status(404).json({ error: "Activity not found" });
    if (activity.rows[0].host_id !== userId) return res.status(403).json({ error: "Only the host can view analytics" });

    const stats = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM activity_members WHERE activity_id = $1) AS total_members,
        (SELECT COUNT(*) FROM activity_rsvps WHERE activity_id = $1 AND status = 'going') AS going_count,
        (SELECT COUNT(*) FROM activity_rsvps WHERE activity_id = $1 AND status = 'interested') AS interested_count,
        (SELECT COUNT(*) FROM submissions WHERE activity_id = $1) AS submission_count,
        (SELECT COUNT(*) FROM activity_comments WHERE activity_id = $1) AS comment_count,
        (SELECT COUNT(*) FROM activity_invites WHERE activity_id = $1) AS invite_count
      `,
      [activityId]
    );

    res.json({
      ...stats.rows[0],
      view_count: activity.rows[0].view_count || 0
    });
  } catch (err) {
    console.error("ANALYTICS ERROR:", err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id/participants — get participant list with avatars
// ─────────────────────────────────────────────
router.get("/:id/participants", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.username, u.profile_pic,
              COALESCE(r.status, 'going') AS rsvp_status
       FROM activity_members am
       JOIN users u ON u.id = am.user_id
       LEFT JOIN activity_rsvps r ON r.activity_id = am.activity_id AND r.user_id = am.user_id
       WHERE am.activity_id = $1
       ORDER BY am.joined_at ASC`,
      [activityId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET PARTICIPANTS ERROR:", err);
    res.status(500).json({ error: "Failed to load participants" });
  }
});

// ─────────────────────────────────────────────
// POST /activities/:id/polls — create poll
// ─────────────────────────────────────────────
router.post("/:id/polls", authMiddleware, async (req: any, res) => {
  const activityId = req.params.id;
  const userId = req.user.id;
  const { question, options } = req.body; // options is array of strings

  if (!question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: "question and at least 2 options required" });
  }

  try {
    const hostCheck = await pool.query(`SELECT host_id FROM activities WHERE id = $1`, [activityId]);
    if (hostCheck.rows.length === 0) return res.status(404).json({ error: "Activity not found" });
    if (hostCheck.rows[0].host_id !== userId) return res.status(403).json({ error: "Only host can create polls" });

    // Insert Poll
    const poll = await pool.query(
      `INSERT INTO activity_polls (activity_id, creator_id, question) VALUES ($1, $2, $3) RETURNING *`,
      [activityId, userId, question]
    );
    const pollId = poll.rows[0].id;

    // Insert Options
    for (const opt of options) {
      await pool.query(
        `INSERT INTO activity_poll_options (poll_id, option_text) VALUES ($1, $2)`,
        [pollId, opt]
      );
    }

    res.json(poll.rows[0]);
  } catch (err) {
    console.error("CREATE POLL ERROR:", err);
    res.status(500).json({ error: "Failed to create poll" });
  }
});

// ─────────────────────────────────────────────
// GET /activities/:id/polls — get polls
// ─────────────────────────────────────────────
router.get("/:id/polls", async (req: any, res) => {
  const activityId = req.params.id;
  
  // Try to get token to see if user has voted
  let userId = null;
  if (req.headers.authorization) {
    const token = req.headers.authorization.split(" ")[1];
    if (token) {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        userId = payload.userId || payload.id;
      } catch (e) {}
    }
  }

  try {
    const polls = await pool.query(
      `SELECT p.id, p.question, p.created_at, u.name as creator_name
       FROM activity_polls p
       LEFT JOIN users u ON u.id = p.creator_id
       WHERE p.activity_id = $1
       ORDER BY p.created_at DESC`,
      [activityId]
    );

    const result = [];
    for (const p of polls.rows) {
      const opts = await pool.query(
        `SELECT o.id, o.option_text, COUNT(v.id) as vote_count,
         EXISTS (SELECT 1 FROM activity_poll_votes WHERE option_id = o.id AND user_id = $2) as has_voted
         FROM activity_poll_options o
         LEFT JOIN activity_poll_votes v ON v.option_id = o.id
         WHERE o.poll_id = $1
         GROUP BY o.id, o.option_text`,
        [p.id, userId]
      );
      // Ensure vote_count is number
      const mappedOpts = opts.rows.map(o => ({
        ...o,
        vote_count: parseInt(o.vote_count || '0')
      }));
      result.push({ ...p, options: mappedOpts });
    }

    res.json(result);
  } catch (err) {
    console.error("GET POLLS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch polls" });
  }
});

// ─────────────────────────────────────────────
// POST /polls/:option_id/vote — vote on poll
// ─────────────────────────────────────────────
router.post("/polls/:option_id/vote", authMiddleware, async (req: any, res) => {
  const optionId = req.params.option_id;
  const userId = req.user.id;

  try {
    // Find poll ID
    const optRes = await pool.query(`SELECT poll_id FROM activity_poll_options WHERE id = $1`, [optionId]);
    if (optRes.rows.length === 0) return res.status(404).json({ error: "Option not found" });
    const pollId = optRes.rows[0].poll_id;

    // Check if user already voted in this poll
    const voted = await pool.query(`SELECT 1 FROM activity_poll_votes WHERE poll_id = $1 AND user_id = $2`, [pollId, userId]);
    
    if (voted.rows.length > 0) {
      // Switch vote
      await pool.query(
        `UPDATE activity_poll_votes SET option_id = $1 WHERE poll_id = $2 AND user_id = $3`,
        [optionId, pollId, userId]
      );
    } else {
      // New vote
      await pool.query(
        `INSERT INTO activity_poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)`,
        [pollId, optionId, userId]
      );
    }

    res.json({ message: "Voted successfully" });
  } catch (err) {
    console.error("VOTE ERROR:", err);
    res.status(500).json({ error: "Failed to cast vote" });
  }
});

export default router;
