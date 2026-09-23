import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "rewore_secret_key_change_in_prod";

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "Unauthorized: No token provided" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, role: true, isBanned: true },
    });

    if (!user) {
      res.status(401).json({ success: false, message: "Unauthorized: User not found" });
      return;
    }

    if (user.isBanned) {
      res.status(403).json({ success: false, message: "Account is banned" });
      return;
    }

    req.user = { userId: user.id, email: user.email, role: user.role };
    next();
  } catch {
    res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token" });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, message: "Forbidden: Insufficient permissions" });
      return;
    }
    next();
  };
};
