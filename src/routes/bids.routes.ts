import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
const bids: Array<Record<string, unknown>> = [];
const auctions: Array<Record<string, unknown>> = []; // shared ref – replace with Prisma
const generateId = () => Math.random().toString(36).substring(2, 11);

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Bid'
 *       400:
 *         description: Bid không hợp lệ (thấp hơn current bid, auction đã kết thúc...)
 *       401:
 *         description: Chưa đăng nhập
 */
router.post("/", authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = placeBidSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const { auctionId, amount } = parsed.data;

    // TODO: replace with Prisma lookup
    const auction = auctions.find((a) => a["id"] === auctionId);
    if (!auction) {
      res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" });
      return;
    }
    if (auction["status"] !== "LIVE") {
      res.status(400).json({ success: false, message: "Phiên đấu giá không đang diễn ra" });
      return;
    }
    if (auction["sellerId"] === req.user!.userId) {
      res.status(400).json({ success: false, message: "Không thể bid phiên đấu giá của chính mình" });
      return;
    }

    const currentBid = Number(auction["currentBid"]);
    const minIncrement = Number(auction["minIncrement"] || 1000);

    if (amount < currentBid + minIncrement) {
      res.status(400).json({
        success: false,
        message: `Bid phải cao hơn giá hiện tại ít nhất ${minIncrement.toLocaleString("vi-VN")} đồng. Tối thiểu: ${(currentBid + minIncrement).toLocaleString("vi-VN")} đồng`,
      });
      return;
    }

    // Mark previous winning bids as non-winning
    bids.forEach((b) => {
      if (b["auctionId"] === auctionId) b["isWinning"] = false;
    });

    const newBid = {
      id: generateId(),
      auctionId,
      bidderId: req.user!.userId,
      amount,
      isWinning: true,
      createdAt: new Date(),
    };
    bids.push(newBid);

    // Update current bid on auction
    auction["currentBid"] = amount;

    res.status(201).json({ success: true, data: newBid });
  } catch (err) {
    next(err);
  }
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
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Lịch sử bid
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
 *                     $ref: '#/components/schemas/Bid'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 */
router.get("/auction/:auctionId", (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || 1));
  const limit = parseInt(String(req.query.limit || 20));

  const auctionBids = bids
    .filter((b) => b["auctionId"] === req.params.auctionId)
    .sort((a, b) => new Date(b["createdAt"] as string).getTime() - new Date(a["createdAt"] as string).getTime());

  const start = (page - 1) * limit;
  const data = auctionBids.slice(start, start + limit);

  res.json({
    success: true,
    data,
    meta: { total: auctionBids.length, page, limit, totalPages: Math.ceil(auctionBids.length / limit) },
  });
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
 *         description: Lịch sử bid của tôi
 */
router.get("/my-bids", authenticate, (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || 1));
  const limit = parseInt(String(req.query.limit || 10));

  const myBids = bids
    .filter((b) => b["bidderId"] === req.user!.userId)
    .sort((a, b) => new Date(b["createdAt"] as string).getTime() - new Date(a["createdAt"] as string).getTime());

  const start = (page - 1) * limit;
  const data = myBids.slice(start, start + limit);

  res.json({
    success: true,
    data,
    meta: { total: myBids.length, page, limit, totalPages: Math.ceil(myBids.length / limit) },
  });
});

export default router;
