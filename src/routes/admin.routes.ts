import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProductStatus,
  ReportResolutionAction,
  ReportStatus,
  ReportTargetType,
  SellerProfileStatus,
} from ".prisma/client";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { createAdminActionLog } from "../lib/admin-action-log";
import { sendSellerReviewResultEmail } from "../lib/email";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(authenticate, requireRole("ADMIN"));

const reasonSchema = z.object({
  reason: z.string().trim().min(2, "Reason is required"),
});

const resolveReportSchema = z.object({
  action: z.enum(["warn", "suspend", "dismiss"]),
  note: z.string().trim().optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  sortBy: z.string().optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

const getPagination = (req: Request) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return { page: 1, limit: 20, sortBy: "createdAt", sortOrder: "desc" as const };
  }
  return parsed.data;
};

const meta = (total: number, page: number, limit: number) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

const mapSellerStatus = (value?: unknown): SellerProfileStatus | undefined => {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  const map: Record<string, SellerProfileStatus> = {
    PENDING: "PENDING",
    PENDING_VERIFICATION: "PENDING",
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    SUSPENDED: "SUSPENDED",
  };
  return map[normalized];
};

const mapProductStatus = (value?: unknown): ProductStatus | undefined => {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  return Object.values(ProductStatus).includes(normalized as ProductStatus)
    ? (normalized as ProductStatus)
    : undefined;
};

const mapOrderStatus = (value?: unknown): OrderStatus | undefined => {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  return Object.values(OrderStatus).includes(normalized as OrderStatus)
    ? (normalized as OrderStatus)
    : undefined;
};

const mapPaymentStatus = (value?: unknown): PaymentStatus | undefined => {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  return Object.values(PaymentStatus).includes(normalized as PaymentStatus)
    ? (normalized as PaymentStatus)
    : undefined;
};

const mapReportStatus = (value?: unknown): ReportStatus | undefined => {
  if (!value) return undefined;
  const normalized = String(value).trim().toUpperCase();
  return Object.values(ReportStatus).includes(normalized as ReportStatus)
    ? (normalized as ReportStatus)
    : undefined;
};

const sellerProfileInclude = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      address: true,
      role: true,
      isVerified: true,
      isBanned: true,
      createdAt: true,
    },
  },
  reviewedByAdmin: {
    select: { id: true, email: true, name: true },
  },
  statusHistory: {
    orderBy: { createdAt: "desc" as const },
    include: {
      actor: { select: { id: true, email: true, name: true } },
    },
  },
};

const orderInclude = {
  buyer: { select: { id: true, email: true, name: true, phone: true } },
  seller: { select: { id: true, email: true, name: true, phone: true } },
  product: { select: { id: true, title: true, price: true, status: true } },
  auction: { select: { id: true, currentBid: true, status: true } },
};

const reportInclude = {
  reporter: { select: { id: true, email: true, name: true } },
  resolvedByAdmin: { select: { id: true, email: true, name: true } },
};

const getSellerUserIdFromReportTarget = async (report: {
  targetType: ReportTargetType;
  targetId: string;
}): Promise<string | null> => {
  if (report.targetType === "USER") return report.targetId;

  if (report.targetType === "PRODUCT") {
    const product = await prisma.product.findUnique({
      where: { id: report.targetId },
      select: { sellerId: true },
    });
    return product?.sellerId ?? null;
  }

  const order = await prisma.order.findUnique({
    where: { id: report.targetId },
    select: { sellerId: true },
  });
  return order?.sellerId ?? null;
};

router.get("/sellers", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sortOrder } = getPagination(req);
    const status = mapSellerStatus(req.query.status);
    const where: Prisma.SellerProfileWhereInput = status ? { status } : {};

    const [data, total] = await Promise.all([
      prisma.sellerProfile.findMany({
        where,
        include: sellerProfileInclude,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: sortOrder },
      }),
      prisma.sellerProfile.count({ where }),
    ]);

    res.json({ success: true, data, meta: meta(total, page, limit) });
  } catch (err) {
    next(err);
  }
});

router.get("/sellers/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seller = await prisma.sellerProfile.findUnique({
      where: { id: String(req.params.id) },
      include: sellerProfileInclude,
    });

    if (!seller) {
      res.status(404).json({ success: false, message: "Seller profile not found" });
      return;
    }

    res.json({ success: true, data: seller });
  } catch (err) {
    next(err);
  }
});

