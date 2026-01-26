import { Router } from "express";
import pool from "../db";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, async (_req, res) => {
  const result = await pool.query(
    "select * from activities order by created_at desc"
  );
  res.json(result.rows);
});

export default router;
