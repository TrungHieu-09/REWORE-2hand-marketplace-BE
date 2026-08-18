import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

const createAuctionSchema = z.object({
  productId: z.string().min(1),
  startPrice: z.number().positive("Giá khởi điểm phải là số dương"),
  minIncrement: z.number().positive().optional().default(10000),
  startTime: z.string().datetime("Thời gian không hợp lệ"),
  endTime: z.string().datetime("Thời gian không hợp lệ"),
});

const auctionInclude = {
  product: { include: { seller: { select: { id: true, name: true, avatar: true, reputation: true } } } },
  seller: { select: { id: true, name: true, avatar: true, reputation: true, isVerified: true } },
  _count: { select: { bids: true } },
};

/**
 * @openapi
 * /api/auctions:
 *   get:
 *     tags: [Auctions]
 *     summary: Lấy danh sách phiên đấu giá
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [UPCOMING, LIVE, ENDED, CANCELLED] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách auctions
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 10)));
    const { status, category } = req.query;

    const where = {
      ...(status && { status: status as "UPCOMING" | "LIVE" | "ENDED" | "CANCELLED" }),
      ...(category && { product: { category: category as string } }),
    };

    const [data, total] = await Promise.all([
      prisma.auction.findMany({ where, include: auctionInclude, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.auction.count({ where }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
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
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết auction
 *       404:
 *         description: Không tìm thấy
 */
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auction = await prisma.auction.findUnique({
      where: { id: req.params.id },
      include: { ...auctionInclude, bids: { include: { bidder: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: "desc" }, take: 10 } },
    });
    if (!auction) { res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" }); return; }
    res.json({ success: true, data: auction });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/auctions:
 *   post:
 *     tags: [Auctions]
 *     summary: Tạo phiên đấu giá mới
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
 *       400:
 *         description: Validation error
 */
router.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createAuctionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors }); return;
    }
    const { startPrice, startTime, endTime, productId, minIncrement } = parsed.data;

    if (new Date(endTime) <= new Date(startTime)) {
      res.status(400).json({ success: false, message: "Thời gian kết thúc phải sau thời gian bắt đầu" }); return;
    }

    // Verify product belongs to this seller
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) { res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" }); return; }
    if (product.sellerId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Sản phẩm không thuộc về bạn" }); return;
    }

    const status = new Date(startTime) <= new Date() ? "LIVE" : "UPCOMING";

    const auction = await prisma.auction.create({
      data: { productId, sellerId: req.user!.userId, startPrice, currentBid: startPrice, minIncrement, startTime: new Date(startTime), endTime: new Date(endTime), status },
      include: auctionInclude,
    });

    // Update product status to AUCTION
    await prisma.product.update({ where: { id: productId }, data: { status: "AUCTION" } });

    res.status(201).json({ success: true, data: auction });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/auctions/{id}/cancel:
 *   patch:
 *     tags: [Auctions]
 *     summary: Hủy phiên đấu giá
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Hủy thành công
 */
router.patch("/:id/cancel", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auction = await prisma.auction.findUnique({ where: { id: req.params.id } });
    if (!auction) { res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" }); return; }
    if (auction.sellerId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Không có quyền hủy phiên đấu giá này" }); return;
    }
    if (auction.status === "ENDED" || auction.status === "CANCELLED") {
      res.status(400).json({ success: false, message: "Phiên đấu giá đã kết thúc hoặc đã bị hủy" }); return;
    }
    const updated = await prisma.auction.update({ where: { id: req.params.id }, data: { status: "CANCELLED" } });
    // Revert product status
    await prisma.product.update({ where: { id: auction.productId }, data: { status: "ACTIVE" } });
    res.json({ success: true, message: "Phiên đấu giá đã bị hủy", data: updated });
  } catch (err) { next(err); }
});

export default router;