router.post("/sellers/:id/approve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerId = String(req.params.id);
    const existing = await prisma.sellerProfile.findUnique({
      where: { id: sellerId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Seller profile not found" });
      return;
    }

    if (existing.status !== "PENDING" && existing.status !== "REJECTED") {
      res.status(409).json({ success: false, message: "Seller profile is not approvable" });
      return;
    }

    const now = new Date();
    const seller = await prisma.$transaction(async (tx) => {
      const updated = await tx.sellerProfile.update({
        where: { id: sellerId },
        data: {
          status: "APPROVED",
          rejectedReason: null,
          reviewedBy: req.user!.userId,
          reviewedAt: now,
        },
        include: sellerProfileInclude,
      });

      await tx.user.update({
        where: { id: existing.userId },
        data: { role: "SELLER" },
      });

      await tx.sellerStatusHistory.create({
        data: {
          sellerProfileId: sellerId,
          fromStatus: existing.status,
          toStatus: "APPROVED",
          actorId: req.user!.userId,
          reason: "Approved by admin",
        },
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "SELLER_APPROVE",
        targetType: "SELLER_PROFILE",
        targetId: sellerId,
        note: "Approved seller profile",
      });

      return updated;
    });

    await sendSellerReviewResultEmail({
      to: existing.user.email,
      name: existing.user.name,
      shopName: existing.shopName,
      approved: true,
    });

    res.json({ success: true, message: "Seller approved", data: seller });
  } catch (err) {
    next(err);
  }
});

router.post("/sellers/:id/reject", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const sellerId = String(req.params.id);
    const existing = await prisma.sellerProfile.findUnique({
      where: { id: sellerId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    if (!existing) {
      res.status(404).json({ success: false, message: "Seller profile not found" });
      return;
    }

    if (existing.status !== "PENDING") {
      res.status(409).json({ success: false, message: "Only pending seller profiles can be rejected" });
      return;
    }

    const now = new Date();
    const seller = await prisma.$transaction(async (tx) => {
      const updated = await tx.sellerProfile.update({
        where: { id: sellerId },
        data: {
          status: "REJECTED",
          rejectedReason: parsed.data.reason,
          reviewedBy: req.user!.userId,
          reviewedAt: now,
        },
        include: sellerProfileInclude,
      });

      await tx.user.update({
        where: { id: existing.userId },
        data: { role: "BUYER" },
      });

      await tx.sellerStatusHistory.create({
        data: {
          sellerProfileId: sellerId,
          fromStatus: existing.status,
          toStatus: "REJECTED",
          actorId: req.user!.userId,
          reason: parsed.data.reason,
        },
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "SELLER_REJECT",
        targetType: "SELLER_PROFILE",
        targetId: sellerId,
        note: parsed.data.reason,
      });

      return updated;
    });

    await sendSellerReviewResultEmail({
      to: existing.user.email,
      name: existing.user.name,
      shopName: existing.shopName,
      approved: false,
      reason: parsed.data.reason,
    });

    res.json({ success: true, message: "Seller rejected", data: seller });
  } catch (err) {
    next(err);
  }
});

router.get("/users", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sortOrder } = getPagination(req);
    const search = req.query.search ? String(req.query.search).trim() : undefined;
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    const where: Prisma.UserWhereInput = {
      ...(search && {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ],
      }),
      ...(status === "banned" ? { isBanned: true } : {}),
      ...(status === "active" ? { isBanned: false } : {}),
    };

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          isVerified: true,
          isBanned: true,
          bannedReason: true,
          bannedAt: true,
          createdAt: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: sortOrder },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, data, meta: meta(total, page, limit) });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id/ban", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const userId = String(req.params.id);
    if (userId === req.user!.userId) {
      res.status(400).json({ success: false, message: "Admin cannot ban self" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const banned = await tx.user.update({
        where: { id: userId },
        data: { isBanned: true, bannedReason: parsed.data.reason, bannedAt: new Date() },
        select: { id: true, email: true, name: true, role: true, isBanned: true, bannedReason: true, bannedAt: true },
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "USER_BAN",
        targetType: "USER",
        targetId: userId,
        note: parsed.data.reason,
      });

      return banned;
    });

    res.json({ success: true, message: "User banned", data: updated });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id/unban", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.id);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const unbanned = await tx.user.update({
        where: { id: userId },
        data: { isBanned: false, bannedReason: null, bannedAt: null },
        select: { id: true, email: true, name: true, role: true, isBanned: true },
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "USER_UNBAN",
        targetType: "USER",
        targetId: userId,
      });

      return unbanned;
    });

    res.json({ success: true, message: "User unbanned", data: updated });
  } catch (err) {
    next(err);
  }
});

