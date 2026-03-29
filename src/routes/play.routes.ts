import { Router } from "express";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";

const router = Router();

// ═══════════════════════════════════════════════════════════════
// DM ROULETTE
// ═══════════════════════════════════════════════════════════════

// Create a new roulette pool
router.post("/roulette/pool", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { title } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO dm_roulette_pools (created_by, title) VALUES ($1, $2) RETURNING *`,
      [userId, title || "DM Roulette"]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("CREATE POOL ERROR:", err);
    res.status(500).json({ error: "Failed to create pool" });
  }
});

// List active pools
router.get("/roulette/pools", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.name as creator_name, u.username as creator_username, u.profile_pic as creator_pic,
        (SELECT COUNT(*) FROM dm_roulette_entries WHERE pool_id = p.id) as participant_count
      FROM dm_roulette_pools p
      JOIN users u ON p.created_by = u.id
      WHERE p.status = 'open'
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("LIST POOLS ERROR:", err);
    res.status(500).json({ error: "Failed to list pools" });
  }
});

// Get single pool details
router.get("/roulette/pool/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const poolRes = await pool.query(`
      SELECT p.*, u.name as creator_name, u.username as creator_username, u.profile_pic as creator_pic
      FROM dm_roulette_pools p
      JOIN users u ON p.created_by = u.id
      WHERE p.id = $1
    `, [id]);

    if (poolRes.rows.length === 0) return res.status(404).json({ error: "Pool not found" });

    const entries = await pool.query(`
      SELECT e.*, u.name, u.username, u.profile_pic
      FROM dm_roulette_entries e
      JOIN users u ON e.user_id = u.id
      WHERE e.pool_id = $1
      ORDER BY e.created_at ASC
    `, [id]);

    // Check if current user has joined
    const myEntry = entries.rows.find((e: any) => e.user_id === userId);

    // Get pairs if pool is paired
    let pairs: any[] = [];
    if (poolRes.rows[0].status === "paired") {
      const pairsRes = await pool.query(`
        SELECT p.*, 
          u1.name as user1_name, u1.username as user1_username, u1.profile_pic as user1_pic,
          u2.name as user2_name, u2.username as user2_username, u2.profile_pic as user2_pic
        FROM dm_roulette_pairs p
        JOIN users u1 ON p.user1_id = u1.id
        JOIN users u2 ON p.user2_id = u2.id
        WHERE p.pool_id = $1
      `, [id]);
      pairs = pairsRes.rows;
    }

    res.json({
      ...poolRes.rows[0],
      entries: entries.rows,
      my_entry: myEntry || null,
      pairs
    });
  } catch (err) {
    console.error("GET POOL ERROR:", err);
    res.status(500).json({ error: "Failed to get pool" });
  }
});

// Join a pool
router.post("/roulette/pool/:id/join", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { gender, preferred_gender } = req.body;

    if (!gender || !preferred_gender) {
      return res.status(400).json({ error: "Gender and preferred gender are required" });
    }

    // Check pool is open
    const poolCheck = await pool.query("SELECT status FROM dm_roulette_pools WHERE id = $1", [id]);
    if (poolCheck.rows.length === 0) return res.status(404).json({ error: "Pool not found" });
    if (poolCheck.rows[0].status !== "open") return res.status(400).json({ error: "Pool is no longer open" });

    const { rows } = await pool.query(
      `INSERT INTO dm_roulette_entries (pool_id, user_id, gender, preferred_gender) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, userId, gender, preferred_gender]
    );
    res.json(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "You already joined this pool" });
    }
    console.error("JOIN POOL ERROR:", err);
    res.status(500).json({ error: "Failed to join pool" });
  }
});

// Leave a pool
router.delete("/roulette/pool/:id/leave", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    await pool.query("DELETE FROM dm_roulette_entries WHERE pool_id = $1 AND user_id = $2", [id, userId]);
    res.json({ message: "Left pool" });
  } catch (err) {
    console.error("LEAVE POOL ERROR:", err);
    res.status(500).json({ error: "Failed to leave pool" });
  }
});

