import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

const updateStatusSchema = z.object({
  status: z.enum(["PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]),
});

const orderInclude = {
  buyer: { select: { id: true, name: true, avatar: true, email: true } },
  seller: { select: { id: true, name: true, avatar: true, email: true } },
  product: { select: { id: true, title: true, images: true, category: true, price: true } },
  auction: { select: { id: true, currentBid: true, endTime: true } },
};

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: Lấy danh sách đơn hàng của user hiện tại
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [buyer, seller], default: buyer }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PENDING, PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Danh sách đơn hàng
 */
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 10)));
    const role = req.query.role || "buyer";
    const status = req.query.status as string | undefined;

    const where = {
      ...(role === "seller" ? { sellerId: req.user!.userId } : { buyerId: req.user!.userId }),
      ...(status && { status: status as "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED" }),
    };

    const [data, total] = await Promise.all([
      prisma.order.findMany({ where, include: orderInclude, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.order.count({ where }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Lấy chi tiết đơn hàng
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết đơn hàng
 *       403:
 *         description: Không có quyền xem
 *       404:
 *         description: Không tìm thấy
 */
router.get("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: orderInclude });
    if (!order) { res.status(404).json({ success: false, message: "Đơn hàng không tìm thấy" }); return; }
    if (order.buyerId !== req.user!.userId && order.sellerId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Không có quyền xem đơn hàng này" }); return;
    }
    res.json({ success: true, data: order });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/orders/{id}/status:
 *   patch:
 *     tags: [Orders]
 *     summary: Cập nhật trạng thái đơn hàng
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED]
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.patch("/:id/status", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) { res.status(404).json({ success: false, message: "Đơn hàng không tìm thấy" }); return; }

    const isBuyer = order.buyerId === req.user!.userId;
    const isSeller = order.sellerId === req.user!.userId;
    const isAdmin = req.user!.role === "ADMIN";

    if (!isBuyer && !isSeller && !isAdmin) {
      res.status(403).json({ success: false, message: "Không có quyền cập nhật đơn hàng này" }); return;
    }

    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Trạng thái không hợp lệ" }); return;
    }

    const { status } = parsed.data;
    const now = new Date();
    const timeFields = {
      ...(status === "PAID" && { paidAt: now }),
      ...(status === "SHIPPED" && { shippedAt: now }),
      ...(status === "DELIVERED" && { deliveredAt: now }),
    };

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status, ...timeFields },
      include: orderInclude,
    });

    // Nếu delivered → tăng totalSales cho seller
    if (status === "DELIVERED") {
      await prisma.user.update({ where: { id: order.sellerId }, data: { totalSales: { increment: 1 } } });
      // Cập nhật product status sang SOLD
      if (order.productId) {
        await prisma.product.update({ where: { id: order.productId }, data: { status: "SOLD" } });
      }
    }

    res.json({ success: true, message: "Cập nhật trạng thái thành công", data: updated });
  } catch (err) { next(err); }
});

export default router;
