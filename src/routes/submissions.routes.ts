import { Router } from "express";
import pool from "../db";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

/**
 * POST /submissions/:id/vote
 */
router.post("/:id/vote", authMiddleware, async (req, res) => {
  const submissionId = req.params.id;
  const userId = (req as any).user?.id;

if (!userId) {
  return res.status(401).json({ error: "Unauthorized" });
}

  try {
    const submissionResult = await pool.query(
      "SELECT * FROM submissions WHERE id = $1",
      [submissionId]
    );

    if (submissionResult.rows.length === 0) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const submission = submissionResult.rows[0];

    if (submission.user_id === userId) {
      return res.status(400).json({ error: "Cannot vote your own submission" });
    }

    const joinCheck = await pool.query(
      "SELECT * FROM activity_members WHERE activity_id = $1 AND user_id = $2",
      [submission.activity_id, userId]
    );

    if (joinCheck.rows.length === 0) {
      return res.status(403).json({ error: "Join activity before voting" });
    }

    const existingVote = await pool.query(
      "SELECT * FROM votes WHERE submission_id = $1 AND user_id = $2",
      [submissionId, userId]
    );

    let voted;

    if (existingVote.rows.length > 0) {
      await pool.query(
        "DELETE FROM votes WHERE submission_id = $1 AND user_id = $2",
        [submissionId, userId]
      );
      voted = false;
    } else {
      await pool.query(
        "INSERT INTO votes (submission_id, user_id) VALUES ($1, $2)",
        [submissionId, userId]
      );
      voted = true;
    }

    const voteCountResult = await pool.query(
      "SELECT COUNT(*) FROM votes WHERE submission_id = $1",
      [submissionId]
    );

    const voteCount = parseInt(voteCountResult.rows[0].count);

    res.json({
      message: voted ? "Voted successfully" : "Vote removed",
      voted,
      voteCount
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Voting failed" });
  }
});

export default router;