// Spin — trigger pairing (creator only)
router.post("/roulette/pool/:id/spin", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    // Verify creator
    const poolCheck = await pool.query("SELECT * FROM dm_roulette_pools WHERE id = $1", [id]);
    if (poolCheck.rows.length === 0) return res.status(404).json({ error: "Pool not found" });
    if (poolCheck.rows[0].created_by !== userId) return res.status(403).json({ error: "Only the creator can spin" });
    if (poolCheck.rows[0].status !== "open") return res.status(400).json({ error: "Pool already spun" });

    // Get all entries
    const entriesRes = await pool.query(
      "SELECT * FROM dm_roulette_entries WHERE pool_id = $1 ORDER BY created_at ASC",
      [id]
    );
    const entries = entriesRes.rows;

    if (entries.length < 2) {
      return res.status(400).json({ error: "Need at least 2 participants to spin" });
    }

    // Pairing algorithm: try to match by gender preferences
    const paired: Set<string> = new Set();
    const pairs: any[] = [];

    // Fisher-Yates shuffle
    const shuffled = [...entries];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // First pass: try preference-based matching
    for (let i = 0; i < shuffled.length; i++) {
      if (paired.has(shuffled[i].user_id)) continue;
      
      for (let j = i + 1; j < shuffled.length; j++) {
        if (paired.has(shuffled[j].user_id)) continue;

        const a = shuffled[i];
        const b = shuffled[j];

        const aWantsB = a.preferred_gender === "any" || a.preferred_gender === b.gender;
        const bWantsA = b.preferred_gender === "any" || b.preferred_gender === a.gender;

        if (aWantsB && bWantsA) {
          // Randomly pick who initiates
          const initiator = Math.random() < 0.5 ? a.user_id : b.user_id;
          pairs.push({ user1_id: a.user_id, user2_id: b.user_id, initiator_id: initiator });
          paired.add(a.user_id);
          paired.add(b.user_id);
          break;
        }
      }
    }

    // Second pass: pair remaining unmatched users anyway (best effort)
    const unpaired = shuffled.filter(e => !paired.has(e.user_id));
    for (let i = 0; i < unpaired.length - 1; i += 2) {
      const initiator = Math.random() < 0.5 ? unpaired[i].user_id : unpaired[i + 1].user_id;
      pairs.push({
        user1_id: unpaired[i].user_id,
        user2_id: unpaired[i + 1].user_id,
        initiator_id: initiator
      });
    }

    // Insert pairs into DB
    for (const pair of pairs) {
      await pool.query(
        `INSERT INTO dm_roulette_pairs (pool_id, user1_id, user2_id, initiator_id) VALUES ($1, $2, $3, $4)`,
        [id, pair.user1_id, pair.user2_id, pair.initiator_id]
      );

      // Create notification for both users
      await pool.query(
        `INSERT INTO notifications (user_id, sender_id, type) VALUES ($1, $2, 'roulette_paired')`,
        [pair.user1_id, pair.user2_id]
      );
      await pool.query(
        `INSERT INTO notifications (user_id, sender_id, type) VALUES ($1, $2, 'roulette_paired')`,
        [pair.user2_id, pair.user1_id]
      );
    }

    // Mark pool as paired
    await pool.query("UPDATE dm_roulette_pools SET status = 'paired' WHERE id = $1", [id]);

    // Fetch pairs with user info
    const pairsRes = await pool.query(`
      SELECT p.*, 
        u1.name as user1_name, u1.username as user1_username, u1.profile_pic as user1_pic,
        u2.name as user2_name, u2.username as user2_username, u2.profile_pic as user2_pic
      FROM dm_roulette_pairs p
      JOIN users u1 ON p.user1_id = u1.id
      JOIN users u2 ON p.user2_id = u2.id
      WHERE p.pool_id = $1
    `, [id]);

    res.json({ message: "Pairs created!", pairs: pairsRes.rows });
  } catch (err) {
    console.error("SPIN ERROR:", err);
    res.status(500).json({ error: "Failed to spin" });
  }
});

