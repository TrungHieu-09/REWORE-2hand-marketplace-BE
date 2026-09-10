import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

const addWishlistSchema = z.object({
  productId: z.string().min(1, "productId là bắt buộc"),
});

const wishlistInclude = {
  product: {
    include: {
      seller: { select: { id: true, name: true, avatar: true, reputation: true } },
      _count: { select: { wishlistItems: true } },
    },
  },
};

/**
 * @openapi
 * /api/wishlist:
 *   get:
 *     tags: [Wishlist]
 *     summary: Lấy danh sách sản phẩm yêu thích
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: Danh sách wishlist
 */
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 12)));

    const [data, total] = await Promise.all([
      prisma.wishlistItem.findMany({
        where: { userId: req.user!.userId },
        include: wishlistInclude,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.wishlistItem.count({ where: { userId: req.user!.userId } }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/wishlist:
 *   post:
 *     tags: [Wishlist]
 *     summary: Thêm sản phẩm vào wishlist
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Thêm thành công
 *       409:
 *         description: Sản phẩm đã có trong wishlist
 */
router.post("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = addWishlistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors }); return;
    }

    const { productId } = parsed.data;

    // Check product exists
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) { res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" }); return; }

    try {
      const item = await prisma.wishlistItem.create({
        data: { userId: req.user!.userId, productId },
        include: wishlistInclude,
      });
      res.status(201).json({ success: true, data: item });
    } catch {
      // Unique constraint violation — already in wishlist
      res.status(409).json({ success: false, message: "Sản phẩm đã có trong danh sách yêu thích" });
    }
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/wishlist/{productId}:
 *   delete:
 *     tags: [Wishlist]
 *     summary: Xóa sản phẩm khỏi wishlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 *       404:
 *         description: Không có trong wishlist
 */
router.delete("/:productId", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.productId);
    const item = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: req.user!.userId, productId } },
    });
    if (!item) { res.status(404).json({ success: false, message: "Sản phẩm không có trong danh sách yêu thích" }); return; }

    await prisma.wishlistItem.delete({
      where: { userId_productId: { userId: req.user!.userId, productId } },
    });
    res.json({ success: true, message: "Đã xóa khỏi danh sách yêu thích" });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/wishlist/check/{productId}:
 *   get:
 *     tags: [Wishlist]
 *     summary: Kiểm tra sản phẩm có trong wishlist chưa
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Kết quả kiểm tra
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 isInWishlist: { type: boolean }
 */
router.get("/check/:productId", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.productId);
    const item = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: req.user!.userId, productId } },
    });
    res.json({ success: true, isInWishlist: !!item });
  } catch (err) { next(err); }
});

export default router;
