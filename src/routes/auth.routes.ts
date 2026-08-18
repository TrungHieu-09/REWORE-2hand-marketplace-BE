import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "rewore_secret_key_change_in_prod";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// ─── Validation Schemas ────────────────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  password: z.string().min(6, "Mật khẩu tối thiểu 6 ký tự"),
  name: z.string().min(2, "Tên tối thiểu 2 ký tự"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Helper ───────────────────────────────────────────────────────────────────
// NOTE: Khi Prisma đã được setup đầy đủ, import PrismaClient từ generated/prisma
// và thay thế mock data bên dưới bằng Prisma queries

// Temporary in-memory store (replace with Prisma when DB is ready)
const inMemoryUsers: Array<{
  id: string;
  email: string;
  password: string;
  name: string;
  avatar: string | null;
  role: string;
  reputation: number;
  totalSales: number;
  totalBids: number;
  isVerified: boolean;
  createdAt: Date;
}> = [];

const generateId = () => Math.random().toString(36).substring(2, 11);

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Đăng ký tài khoản mới
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterBody'
 *     responses:
 *       201:
 *         description: Đăng ký thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Validation error hoặc email đã tồn tại
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, name } = parsed.data;

    // Check email exists
    const existing = inMemoryUsers.find((u) => u.email === email);
    if (existing) {
      res.status(400).json({ success: false, message: "Email đã được sử dụng" });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const newUser = {
      id: generateId(),
      email,
      password: hashedPassword,
      name,
      avatar: null,
      role: "BUYER",
      reputation: 0,
      totalSales: 0,
      totalBids: 0,
      isVerified: false,
      createdAt: new Date(),
    };
    inMemoryUsers.push(newUser);

    // Generate token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    const { password: _pwd, ...userWithoutPassword } = newUser;

    res.status(201).json({ success: true, token, user: userWithoutPassword });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Đăng nhập và nhận JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginBody'
 *     responses:
 *       200:
 *         description: Đăng nhập thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Sai email hoặc mật khẩu
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error" });
      return;
    }

    const { email, password } = parsed.data;

    const user = inMemoryUsers.find((u) => u.email === email);
    if (!user) {
      res.status(401).json({ success: false, message: "Email hoặc mật khẩu không đúng" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ success: false, message: "Email hoặc mật khẩu không đúng" });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
    );

    const { password: _pwd, ...userWithoutPassword } = user;

    res.json({ success: true, token, user: userWithoutPassword });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Lấy thông tin user hiện tại từ token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thông tin user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 */
router.get("/me", authenticate, (req: Request, res: Response) => {
  const user = inMemoryUsers.find((u) => u.id === req.user!.userId);
  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return;
  }
  const { password: _pwd, ...userWithoutPassword } = user;
  res.json({ success: true, user: userWithoutPassword });
});

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Đăng xuất (client xóa token)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Đăng xuất thành công
 */
router.post("/logout", authenticate, (_req: Request, res: Response) => {
  // JWT is stateless — client should delete the token
  res.json({ success: true, message: "Đăng xuất thành công. Vui lòng xóa token phía client." });
});

export default router;
