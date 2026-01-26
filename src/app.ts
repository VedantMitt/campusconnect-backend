import express from "express";
import cors from "cors";

import authRoutes from "./routes/auth.routes";
import activityRoutes from "./routes/activity.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "CampusConnect API running" });
});

app.use("/auth", authRoutes);
app.use("/activities", activityRoutes);

export default app;
