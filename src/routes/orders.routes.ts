import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
const orders: Array<Record<string, unknown>> = [];

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
 *         schema:
 *           type: string
 *           enum: [buyer, seller]
 *           default: buyer
 *         description: Xem với tư cách buyer hay seller
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PAID, SHIPPED, DELIVERED, CANCELLED, REFUNDED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Danh sách đơn hàng
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Order'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 */
router.get("/", authenticate, (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || 1));
  const limit = parseInt(String(req.query.limit || 10));
  const role = req.query.role || "buyer";
  const status = req.query.status as string;

  let filtered = orders.filter((o) =>
    role === "seller"
      ? o["sellerId"] === req.user!.userId
      : o["buyerId"] === req.user!.userId
  );

  if (status) filtered = filtered.filter((o) => o["status"] === status);

  const start = (page - 1) * limit;
  const data = filtered.slice(start, start + limit);

  res.json({
    success: true,
    data,
    meta: { total: filtered.length, page, limit, totalPages: Math.ceil(filtered.length / limit) },
  });
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
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chi tiết đơn hàng
 *       403:
 *         description: Không có quyền xem
 *       404:
 *         description: Không tìm thấy
 */
router.get("/:id", authenticate, (req: Request, res: Response) => {
  const order = orders.find((o) => o["id"] === req.params.id);
  if (!order) {
    res.status(404).json({ success: false, message: "Đơn hàng không tìm thấy" });
    return;
  }
  if (order["buyerId"] !== req.user!.userId && order["sellerId"] !== req.user!.userId && req.user!.role !== "ADMIN") {
    res.status(403).json({ success: false, message: "Không có quyền xem đơn hàng này" });
    return;
  }
  res.json({ success: true, data: order });
});

/**
 * @openapi
 * /api/orders/{id}/status:
 *   patch:
 *     tags: [Orders]
 *     summary: Cập nhật trạng thái đơn hàng
 *     description: Seller cập nhật SHIPPED. Buyer xác nhận DELIVERED. Admin có toàn quyền.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *       403:
 *         description: Không có quyền
 */
router.patch("/:id/status", authenticate, (req: Request, res: Response) => {
  const order = orders.find((o) => o["id"] === req.params.id);
  if (!order) {
    res.status(404).json({ success: false, message: "Đơn hàng không tìm thấy" });
    return;
  }

  const { status } = req.body;
  const userId = req.user!.userId;
  const userRole = req.user!.role;

  // Permission rules
  const isBuyer = order["buyerId"] === userId;
  const isSeller = order["sellerId"] === userId;
  const isAdmin = userRole === "ADMIN";

  if (!isBuyer && !isSeller && !isAdmin) {
    res.status(403).json({ success: false, message: "Không có quyền cập nhật đơn hàng này" });
    return;
  }

  order["status"] = status;
  order["updatedAt"] = new Date();

  res.json({ success: true, message: "Cập nhật trạng thái thành công", data: order });
});

export default router;