// Get my roulette pairs (across all pools)
router.get("/roulette/my-pairs", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(`
      SELECT p.*, 
        u1.name as user1_name, u1.username as user1_username, u1.profile_pic as user1_pic,
        u2.name as user2_name, u2.username as user2_username, u2.profile_pic as user2_pic,
        dp.title as pool_title
      FROM dm_roulette_pairs p
      JOIN users u1 ON p.user1_id = u1.id
      JOIN users u2 ON p.user2_id = u2.id
      JOIN dm_roulette_pools dp ON p.pool_id = dp.id
      WHERE (p.user1_id = $1 OR p.user2_id = $1) AND p.expires_at > NOW()
      ORDER BY p.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error("MY PAIRS ERROR:", err);
    res.status(500).json({ error: "Failed to load pairs" });
  }
});


// ═══════════════════════════════════════════════════════════════
// SECRET CRUSH
// ═══════════════════════════════════════════════════════════════

// Set a crush (friends only)
router.post("/crush", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const crusherId = req.user?.id;
    const { crush_id } = req.body;

    if (!crush_id) return res.status(400).json({ error: "crush_id is required" });
    if (crusherId === crush_id) return res.status(400).json({ error: "Cannot crush on yourself" });

    // Verify they are friends
    const friendCheck = await pool.query(
      `SELECT id FROM friends 
       WHERE ((user_id1 = $1 AND user_id2 = $2) OR (user_id1 = $2 AND user_id2 = $1))
         AND status = 'accepted'`,
      [crusherId, crush_id]
    );
    if (friendCheck.rows.length === 0) {
      return res.status(400).json({ error: "You can only crush on your friends" });
    }

    // Insert crush
    await pool.query(
      `INSERT INTO secret_crushes (crusher_id, crush_id) VALUES ($1, $2)
       ON CONFLICT (crusher_id, crush_id) DO NOTHING`,
      [crusherId, crush_id]
    );

    // Check if mutual
    const mutual = await pool.query(
      `SELECT id FROM secret_crushes WHERE crusher_id = $1 AND crush_id = $2`,
      [crush_id, crusherId]
    );

    if (mutual.rows.length > 0) {
      // It's a match! Update both entries
      await pool.query(
        `UPDATE secret_crushes SET is_matched = true, matched_at = NOW() 
         WHERE (crusher_id = $1 AND crush_id = $2) OR (crusher_id = $2 AND crush_id = $1)`,
        [crusherId, crush_id]
      );

      // Notify both users
      await pool.query(
        `INSERT INTO notifications (user_id, sender_id, type) VALUES ($1, $2, 'crush_matched')`,
        [crusherId, crush_id]
      );
      await pool.query(
        `INSERT INTO notifications (user_id, sender_id, type) VALUES ($1, $2, 'crush_matched')`,
        [crush_id, crusherId]
      );

      return res.json({ message: "It's a match! 💘", matched: true });
    }

    res.json({ message: "Crush recorded secretly", matched: false });
  } catch (err) {
    console.error("CRUSH ERROR:", err);
    res.status(500).json({ error: "Failed to record crush" });
  }
});

// Get my crushes (who I've crushed on) + matches
router.get("/crush/my-crushes", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(`
      SELECT sc.id, sc.crush_id, sc.is_matched, sc.matched_at, sc.created_at,
        u.name, u.username, u.profile_pic
      FROM secret_crushes sc
      JOIN users u ON sc.crush_id = u.id
      WHERE sc.crusher_id = $1
      ORDER BY sc.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error("MY CRUSHES ERROR:", err);
    res.status(500).json({ error: "Failed to load crushes" });
  }
});

// Get matches only (mutual crushes)
router.get("/crush/matches", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(`
      SELECT sc.id, sc.matched_at,
        u.id as match_id, u.name, u.username, u.profile_pic
      FROM secret_crushes sc
      JOIN users u ON sc.crush_id = u.id
      WHERE sc.crusher_id = $1 AND sc.is_matched = true
      ORDER BY sc.matched_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error("MATCHES ERROR:", err);
    res.status(500).json({ error: "Failed to load matches" });
  }
});

// Remove a crush
router.delete("/crush/:crushId", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { crushId } = req.params;

    // Get the crush record first to check if it was matched
    const crushRecord = await pool.query(
      "SELECT * FROM secret_crushes WHERE id = $1 AND crusher_id = $2",
      [crushId, userId]
    );

    if (crushRecord.rows.length === 0) {
      return res.status(404).json({ error: "Crush not found" });
    }

    // If was matched, un-match the other side too
    if (crushRecord.rows[0].is_matched) {
      await pool.query(
        `UPDATE secret_crushes SET is_matched = false, matched_at = null 
         WHERE crusher_id = $1 AND crush_id = $2`,
        [crushRecord.rows[0].crush_id, userId]
      );
    }

    await pool.query("DELETE FROM secret_crushes WHERE id = $1 AND crusher_id = $2", [crushId, userId]);
    res.json({ message: "Crush removed" });
  } catch (err) {
    console.error("REMOVE CRUSH ERROR:", err);
    res.status(500).json({ error: "Failed to remove crush" });
  }
});


// ═══════════════════════════════════════════════════════════════
// GUESS THE LIE
// ═══════════════════════════════════════════════════════════════

// Create a game (party)
router.post("/gtl", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { title, visibility } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO gtl_games (host_id, title, visibility) VALUES ($1, $2, $3) RETURNING *`,
      [userId, title || "Guess the Lie", visibility || "public"]
    );

    // Auto-add host as approved member
    await pool.query(
      `INSERT INTO gtl_members (game_id, user_id, status) VALUES ($1, $2, 'approved')`,
      [rows[0].id, userId]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("CREATE GTL ERROR:", err);
    res.status(500).json({ error: "Failed to create game" });
  }
});