router.get("/products", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sortOrder } = getPagination(req);
    const status = mapProductStatus(req.query.status);
    const sellerId = req.query.sellerId ? String(req.query.sellerId) : undefined;
    const where: Prisma.ProductWhereInput = {
      ...(status && { status }),
      ...(sellerId && { sellerId }),
    };

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { seller: { select: { id: true, email: true, name: true, role: true } } },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: sortOrder },
      }),
      prisma.product.count({ where }),
    ]);

    res.json({ success: true, data, meta: meta(total, page, limit) });
  } catch (err) {
    next(err);
  }
});

router.patch("/products/:id/hide", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }

    const product = await prisma.$transaction(async (tx) => {
      const hidden = await tx.product.update({
        where: { id: productId },
        data: { status: "HIDDEN" },
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "PRODUCT_HIDE",
        targetType: "PRODUCT",
        targetId: productId,
      });

      return hidden;
    });

    res.json({ success: true, message: "Product hidden", data: product });
  } catch (err) {
    next(err);
  }
});

router.delete("/products/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }

    const product = await prisma.$transaction(async (tx) => {
      const removed = await tx.product.update({
        where: { id: productId },
        data: { status: "REMOVED" },
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "PRODUCT_REMOVE",
        targetType: "PRODUCT",
        targetId: productId,
      });

      return removed;
    });

    res.json({ success: true, message: "Product removed", data: product });
  } catch (err) {
    next(err);
  }
});

router.get("/reports", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sortOrder } = getPagination(req);
    const status = mapReportStatus(req.query.status);
    const where: Prisma.ReportWhereInput = status ? { status } : {};

    const [data, total] = await Promise.all([
      prisma.report.findMany({
        where,
        include: reportInclude,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: sortOrder },
      }),
      prisma.report.count({ where }),
    ]);

    res.json({ success: true, data, meta: meta(total, page, limit) });
  } catch (err) {
    next(err);
  }
});

router.get("/reports/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await prisma.report.findUnique({
      where: { id: String(req.params.id) },
      include: reportInclude,
    });

    if (!report) {
      res.status(404).json({ success: false, message: "Report not found" });
      return;
    }

    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
});

router.post("/reports/:id/resolve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = resolveReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const reportId = String(req.params.id);
    const existing = await prisma.report.findUnique({ where: { id: reportId } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Report not found" });
      return;
    }

    if (existing.status !== "OPEN") {
      res.status(409).json({ success: false, message: "Report already resolved" });
      return;
    }

    const actionMap: Record<string, ReportResolutionAction> = {
      warn: "WARN",
      suspend: "SUSPEND",
      dismiss: "DISMISS",
    };
    const resolutionAction = actionMap[parsed.data.action];
    const reportStatus: ReportStatus = resolutionAction === "DISMISS" ? "DISMISSED" : "RESOLVED";

    const sellerUserId = resolutionAction === "SUSPEND" ? await getSellerUserIdFromReportTarget(existing) : null;

    const report = await prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id: reportId },
        data: {
          status: reportStatus,
          resolutionAction,
          resolutionNote: parsed.data.note,
          resolvedBy: req.user!.userId,
          resolvedAt: new Date(),
        },
        include: reportInclude,
      });

      if (sellerUserId) {
        const profile = await tx.sellerProfile.findUnique({ where: { userId: sellerUserId } });
        if (profile) {
          await tx.sellerProfile.update({
            where: { id: profile.id },
            data: { status: "SUSPENDED" },
          });
          await tx.user.update({
            where: { id: sellerUserId },
            data: { role: "BUYER" },
          });
          await tx.sellerStatusHistory.create({
            data: {
              sellerProfileId: profile.id,
              fromStatus: profile.status,
              toStatus: "SUSPENDED",
              actorId: req.user!.userId,
              reason: parsed.data.note || "Suspended from report resolution",
            },
          });
        }
      }

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: `REPORT_${resolutionAction}`,
        targetType: "REPORT",
        targetId: reportId,
        note: parsed.data.note,
      });

      return updated;
    });

    res.json({ success: true, message: "Report resolved", data: report });
  } catch (err) {
    next(err);
  }
});

