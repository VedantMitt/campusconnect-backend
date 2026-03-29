import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    name?: string;
    username?: string;
    profile_pic?: string;
  };
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET missing");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as {
      id: string;
      name?: string;
      username?: string;
      profile_pic?: string;
    };

    req.user = { id: decoded.id, name: decoded.name, username: decoded.username, profile_pic: decoded.profile_pic };

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};