// List active games
router.get("/gtl", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(`
      SELECT g.*, u.name as host_name, u.username as host_username, u.profile_pic as host_pic,
        (SELECT COUNT(*) FROM gtl_members WHERE game_id = g.id AND status = 'approved') as member_count,
        (SELECT COUNT(*) FROM gtl_rounds WHERE game_id = g.id) as round_count,
        (SELECT status FROM gtl_members WHERE game_id = g.id AND user_id = $1) as my_status
      FROM gtl_games g
      JOIN users u ON g.host_id = u.id
      WHERE g.status != 'finished'
      ORDER BY g.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error("LIST GTL ERROR:", err);
    res.status(500).json({ error: "Failed to list games" });
  }
});

// Get game details
router.get("/gtl/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const gameRes = await pool.query(`
      SELECT g.*, u.name as host_name, u.username as host_username, u.profile_pic as host_pic
      FROM gtl_games g
      JOIN users u ON g.host_id = u.id
      WHERE g.id = $1
    `, [id]);

    if (gameRes.rows.length === 0) return res.status(404).json({ error: "Game not found" });

    const members = await pool.query(`
      SELECT m.*, u.name, u.username, u.profile_pic
      FROM gtl_members m
      JOIN users u ON m.user_id = u.id
      WHERE m.game_id = $1
      ORDER BY m.created_at ASC
    `, [id]);

    const rounds = await pool.query(`
      SELECT r.*, u.name as presenter_name, u.username as presenter_username, u.profile_pic as presenter_pic,
        (SELECT COUNT(*) FROM gtl_votes WHERE round_id = r.id) as vote_count,
        (SELECT guessed_index FROM gtl_votes WHERE round_id = r.id AND voter_id = $2) as my_vote
      FROM gtl_rounds r
      JOIN users u ON r.presenter_id = u.id
      WHERE r.game_id = $1
      ORDER BY r.created_at DESC
    `, [id, userId]);

    // For revealed rounds, include vote breakdown
    for (const round of rounds.rows) {
      if (round.status === "revealed") {
        const votes = await pool.query(`
          SELECT v.*, u.name as voter_name, u.username as voter_username
          FROM gtl_votes v
          JOIN users u ON v.voter_id = u.id
          WHERE v.round_id = $1
        `, [round.id]);
        round.votes = votes.rows;
      }
    }

    const myMembership = members.rows.find((m: any) => m.user_id === userId);

    res.json({
      ...gameRes.rows[0],
      members: members.rows,
      rounds: rounds.rows,
      my_membership: myMembership || null
    });
  } catch (err) {
    console.error("GET GTL ERROR:", err);
    res.status(500).json({ error: "Failed to get game" });
  }
});

// Join a game
router.post("/gtl/:id/join", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const gameCheck = await pool.query("SELECT * FROM gtl_games WHERE id = $1", [id]);
    if (gameCheck.rows.length === 0) return res.status(404).json({ error: "Game not found" });

    const status = gameCheck.rows[0].visibility === "private" ? "pending" : "approved";

    await pool.query(
      `INSERT INTO gtl_members (game_id, user_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (game_id, user_id) DO NOTHING`,
      [id, userId, status]
    );

    res.json({ message: status === "pending" ? "Join request sent" : "Joined game!", status });
  } catch (err) {
    console.error("JOIN GTL ERROR:", err);
    res.status(500).json({ error: "Failed to join game" });
  }
});

// Approve/reject member (host only)
router.put("/gtl/:id/member/:userId", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const hostId = req.user?.id;
    const { id, userId } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'

    const gameCheck = await pool.query("SELECT host_id FROM gtl_games WHERE id = $1", [id]);
    if (gameCheck.rows.length === 0) return res.status(404).json({ error: "Game not found" });
    if (gameCheck.rows[0].host_id !== hostId) return res.status(403).json({ error: "Only host can manage members" });

    await pool.query(
      "UPDATE gtl_members SET status = $1 WHERE game_id = $2 AND user_id = $3",
      [status, id, userId]
    );

    res.json({ message: `Member ${status}` });
  } catch (err) {
    console.error("MANAGE MEMBER ERROR:", err);
    res.status(500).json({ error: "Failed to manage member" });
  }
});

// Create a round (submit 3 statements)
router.post("/gtl/:id/round", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { statement1, statement2, statement3, lie_index } = req.body;

    if (!statement1 || !statement2 || !statement3 || !lie_index) {
      return res.status(400).json({ error: "All 3 statements and lie_index are required" });
    }

    if (![1, 2, 3].includes(Number(lie_index))) {
      return res.status(400).json({ error: "lie_index must be 1, 2, or 3" });
    }

    // Check membership
    const memberCheck = await pool.query(
      "SELECT status FROM gtl_members WHERE game_id = $1 AND user_id = $2",
      [id, userId]
    );
    if (memberCheck.rows.length === 0 || memberCheck.rows[0].status !== "approved") {
      return res.status(403).json({ error: "You must be an approved member to create a round" });
    }

    const { rows } = await pool.query(
      `INSERT INTO gtl_rounds (game_id, presenter_id, statement1, statement2, statement3, lie_index) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, userId, statement1, statement2, statement3, Number(lie_index)]
    );

    // Update game status to active if waiting
    await pool.query("UPDATE gtl_games SET status = 'active' WHERE id = $1 AND status = 'waiting'", [id]);

    res.json(rows[0]);
  } catch (err) {
    console.error("CREATE ROUND ERROR:", err);
    res.status(500).json({ error: "Failed to create round" });
  }
});

