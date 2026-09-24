import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";
import { uploadToSupabase } from "../lib/supabase-storage";
import { getPaymentProofUploadFile, PaymentProofUploadFiles, uploadPaymentProofImage } from "../middleware/upload.middleware";

const router = Router();

const updateStatusSchema = z.object({
  status: z.enum(["SHIPPED", "DELIVERED", "COMPLETED", "CANCELLED"]),
});

const createOrderSchema = z.object({
  productId: z.string().min(1, "productId là bắt buộc"),
  shippingAddress: z.string().trim().optional(),
  note: z.string().trim().optional(),
});

const orderInclude = {
  buyer: { select: { id: true, name: true, avatar: true, email: true } },
  seller: { select: { id: true, name: true, avatar: true, email: true } },
  product: { select: { id: true, title: true, images: true, category: true, price: true, status: true, availabilityStatus: true } },
  auction: { select: { id: true, currentBid: true, endTime: true } },
};

const productIsBuyable = (product: { status: string; availabilityStatus: string }) =>
  product.status === "ACTIVE" && product.availabilityStatus === "available";

const canTransitionOrder = (
  order: { buyerId: string; sellerId: string; status: string; paymentStatus: string },
  user: { userId: string; role: string },
  nextStatus: string
) => {
  if (user.role === "ADMIN") return true;
  if (order.sellerId === user.userId) {
    return nextStatus === "SHIPPED" && (order.status === "CONFIRMED" || order.status === "PAID") && order.paymentStatus === "PAID";
  }
  if (order.buyerId === user.userId) {
    return (
      (nextStatus === "CANCELLED" && order.status === "PENDING" && order.paymentStatus === "UNPAID") ||
      (nextStatus === "DELIVERED" && order.status === "SHIPPED") ||
      (nextStatus === "COMPLETED" && (order.status === "DELIVERED" || order.status === "SHIPPED"))
    );
  }
  return false;
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
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Buyer mua ngay một sản phẩm 2hand
 *     security:
 *       - bearerAuth: []
 */
router.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: {
        id: true,
        sellerId: true,
        price: true,
        status: true,
        availabilityStatus: true,
      },
    });

    if (!product) {
      res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" });
      return;
    }

    if (product.sellerId === req.user!.userId) {
      res.status(400).json({ success: false, message: "Không thể mua sản phẩm của chính bạn" });
      return;
    }

    if (!productIsBuyable(product)) {
      res.status(409).json({
        success: false,
        message: "Sản phẩm đã hết hàng hoặc không còn khả dụng",
        productStatus: product.status,
        availabilityStatus: product.availabilityStatus,
      });
      return;
    }

    const order = await prisma.$transaction(async (tx) => {
      const lockedProduct = await tx.product.updateMany({
        where: {
          id: product.id,
          status: "ACTIVE",
          availabilityStatus: "available",
        },
        data: {
          status: "SOLD",
          availabilityStatus: "sold",
        },
      });

      if (lockedProduct.count !== 1) return null;

      const created = await tx.order.create({
        data: {
          buyerId: req.user!.userId,
          sellerId: product.sellerId,
          productId: product.id,
          totalPrice: product.price,
          shippingFee: 0,
          paymentStatus: "UNPAID",
          status: "PENDING",
          shippingAddress: parsed.data.shippingAddress,
          note: parsed.data.note,
        },
        include: orderInclude,
      });

      await tx.cartItem.deleteMany({
        where: {
          userId: req.user!.userId,
          productId: product.id,
        },
      });

      return created;
    });

    if (!order) {
      res.status(409).json({
        success: false,
        message: "Sản phẩm đã được người khác mua mất",
        availabilityStatus: "sold",
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: "Đã tạo đơn hàng. Vui lòng chuyển khoản để admin xác nhận thanh toán.",
      data: order,
    });
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

router.post("/:id/payment-proof", authenticate, uploadPaymentProofImage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = String(req.params.id);
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) { res.status(404).json({ success: false, message: "Đơn hàng không tìm thấy" }); return; }
    if (order.buyerId !== req.user!.userId) {
      res.status(403).json({ success: false, message: "Chỉ buyer của đơn hàng mới được gửi chứng từ thanh toán" });
      return;
    }
    if (order.paymentStatus !== "UNPAID" || order.status !== "PENDING") {
      res.status(409).json({ success: false, message: "Đơn hàng này không còn chờ thanh toán" });
      return;
    }

    const proofFile = getPaymentProofUploadFile(req.files as PaymentProofUploadFiles | undefined);
    if (!proofFile) {
      res.status(400).json({ success: false, message: "Payment proof image is required" });
      return;
    }

    const proof = await uploadToSupabase(proofFile, "product-images", "payment-proofs");
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { qrCodeRef: proof.publicUrl || proof.path },
      include: orderInclude,
    });

    res.json({
      success: true,
      message: "Đã gửi chứng từ thanh toán. Admin sẽ xác nhận sau khi kiểm tra.",
      data: updated,
    });
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
    if (!canTransitionOrder(order, req.user!, status)) {
      res.status(403).json({ success: false, message: "Không được phép chuyển đơn hàng sang trạng thái này" });
      return;
    }

    const now = new Date();
    const timeFields = {
      ...(status === "SHIPPED" && { shippedAt: now }),
      ...((status === "DELIVERED" || status === "COMPLETED") && { deliveredAt: now }),
    };

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status, ...timeFields },
      include: orderInclude,
    });

    // Nếu delivered → tăng totalSales cho seller
    if ((status === "DELIVERED" || status === "COMPLETED") && order.status !== "DELIVERED" && order.status !== "COMPLETED") {
      await prisma.user.update({ where: { id: order.sellerId }, data: { totalSales: { increment: 1 } } });
      // Cập nhật product status sang SOLD
      if (order.productId) {
        await prisma.product.update({ where: { id: order.productId }, data: { status: "SOLD", availabilityStatus: "sold" } });
      }
    }

    if (status === "CANCELLED" && order.productId) {
      await prisma.product.update({
        where: { id: order.productId },
        data: { status: "ACTIVE", availabilityStatus: "available" },
      });
    }

    res.json({ success: true, message: "Cập nhật trạng thái thành công", data: updated });
  } catch (err) { next(err); }
});

export default router;
