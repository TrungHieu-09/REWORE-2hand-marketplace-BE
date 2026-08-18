import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
const auctions: Array<Record<string, unknown>> = [];
const generateId = () => Math.random().toString(36).substring(2, 11);

const createAuctionSchema = z.object({
  productId: z.string().min(1),
  startPrice: z.number().positive("Giá khởi điểm phải là số dương"),
  minIncrement: z.number().positive().optional().default(10000),
  startTime: z.string().datetime("Thời gian không hợp lệ"),
  endTime: z.string().datetime("Thời gian không hợp lệ"),
});

/**
 * @openapi
 * /api/auctions:
 *   get:
 *     tags: [Auctions]
 *     summary: Lấy danh sách phiên đấu giá
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [UPCOMING, LIVE, ENDED, CANCELLED]
 *         description: Filter theo trạng thái
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
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter theo danh mục sản phẩm
 *     responses:
 *       200:
 *         description: Danh sách auctions
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
 *                     $ref: '#/components/schemas/Auction'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 */
router.get("/", (_req: Request, res: Response) => {
  const page = parseInt(String(_req.query.page || 1));
  const limit = parseInt(String(_req.query.limit || 10));
  const status = _req.query.status as string;

  let filtered = auctions;
  if (status) filtered = auctions.filter((a) => a["status"] === status);

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
 * /api/auctions/{id}:
 *   get:
 *     tags: [Auctions]
 *     summary: Lấy chi tiết phiên đấu giá
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chi tiết auction
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Auction'
 *       404:
 *         description: Không tìm thấy
 */
router.get("/:id", (req: Request, res: Response) => {
  const auction = auctions.find((a) => a["id"] === req.params.id);
  if (!auction) {
    res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" });
    return;
  }
  res.json({ success: true, data: auction });
});

/**
 * @openapi
 * /api/auctions:
 *   post:
 *     tags: [Auctions]
 *     summary: Tạo phiên đấu giá mới
 *     description: Seller tạo phiên đấu giá cho một sản phẩm của họ
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAuctionBody'
 *     responses:
 *       201:
 *         description: Tạo thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Auction'
 *       400:
 *         description: Validation error
 */
router.post("/", authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createAuctionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { startPrice, startTime, endTime } = parsed.data;

    if (new Date(endTime) <= new Date(startTime)) {
      res.status(400).json({ success: false, message: "Thời gian kết thúc phải sau thời gian bắt đầu" });
      return;
    }

    const newAuction = {
      id: generateId(),
      ...parsed.data,
      currentBid: startPrice,
      status: new Date(startTime) <= new Date() ? "LIVE" : "UPCOMING",
      sellerId: req.user!.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    auctions.push(newAuction);

    res.status(201).json({ success: true, data: newAuction });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/auctions/{id}/cancel:
 *   patch:
 *     tags: [Auctions]
 *     summary: Hủy phiên đấu giá (chỉ seller hoặc admin)
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
 *         description: Hủy thành công
 *       403:
 *         description: Không có quyền
 *       404:
 *         description: Không tìm thấy
 */
router.patch("/:id/cancel", authenticate, (req: Request, res: Response) => {
  const auction = auctions.find((a) => a["id"] === req.params.id);
  if (!auction) {
    res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" });
    return;
  }
  if (auction["sellerId"] !== req.user!.userId && req.user!.role !== "ADMIN") {
    res.status(403).json({ success: false, message: "Không có quyền hủy phiên đấu giá này" });
    return;
  }
  if (auction["status"] === "ENDED" || auction["status"] === "CANCELLED") {
    res.status(400).json({ success: false, message: "Phiên đấu giá đã kết thúc hoặc đã bị hủy" });
    return;
  }
  auction["status"] = "CANCELLED";
  res.json({ success: true, message: "Phiên đấu giá đã bị hủy", data: auction });
});

export default router;