// Vote on a round
router.post("/gtl/round/:roundId/vote", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { roundId } = req.params;
    const { guessed_index } = req.body;

    if (![1, 2, 3].includes(Number(guessed_index))) {
      return res.status(400).json({ error: "guessed_index must be 1, 2, or 3" });
    }

    // Check round exists and is voting
    const roundCheck = await pool.query("SELECT * FROM gtl_rounds WHERE id = $1", [roundId]);
    if (roundCheck.rows.length === 0) return res.status(404).json({ error: "Round not found" });
    if (roundCheck.rows[0].status !== "voting") return res.status(400).json({ error: "Voting is closed" });
    if (roundCheck.rows[0].presenter_id === userId) return res.status(400).json({ error: "Cannot vote on your own round" });

    await pool.query(
      `INSERT INTO gtl_votes (round_id, voter_id, guessed_index) VALUES ($1, $2, $3)
       ON CONFLICT (round_id, voter_id) DO UPDATE SET guessed_index = $3`,
      [roundId, userId, Number(guessed_index)]
    );

    res.json({ message: "Vote recorded" });
  } catch (err) {
    console.error("VOTE ERROR:", err);
    res.status(500).json({ error: "Failed to vote" });
  }
});

// Reveal a round (presenter only)
router.post("/gtl/round/:roundId/reveal", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { roundId } = req.params;

    const roundCheck = await pool.query("SELECT * FROM gtl_rounds WHERE id = $1", [roundId]);
    if (roundCheck.rows.length === 0) return res.status(404).json({ error: "Round not found" });
    if (roundCheck.rows[0].presenter_id !== userId) {
      // Also allow game host
      const gameCheck = await pool.query("SELECT host_id FROM gtl_games WHERE id = $1", [roundCheck.rows[0].game_id]);
      if (gameCheck.rows[0].host_id !== userId) {
        return res.status(403).json({ error: "Only the presenter or host can reveal" });
      }
    }

    await pool.query("UPDATE gtl_rounds SET status = 'revealed' WHERE id = $1", [roundId]);

    // Get vote results
    const votes = await pool.query(`
      SELECT v.*, u.name as voter_name, u.username as voter_username
      FROM gtl_votes v
      JOIN users u ON v.voter_id = u.id
      WHERE v.round_id = $1
    `, [roundId]);

    const lieIndex = roundCheck.rows[0].lie_index;
    const correctVoters = votes.rows.filter((v: any) => v.guessed_index === lieIndex);

    res.json({
      message: "Round revealed!",
      lie_index: lieIndex,
      total_votes: votes.rows.length,
      correct_count: correctVoters.length,
      votes: votes.rows
    });
  } catch (err) {
    console.error("REVEAL ERROR:", err);
    res.status(500).json({ error: "Failed to reveal" });
  }
});

// End a game (host only)
router.post("/gtl/:id/end", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const gameCheck = await pool.query("SELECT host_id FROM gtl_games WHERE id = $1", [id]);
    if (gameCheck.rows.length === 0) return res.status(404).json({ error: "Game not found" });
    if (gameCheck.rows[0].host_id !== userId) return res.status(403).json({ error: "Only host can end game" });

    await pool.query("UPDATE gtl_games SET status = 'finished' WHERE id = $1", [id]);
    res.json({ message: "Game ended" });
  } catch (err) {
    console.error("END GAME ERROR:", err);
    res.status(500).json({ error: "Failed to end game" });
  }
});

export default router;
