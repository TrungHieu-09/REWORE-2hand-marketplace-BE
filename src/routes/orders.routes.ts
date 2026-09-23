import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createOrderSchema = z.object({
  productId: z.string().min(1, "productId là bắt buộc"),
  shippingAddress: z.string().min(5, "Địa chỉ giao hàng là bắt buộc"),
  shippingFee: z.coerce.number().min(0).optional().default(0),
  note: z.string().optional(),
});

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
 *   post:
 *     tags: [Orders]
 *     summary: Tạo đơn hàng mới (mua sản phẩm trực tiếp)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, shippingAddress]
 *             properties:
 *               productId: { type: string }
 *               shippingAddress: { type: string }
 *               shippingFee: { type: number, default: 0 }
 *               note: { type: string }
 *     responses:
 *       201:
 *         description: Tạo đơn hàng thành công
 *       400:
 *         description: Validation error hoặc sản phẩm không hợp lệ
 *       403:
 *         description: Không thể mua sản phẩm của chính mình
 *       404:
 *         description: Sản phẩm không tìm thấy
 *       409:
 *         description: Sản phẩm đã không còn hàng
 */
router.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const { productId, shippingAddress, shippingFee, note } = parsed.data;
    const buyerId = req.user!.userId;

    // Lấy thông tin sản phẩm
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" });
      return;
    }

    // Không cho mua sản phẩm của chính mình
    if (product.sellerId === buyerId) {
      res.status(403).json({ success: false, message: "Bạn không thể mua sản phẩm của chính mình" });
      return;
    }

    // Chỉ cho mua sản phẩm đang ACTIVE
    if (product.status !== "ACTIVE") {
      res.status(409).json({ success: false, message: "Sản phẩm hiện không còn hàng hoặc đang được đấu giá" });
      return;
    }

    // Kiểm tra đã có đơn hàng pending cho sản phẩm này chưa
    const existingOrder = await prisma.order.findFirst({
      where: { productId, status: { in: ["PENDING", "CONFIRMED", "PAID", "SHIPPED"] } },
    });
    if (existingOrder) {
      res.status(409).json({ success: false, message: "Sản phẩm này đang có đơn hàng đang xử lý" });
      return;
    }

    // Tạo order và cập nhật status sản phẩm trong transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyerId,
          sellerId: product.sellerId,
          productId,
          totalPrice: product.price,
          shippingFee: shippingFee ?? 0,
          shippingAddress,
          note: note ?? null,
          status: "PENDING",
          paymentStatus: "UNPAID",
        },
        include: orderInclude,
      });

      // Đánh dấu sản phẩm đang được giữ (tạm INACTIVE)
      await tx.product.update({
        where: { id: productId },
        data: { status: "INACTIVE" },
      });

      return newOrder;
    });

    res.status(201).json({ success: true, message: "Đặt hàng thành công", data: order });
  } catch (err) { next(err); }
});

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
    const orderId = String(req.params.id);
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
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
    const orderId = String(req.params.id);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
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
    const paymentFields = {
      ...(status === "PAID" && { paymentStatus: "PAID" as const }),
      ...(status === "REFUNDED" && { paymentStatus: "REFUNDED" as const }),
    };

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status, ...timeFields, ...paymentFields },
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