router.get("/orders", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit, sortOrder } = getPagination(req);
    const paymentStatus = mapPaymentStatus(req.query.paymentStatus);
    const orderStatus = mapOrderStatus(req.query.orderStatus);
    const where: Prisma.OrderWhereInput = {
      ...(paymentStatus && { paymentStatus }),
      ...(orderStatus && { status: orderStatus }),
    };

    const [data, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: orderInclude,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: sortOrder },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({ success: true, data, meta: meta(total, page, limit) });
  } catch (err) {
    next(err);
  }
});

router.patch("/orders/:id/confirm-payment", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.id);
    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }
    if (existing.paymentStatus === "PAID") {
      res.status(409).json({ success: false, message: "Order payment already confirmed" });
      return;
    }

    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "PAID",
          paidAt: new Date(),
          status: existing.status === "PENDING" ? "CONFIRMED" : existing.status,
        },
        include: orderInclude,
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "ORDER_CONFIRM_PAYMENT",
        targetType: "ORDER",
        targetId: orderId,
      });

      return updated;
    });

    res.json({ success: true, message: "Payment confirmed", data: order });
  } catch (err) {
    next(err);
  }
});

router.post("/orders/:id/refund", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = reasonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const orderId = String(req.params.id);
    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }
    if (existing.paymentStatus !== "PAID") {
      res.status(409).json({ success: false, message: "Only paid orders can be refunded" });
      return;
    }

    const order = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "REFUNDED",
          status: "REFUNDED",
        },
        include: orderInclude,
      });

      await createAdminActionLog(tx, {
        adminId: req.user!.userId,
        actionType: "ORDER_REFUND",
        targetType: "ORDER",
        targetId: orderId,
        note: parsed.data.reason,
      });

      return updated;
    });

    res.json({ success: true, message: "Order refunded", data: order });
  } catch (err) {
    next(err);
  }
});

router.get("/stats/overview", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [
      totalUsers,
      totalSellersApproved,
      totalProducts,
      totalOrders,
      gmv,
      pendingSellersCount,
      openReportsCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.sellerProfile.count({ where: { status: "APPROVED" } }),
      prisma.product.count({ where: { status: { not: "REMOVED" } } }),
      prisma.order.count(),
      prisma.order.aggregate({ where: { paymentStatus: "PAID" }, _sum: { totalPrice: true } }),
      prisma.sellerProfile.count({ where: { status: "PENDING" } }),
      prisma.report.count({ where: { status: "OPEN" } }),
    ]);

    res.json({
      success: true,
      data: {
        total_users: totalUsers,
        total_sellers_approved: totalSellersApproved,
        total_products: totalProducts,
        total_orders: totalOrders,
        gmv_total: gmv._sum.totalPrice || 0,
        pending_sellers_count: pendingSellersCount,
        open_reports_count: openReportsCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/stats/growth", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = req.query.range === "month" ? "month" : "week";
    const days = range === "month" ? 30 : 7;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));

    const [users, orders] = await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      prisma.order.findMany({
        where: { createdAt: { gte: from } },
        select: { createdAt: true, totalPrice: true, paymentStatus: true },
      }),
    ]);

    const buckets = new Map<string, { date: string; users_new: number; orders_new: number; gmv: number }>();
    for (let i = 0; i < days; i += 1) {
      const date = new Date(from);
      date.setDate(from.getDate() + i);
      const key = date.toISOString().slice(0, 10);
      buckets.set(key, { date: key, users_new: 0, orders_new: 0, gmv: 0 });
    }

    for (const user of users) {
      const key = user.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (bucket) bucket.users_new += 1;
    }

    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.orders_new += 1;
      if (order.paymentStatus === "PAID") bucket.gmv += order.totalPrice;
    }

    res.json({ success: true, range, data: Array.from(buckets.values()) });
  } catch (err) {
    next(err);
  }
});

router.get("/stats/top-sellers", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 10))));
    const grouped = await prisma.order.groupBy({
      by: ["sellerId"],
      where: { paymentStatus: "PAID" },
      _sum: { totalPrice: true },
      _count: { _all: true },
      orderBy: { _sum: { totalPrice: "desc" } },
      take: limit,
    });

    const sellerIds = grouped.map((item) => item.sellerId);
    const sellers = await prisma.user.findMany({
      where: { id: { in: sellerIds } },
      select: {
        id: true,
        email: true,
        name: true,
        reputation: true,
        sellerProfile: { select: { shopName: true, status: true } },
      },
    });
    const sellerById = new Map(sellers.map((seller) => [seller.id, seller]));

    const data = grouped.map((item) => ({
      seller: sellerById.get(item.sellerId) || { id: item.sellerId },
      total_orders: item._count._all,
      gmv_total: item._sum.totalPrice || 0,
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
