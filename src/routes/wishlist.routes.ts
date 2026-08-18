import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();
const wishlistItems: Array<Record<string, unknown>> = [];
const generateId = () => Math.random().toString(36).substring(2, 11);

const addWishlistSchema = z.object({
  productId: z.string().min(1, "productId là bắt buộc"),
});

/**
 * @openapi
 * /api/wishlist:
 *   get:
 *     tags: [Wishlist]
 *     summary: Lấy danh sách sản phẩm yêu thích của user
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
 *           default: 12
 *     responses:
 *       200:
 *         description: Danh sách wishlist
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
 *                     $ref: '#/components/schemas/WishlistItem'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 */
router.get("/", authenticate, (req: Request, res: Response) => {
  const page = parseInt(String(req.query.page || 1));
  const limit = parseInt(String(req.query.limit || 12));

  const myItems = wishlistItems.filter((w) => w["userId"] === req.user!.userId);
  const start = (page - 1) * limit;
  const data = myItems.slice(start, start + limit);

  res.json({
    success: true,
    data,
    meta: { total: myItems.length, page, limit, totalPages: Math.ceil(myItems.length / limit) },
  });
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/WishlistItem'
 *       409:
 *         description: Sản phẩm đã có trong wishlist
 */
router.post("/", authenticate, (req: Request, res: Response) => {
  const parsed = addWishlistSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Validation error",
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { productId } = parsed.data;
  const userId = req.user!.userId;

  // Check duplicate
  const existing = wishlistItems.find((w) => w["userId"] === userId && w["productId"] === productId);
  if (existing) {
    res.status(409).json({ success: false, message: "Sản phẩm đã có trong danh sách yêu thích" });
    return;
  }

  const newItem = { id: generateId(), userId, productId, createdAt: new Date() };
  wishlistItems.push(newItem);

  res.status(201).json({ success: true, data: newItem });
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
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Xóa thành công
 *       404:
 *         description: Sản phẩm không có trong wishlist
 */
router.delete("/:productId", authenticate, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const idx = wishlistItems.findIndex(
    (w) => w["userId"] === userId && w["productId"] === req.params.productId
  );

  if (idx === -1) {
    res.status(404).json({ success: false, message: "Sản phẩm không có trong danh sách yêu thích" });
    return;
  }

  wishlistItems.splice(idx, 1);
  res.json({ success: true, message: "Đã xóa khỏi danh sách yêu thích" });
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
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Kết quả kiểm tra
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 isInWishlist:
 *                   type: boolean
 */
router.get("/check/:productId", authenticate, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const isInWishlist = wishlistItems.some(
    (w) => w["userId"] === userId && w["productId"] === req.params.productId
  );
  res.json({ success: true, isInWishlist });
});

export default router;
