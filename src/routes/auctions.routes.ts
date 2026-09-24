import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";
import { canSell, getSellingUser, sellerBlockedResponse } from "../lib/seller-permissions";
import { formatProductSeller, formatPublicSeller, publicSellerSelect } from "../lib/public-seller";
import { getAuctionEligibility } from "../lib/auction-eligibility";

const router = Router();

const createAuctionSchema = z.object({
  productId: z.string().min(1),
  startPrice: z.number().positive("Giá khởi điểm phải là số dương"),
  minIncrement: z.number().positive().optional().default(10000),
  startTime: z.string().datetime("Thời gian không hợp lệ"),
  endTime: z.string().datetime("Thời gian không hợp lệ"),
});

const auctionInclude = {
  product: { include: { seller: { select: publicSellerSelect } } },
  seller: { select: publicSellerSelect },
  _count: { select: { bids: true } },
};

const formatAuctionSeller = <T extends { product?: Parameters<typeof formatProductSeller>[0] | null; seller?: Parameters<typeof formatPublicSeller>[0] }>(auction: T) => ({
  ...auction,
  product: auction.product ? formatProductSeller(auction.product) : auction.product,
  seller: formatPublicSeller(auction.seller),
});

const finalizeAuction = async (auctionId: string) =>
  prisma.$transaction(async (tx) => {
    const auction = await tx.auction.findUnique({
      where: { id: auctionId },
      include: { product: true },
    });

    if (!auction) return null;
    if (auction.status === "ENDED" || auction.status === "CANCELLED") return auction;
    if (auction.endTime > new Date()) return auction;

    const winningBid = await tx.bid.findFirst({
      where: { auctionId, isWinning: true },
      orderBy: { amount: "desc" },
    });

    if (!winningBid) {
      await tx.product.update({
        where: { id: auction.productId },
        data: { status: "ACTIVE", availabilityStatus: "available" },
      });
      return tx.auction.update({
        where: { id: auctionId },
        data: { status: "ENDED", winnerId: null },
      });
    }

    await tx.product.update({
      where: { id: auction.productId },
      data: { status: "SOLD", availabilityStatus: "sold" },
    });

    await tx.order.upsert({
      where: { auctionId },
      update: {},
      create: {
        buyerId: winningBid.bidderId,
        sellerId: auction.sellerId,
        productId: auction.productId,
        auctionId,
        totalPrice: winningBid.amount,
        shippingFee: 0,
        paymentStatus: "UNPAID",
        status: "PENDING",
      },
    });

    return tx.auction.update({
      where: { id: auctionId },
      data: { status: "ENDED", winnerId: winningBid.bidderId },
    });
  });

const finalizeExpiredAuctions = async () => {
  const expired = await prisma.auction.findMany({
    where: {
      status: { in: ["LIVE", "UPCOMING"] },
      endTime: { lte: new Date() },
    },
    select: { id: true },
    take: 25,
  });

  await Promise.all(expired.map((auction) => finalizeAuction(auction.id)));
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
    await finalizeExpiredAuctions();

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

    res.json({ success: true, data: data.map(formatAuctionSeller), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
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
    const auctionId = String(req.params.id);
    await finalizeAuction(auctionId);

    const auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      include: { ...auctionInclude, bids: { include: { bidder: { select: { id: true, name: true, avatar: true } } }, orderBy: { createdAt: "desc" }, take: 10 } },
    });
    if (!auction) { res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" }); return; }
    res.json({ success: true, data: formatAuctionSeller(auction) });
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
    const seller = await getSellingUser(req.user!.userId);
    if (!canSell(seller)) {
      res.status(403).json(sellerBlockedResponse(seller?.sellerProfile?.status));
      return;
    }

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
    if (product.sellerId !== req.user!.userId && seller?.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Sản phẩm không thuộc về bạn" }); return;
    }
    if (product.status !== "ACTIVE" || product.availabilityStatus !== "available") {
      res.status(409).json({
        success: false,
        message: "Chỉ sản phẩm đang available mới được tạo đấu giá",
        productStatus: product.status,
        availabilityStatus: product.availabilityStatus,
      });
      return;
    }

    const auctionEligibility = getAuctionEligibility(seller?.sellerProfile ?? null, seller?.role ?? req.user!.role);
    if (!auctionEligibility.eligible) {
      res.status(403).json({
        success: false,
        message: `Cần đăng ký gói ${auctionEligibility.requiredPlan} để mở đấu giá. Gói hiện tại của bạn: ${auctionEligibility.currentPlan}.`,
        currentPlan: auctionEligibility.currentPlan,
        requiredPlan: auctionEligibility.requiredPlan,
        subscriptionActive: auctionEligibility.subscriptionActive,
        subscriptionExpiresAt: auctionEligibility.subscriptionExpiresAt,
      });
      return;
    }

    const status = new Date(startTime) <= new Date() ? "LIVE" : "UPCOMING";

    const auction = await prisma.auction.create({
      data: { productId, sellerId: req.user!.userId, startPrice, currentBid: startPrice, minIncrement, startTime: new Date(startTime), endTime: new Date(endTime), status },
      include: auctionInclude,
    });

    // Update product status to AUCTION
    await prisma.product.update({ where: { id: productId }, data: { status: "AUCTION", availabilityStatus: "held" } });

    res.status(201).json({ success: true, data: formatAuctionSeller(auction) });
  } catch (err) { next(err); }
});

router.post("/:id/close", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auctionId = String(req.params.id);
    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) { res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" }); return; }
    if (auction.sellerId !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Không có quyền kết thúc phiên đấu giá này" });
      return;
    }
    if (auction.endTime > new Date() && req.user!.role !== "ADMIN") {
      res.status(409).json({ success: false, message: "Chưa đến thời gian kết thúc đấu giá" });
      return;
    }

    const finalized = await finalizeAuction(auctionId);
    const data = await prisma.auction.findUnique({
      where: { id: finalized?.id ?? auctionId },
      include: auctionInclude,
    });

    res.json({ success: true, message: "Auction finalized", data: data ? formatAuctionSeller(data) : finalized });
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
    const auctionId = String(req.params.id);
    const seller = await getSellingUser(req.user!.userId);
    if (!seller) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const auction = await prisma.auction.findUnique({ where: { id: auctionId } });
    if (!auction) { res.status(404).json({ success: false, message: "Phiên đấu giá không tìm thấy" }); return; }
    if (seller.role !== "ADMIN" && (auction.sellerId !== req.user!.userId || !canSell(seller))) {
      res.status(403).json({ success: false, message: "Không có quyền hủy phiên đấu giá này" }); return;
    }
    if (auction.status === "ENDED" || auction.status === "CANCELLED") {
      res.status(400).json({ success: false, message: "Phiên đấu giá đã kết thúc hoặc đã bị hủy" }); return;
    }
    const updated = await prisma.auction.update({ where: { id: auctionId }, data: { status: "CANCELLED" } });
    // Revert product status
    await prisma.product.update({ where: { id: auction.productId }, data: { status: "ACTIVE", availabilityStatus: "available" } });
    res.json({ success: true, message: "Phiên đấu giá đã bị hủy", data: updated });
  } catch (err) { next(err); }
});

export default router;
