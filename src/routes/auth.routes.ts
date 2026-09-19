import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";
import { sendOtpEmail } from "../lib/email";
import { cleanupExpiredPendingRegistrations } from "../lib/pending-registration-cleanup";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "rewore_secret_key_change_in_prod";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const OTP_EXPIRES_IN_MINUTES = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;

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

const verifyOtpSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  otp: z.string().regex(/^\d{6}$/, "OTP phải gồm 6 chữ số"),
});

const resendOtpSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  avatar: true,
  bio: true,
  phone: true,
  address: true,
  role: true,
  reputation: true,
  totalSales: true,
  totalBids: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
};

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const createJwtToken = (user: { id: string; email: string; role: string }): string =>
  jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );

const generateOtp = (): string => randomInt(0, 1_000_000).toString().padStart(6, "0");

const getOtpRetryAfter = async (userId: string): Promise<number> => {
  const latestOtp = await prisma.emailOtp.findFirst({
    where: { userId, usedAt: null },
    orderBy: { lastSentAt: "desc" },
    select: { lastSentAt: true },
  });

  if (!latestOtp) return 0;

  const elapsedSeconds = Math.floor((Date.now() - latestOtp.lastSentAt.getTime()) / 1000);
  return Math.max(0, OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
};

const createEmailOtp = async (userId: string, email: string): Promise<{ otp: string; otpId: string }> => {
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 12);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_IN_MINUTES * 60 * 1000);

  const emailOtp = await prisma.emailOtp.create({
    data: {
      userId,
      email,
      otpHash,
      expiresAt,
      lastSentAt: now,
    },
    select: { id: true },
  });

  return { otp, otpId: emailOtp.id };
};

const sendRegistrationOtp = async (user: { id: string; email: string; name: string }): Promise<void> => {
  const { otp, otpId } = await createEmailOtp(user.id, user.email);

  try {
    await sendOtpEmail({ to: user.email, name: user.name, otp });
  } catch (err) {
    await prisma.emailOtp.delete({ where: { id: otpId } }).catch((deleteErr) => {
      console.error("[EMAIL OTP CLEANUP ERROR]", deleteErr);
    });
    throw err;
  }

  await prisma.emailOtp.updateMany({
    where: {
      userId: user.id,
      usedAt: null,
      id: { not: otpId },
    },
    data: { usedAt: new Date() },
  });
};

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
 *         description: Tạo tài khoản chưa verify và gửi OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OtpRequiredResponse'
 *       400:
 *         description: Validation error hoặc email đã tồn tại
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       429:
 *         description: Gửi OTP quá thường xuyên
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

    const email = normalizeEmail(parsed.data.email);
    const { password, name } = parsed.data;

    await cleanupExpiredPendingRegistrations(email);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.isVerified) {
        res.status(400).json({ success: false, message: "Email đã được sử dụng" });
        return;
      }

      const retryAfter = await getOtpRetryAfter(existing.id);
      if (retryAfter > 0) {
        res.status(429).json({
          success: false,
          message: "Please wait before requesting another OTP",
          retryAfter,
          requiresOtp: true,
          email,
        });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await prisma.user.update({
        where: { id: existing.id },
        data: { password: hashedPassword, name },
        select: { id: true, email: true, name: true },
      });

      await sendRegistrationOtp(user);
      res.status(201).json({
        success: true,
        message: "OTP sent to email",
        email: user.email,
        requiresOtp: true,
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name, isVerified: false },
      select: { id: true, email: true, name: true },
    });

    try {
      await sendRegistrationOtp(user);
    } catch (err) {
      await prisma.user.delete({ where: { id: user.id } }).catch((deleteErr) => {
        console.error("[PENDING USER CLEANUP ERROR]", deleteErr);
      });
      throw err;
    }

    res.status(201).json({
      success: true,
      message: "OTP sent to email",
      email: user.email,
      requiresOtp: true,
    });
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
 *       403:
 *         description: Email chưa được xác thực OTP
 */
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error" });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const { password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ success: false, message: "Email hoặc mật khẩu không đúng" });
      return;
    }

    if (user.isBanned) {
      res.status(403).json({ success: false, message: "Account is banned" });
      return;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      res.status(401).json({ success: false, message: "Email hoặc mật khẩu không đúng" });
      return;
    }

    if (!user.isVerified) {
      res.status(403).json({
        success: false,
        message: "Please verify your email before logging in",
        requiresOtp: true,
        email: user.email,
      });
      return;
    }

    const token = createJwtToken(user);

    const { password: _pwd, ...userWithoutPassword } = user;
    res.json({ success: true, token, user: userWithoutPassword });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auth/verify-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Xác thực OTP email sau đăng ký
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyOtpBody'
 *     responses:
 *       200:
 *         description: Xác thực thành công, trả JWT token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: OTP sai, hết hạn hoặc quá số lần thử
 */
