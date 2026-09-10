import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

const placeBidSchema = z.object({
  auctionId: z.string().min(1),
  amount: z.number().positive("Số tiền bid phải là số dương"),
});

/**
 * @openapi
 * /api/bids:
 *   post:
 *     tags: [Bids]
 *     summary: Đặt bid cho một phiên đấu giá
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PlaceBidBody'
 *     responses:
 *       201:
 *         description: Bid thành công
 *       400:
 *         description: Bid không hợp lệ
 */
router.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = placeBidSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors }); return;
    }

    const { auctionId, amount } = parsed.data;

    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) { res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" }); return; }
    if (auction.status !== "LIVE") { res.status(400).json({ success: false, message: "Phiên đấu giá không đang diễn ra" }); return; }
    if (auction.sellerId === req.user!.userId) { res.status(400).json({ success: false, message: "Không thể bid phiên đấu giá của chính mình" }); return; }
    if (new Date() > auction.endTime) { res.status(400).json({ success: false, message: "Phiên đấu giá đã hết thời gian" }); return; }

    const minRequired = auction.currentBid + auction.minIncrement;
    if (amount < minRequired) {
      res.status(400).json({
        success: false,
        message: `Bid tối thiểu là ${minRequired.toLocaleString("vi-VN")} đồng (hiện tại ${auction.currentBid.toLocaleString("vi-VN")} + tăng tối thiểu ${auction.minIncrement.toLocaleString("vi-VN")})`,
      }); return;
    }

    // Transaction: tạo bid + cập nhật current bid + đánh dấu bid cũ không winning
    const [bid] = await prisma.$transaction([
      prisma.bid.create({
        data: { auctionId, bidderId: req.user!.userId, amount, isWinning: true },
        include: { bidder: { select: { id: true, name: true, avatar: true } } },
      }),
      prisma.bid.updateMany({ where: { auctionId, bidderId: { not: req.user!.userId }, isWinning: true }, data: { isWinning: false } }),
      prisma.auction.update({ where: { id: auctionId }, data: { currentBid: amount } }),
      prisma.user.update({ where: { id: req.user!.userId }, data: { totalBids: { increment: 1 } } }),
    ]);

    res.status(201).json({ success: true, data: bid });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/bids/auction/{auctionId}:
 *   get:
 *     tags: [Bids]
 *     summary: Lấy lịch sử bid của một phiên đấu giá
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Lịch sử bid
 */
router.get("/auction/:auctionId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auctionId = String(req.params.auctionId);
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 20)));

    const [data, total] = await Promise.all([
      prisma.bid.findMany({
        where: { auctionId },
        include: { bidder: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.bid.count({ where: { auctionId } }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/bids/my-bids:
 *   get:
 *     tags: [Bids]
 *     summary: Lấy lịch sử bid của user hiện tại
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: Lịch sử bid của tôi
 */
router.get("/my-bids", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 10)));

    const [data, total] = await Promise.all([
      prisma.bid.findMany({
        where: { bidderId: req.user!.userId },
        include: {
          auction: {
            include: {
              product: { select: { id: true, title: true, images: true, category: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.bid.count({ where: { bidderId: req.user!.userId } }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

export default router;
