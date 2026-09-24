import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ReportTargetType } from ".prisma/client";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

const createReportSchema = z.object({
  targetType: z.enum(["USER", "PRODUCT", "ORDER"]),
  targetId: z.string().min(1, "targetId là bắt buộc"),
  reason: z.string().trim().min(3, "reason là bắt buộc"),
  description: z.string().trim().max(1000).optional(),
});

const reportInclude = {
  reporter: { select: { id: true, email: true, name: true, avatar: true } },
  resolvedByAdmin: { select: { id: true, email: true, name: true } },
};

const canReportTarget = async (userId: string, role: string, targetType: ReportTargetType, targetId: string) => {
  if (role === "ADMIN") return true;

  if (targetType === "USER") {
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    return Boolean(user && user.id !== userId);
  }

  if (targetType === "PRODUCT") {
    const product = await prisma.product.findUnique({ where: { id: targetId }, select: { id: true, sellerId: true } });
    return Boolean(product && product.sellerId !== userId);
  }

  const order = await prisma.order.findUnique({
    where: { id: targetId },
    select: { buyerId: true, sellerId: true },
  });
  return Boolean(order && (order.buyerId === userId || order.sellerId === userId));
};

router.use(authenticate);

router.get("/my", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 20)));
    const where = { reporterId: req.user!.userId };

    const [data, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: reportInclude,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.report.count({ where }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const targetType = parsed.data.targetType as ReportTargetType;
    const allowed = await canReportTarget(req.user!.userId, req.user!.role, targetType, parsed.data.targetId);
    if (!allowed) {
      res.status(403).json({ success: false, message: "Không thể report đối tượng này" });
      return;
    }

    const reason = parsed.data.description
      ? `${parsed.data.reason}\n\n${parsed.data.description}`
      : parsed.data.reason;

    const report = await prisma.report.create({
      data: {
        reporterId: req.user!.userId,
        targetType,
        targetId: parsed.data.targetId,
        reason,
      },
      include: reportInclude,
    });

    res.status(201).json({ success: true, message: "Đã gửi report cho admin", data: report });
  } catch (err) {
    next(err);
  }
});

export default router;
