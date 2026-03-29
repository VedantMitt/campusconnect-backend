import express from "express";
import cors from "cors";
import path from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes";
import activityRoutes from "./routes/activity.routes";
import userRoutes from "./routes/users.routes";
import uploadRoutes from "./routes/upload.routes";
import friendsRoutes from "./routes/friends.routes";
import notificationsRoutes from "./routes/notifications.routes";
import chatRoutes from "./routes/chat.routes";
import roomsRoutes from "./routes/rooms.routes";
import playRoutes from "./routes/play.routes";

const app = express();

// ─── Security Headers ────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow serving images cross-origin
}));

// ─── CORS — Lock to frontend origin ─────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000")
  .split(",")
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

// ─── Body Parsing with size limits ───────────────────
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ─── Global Rate Limiter ─────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(globalLimiter);

// ─── Strict Auth Rate Limiter ────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // Only 20 auth attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later." },
});
app.use("/auth", authLimiter);

// ─── Serve uploaded files statically ─────────────────
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ─── Health Check ────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({ status: "CampusConnect API running" });
});

// ─── Routes ──────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/activities", activityRoutes);
app.use("/users", userRoutes);
app.use("/upload", uploadRoutes);
app.use("/friends", friendsRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/chat", chatRoutes);
app.use("/rooms", roomsRoutes);
app.use("/play", playRoutes);

export default app;