router.post("/verify-otp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = verifyOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const { otp } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(400).json({ success: false, message: "Invalid or expired OTP" });
      return;
    }

    if (user.isVerified) {
      res.status(400).json({ success: false, message: "Email already verified" });
      return;
    }

    const emailOtp = await prisma.emailOtp.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!emailOtp || emailOtp.expiresAt <= new Date() || emailOtp.attempts >= OTP_MAX_ATTEMPTS) {
      res.status(400).json({ success: false, message: "Invalid or expired OTP" });
      return;
    }

    const isValidOtp = await bcrypt.compare(otp, emailOtp.otpHash);
    if (!isValidOtp) {
      const nextAttempts = emailOtp.attempts + 1;

      await prisma.emailOtp.update({
        where: { id: emailOtp.id },
        data: {
          attempts: { increment: 1 },
          ...(nextAttempts >= OTP_MAX_ATTEMPTS && { usedAt: new Date() }),
        },
      });

      res.status(400).json({ success: false, message: "Invalid or expired OTP" });
      return;
    }

    const [verifiedUser] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
        select: userSelect,
      }),
      prisma.emailOtp.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    const token = createJwtToken(verifiedUser);

    res.json({ success: true, token, user: verifiedUser });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auth/resend-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Gửi lại OTP xác thực email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResendOtpBody'
 *     responses:
 *       200:
 *         description: Gửi lại OTP thành công hoặc trả success chung nếu không cần gửi
 *       400:
 *         description: Validation error
 *       429:
 *         description: Gửi OTP quá thường xuyên
 *       410:
 *         description: Pending registration đã hết hạn, cần đăng ký lại
 */
router.post("/resend-otp", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = resendOtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const deletedPending = await cleanupExpiredPendingRegistrations(email);

    if (deletedPending > 0) {
      res.status(410).json({
        success: false,
        message: "OTP expired. Please register again",
        requiresRegister: true,
        email,
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isVerified: true },
    });

    if (!user || user.isVerified) {
      res.json({ success: true, message: "OTP resent" });
      return;
    }

    const retryAfter = await getOtpRetryAfter(user.id);
    if (retryAfter > 0) {
      res.status(429).json({
        success: false,
        message: "Please wait before requesting another OTP",
        retryAfter,
        requiresOtp: true,
        email: user.email,
      });
      return;
    }

    await sendRegistrationOtp(user);

    res.json({ success: true, message: "OTP resent" });
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
 *       401:
 *         description: Unauthorized
 */
router.get("/me", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true, email: true, name: true, avatar: true, bio: true,
        phone: true, address: true, role: true, reputation: true,
        totalSales: true, totalBids: true, isVerified: true, createdAt: true,
        sellerProfile: {
          select: {
            status: true,
            reviewedAt: true,
            rejectedReason: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const { sellerProfile, ...userWithoutSellerProfile } = user;
    res.json({
      success: true,
      user: {
        ...userWithoutSellerProfile,
        sellerStatus: sellerProfile?.status ?? "NONE",
        sellerApprovedAt: sellerProfile?.status === "APPROVED" ? sellerProfile.reviewedAt : null,
        sellerSuspendedReason: sellerProfile?.status === "SUSPENDED" ? sellerProfile.rejectedReason : null,
      },
    });
  } catch (err) {
    next(err);
  }
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
  res.json({ success: true, message: "Đăng xuất thành công. Vui lòng xóa token phía client." });
});

export default router;
