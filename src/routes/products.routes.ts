import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Mock store (replace with Prisma)
const products: Array<Record<string, unknown>> = [];
const generateId = () => Math.random().toString(36).substring(2, 11);

const createProductSchema = z.object({
  title: z.string().min(3, "Tên sản phẩm tối thiểu 3 ký tự"),
  description: z.string().min(10, "Mô tả tối thiểu 10 ký tự"),
  price: z.number().positive("Giá phải là số dương"),
  category: z.string().min(1),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"]),
  images: z.array(z.string()).optional().default([]),
  brand: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

/**
 * @openapi
 * /api/products:
 *   get:
 *     tags: [Products]
 *     summary: Lấy danh sách sản phẩm (có filter và phân trang)
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
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter theo danh mục
 *       - in: query
 *         name: condition
 *         schema:
 *           type: string
 *           enum: [NEW, LIKE_NEW, GOOD, FAIR, POOR]
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên, mô tả
 *       - in: query
 *         name: sellerId
 *         schema:
 *           type: string
 *         description: Filter theo seller
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [price_asc, price_desc, newest, popular]
 *           default: newest
 *     responses:
 *       200:
 *         description: Danh sách sản phẩm
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
 *                     $ref: '#/components/schemas/Product'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 */
router.get("/", (_req: Request, res: Response) => {
  // TODO: Add Prisma query with filters
  const page = parseInt(String(_req.query.page || 1));
  const limit = parseInt(String(_req.query.limit || 12));
  const start = (page - 1) * limit;
  const data = products.slice(start, start + limit);

  res.json({
    success: true,
    data,
    meta: {
      total: products.length,
      page,
      limit,
      totalPages: Math.ceil(products.length / limit),
    },
  });
});

/**
 * @openapi
 * /api/products/{id}:
 *   get:
 *     tags: [Products]
 *     summary: Lấy chi tiết một sản phẩm
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Chi tiết sản phẩm
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Product'
 *       404:
 *         description: Không tìm thấy
 */
router.get("/:id", (req: Request, res: Response) => {
  const product = products.find((p) => p["id"] === req.params.id);
  if (!product) {
    res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" });
    return;
  }
  res.json({ success: true, data: product });
});

/**
 * @openapi
 * /api/products:
 *   post:
 *     tags: [Products]
 *     summary: Tạo sản phẩm mới
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProductBody'
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
 *                   $ref: '#/components/schemas/Product'
 *       400:
 *         description: Validation error
 */
router.post("/", authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const newProduct = {
      id: generateId(),
      ...parsed.data,
      status: "ACTIVE",
      viewCount: 0,
      sellerId: req.user!.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    products.push(newProduct);

    res.status(201).json({ success: true, data: newProduct });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/products/{id}:
 *   put:
 *     tags: [Products]
 *     summary: Cập nhật sản phẩm
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
 *             $ref: '#/components/schemas/CreateProductBody'
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *       403:
 *         description: Không phải chủ sản phẩm
 *       404:
 *         description: Không tìm thấy
 */
router.put("/:id", authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = products.find((p) => p["id"] === req.params.id);
    if (!product) {
      res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" });
      return;
    }
    if (product["sellerId"] !== req.user!.userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Không có quyền sửa sản phẩm này" });
      return;
    }

    Object.assign(product, req.body, { updatedAt: new Date() });
    res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/products/{id}:
 *   delete:
 *     tags: [Products]
 *     summary: Xóa sản phẩm
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
 *         description: Xóa thành công
 *       403:
 *         description: Không có quyền
 *       404:
 *         description: Không tìm thấy
 */
router.delete("/:id", authenticate, (req: Request, res: Response) => {
  const idx = products.findIndex((p) => p["id"] === req.params.id);
  if (idx === -1) {
    res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" });
    return;
  }
  if (products[idx]["sellerId"] !== req.user!.userId && req.user!.role !== "ADMIN") {
    res.status(403).json({ success: false, message: "Không có quyền xóa sản phẩm này" });
    return;
  }
  products.splice(idx, 1);
  res.json({ success: true, message: "Sản phẩm đã được xóa" });
});

export default router;
