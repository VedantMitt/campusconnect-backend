import { Router } from "express";
import multer from "multer";
import pool from "../db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Supabase client for storage
const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_ANON_KEY || ""
);

// Use memory storage instead of disk — files go straight to Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(file.originalname.split(".").pop()?.toLowerCase() || "");
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error("Only images (jpg, png, webp) are allowed"));
  },
});

// POST /upload/profile-pic
router.post(
  "/profile-pic",
  authMiddleware,
  upload.single("avatar"),
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user?.id;
      if (!userId || !req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const ext = req.file.originalname.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `profile-pics/${userId}-${Date.now()}.${ext}`;

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from("uploads")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (error) {
        console.error("SUPABASE UPLOAD ERROR:", error);
        return res.status(500).json({ error: "Upload to storage failed" });
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("uploads")
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      await pool.query("UPDATE users SET profile_pic = $1 WHERE id = $2", [
        publicUrl,
        userId,
      ]);

      res.json({ profile_pic: publicUrl });
    } catch (err) {
      console.error("UPLOAD ERROR:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  }
);

export default router;
