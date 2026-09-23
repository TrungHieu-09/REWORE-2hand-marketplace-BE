import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";
import { Prisma } from ".prisma/client";
import { canSell, getSellingUser, sellerBlockedResponse } from "../lib/seller-permissions";
import { removeSupabaseObjects, uploadToSupabase } from "../lib/supabase-storage";
import { getProductImageUploadFiles, ProductImageUploadFiles, uploadProductImages } from "../middleware/upload.middleware";
import { formatProductSeller, publicSellerSelect } from "../lib/public-seller";

const router = Router();

const parseOptionalStringArray = (value: unknown) => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [trimmed];
  } catch {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
};

const createProductSchema = z.object({
  title: z.string().min(3, "Tên sản phẩm tối thiểu 3 ký tự"),
  description: z.string().min(10, "Mô tả tối thiểu 10 ký tự"),
  price: z.coerce.number().positive("Giá phải là số dương"),
  category: z.string().min(1),
  condition: z.enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"]),
  quantity: z.coerce.number().int().refine((value) => value === 1, "Quantity must be 1 for second-hand products").optional().default(1),
  images: z.preprocess(parseOptionalStringArray, z.array(z.string()).optional().default([])),
  brand: z.string().optional(),
  size: z.string().optional(),
  color: z.string().optional(),
  tags: z.preprocess(parseOptionalStringArray, z.array(z.string()).optional().default([])),
});

const updateProductSchema = createProductSchema.omit({ quantity: true }).partial();

const productInclude = {
  seller: {
    select: publicSellerSelect,
  },
  _count: { select: { wishlistItems: true } },
};

/**
 * @openapi
 * /api/products:
 *   get:
 *     tags: [Products]
 *     summary: Lấy danh sách sản phẩm (có filter và phân trang)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: condition
 *         schema: { type: string, enum: [NEW, LIKE_NEW, GOOD, FAIR, POOR] }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: sellerId
 *         schema: { type: string }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [price_asc, price_desc, newest, popular] }
 *     responses:
 *       200:
 *         description: Danh sách sản phẩm
 */
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 12)));
    const { category, condition, minPrice, maxPrice, search, sellerId, sortBy } = req.query;

    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      ...(category && { category: category as string }),
      ...(condition && { condition: condition as Prisma.EnumProductConditionFilter }),
      ...(sellerId && { sellerId: sellerId as string }),
      ...(minPrice || maxPrice ? { price: { ...(minPrice && { gte: Number(minPrice) }), ...(maxPrice && { lte: Number(maxPrice) }) } } : {}),
      ...(search && {
        OR: [
          { title: { contains: search as string, mode: "insensitive" } },
          { description: { contains: search as string, mode: "insensitive" } },
          { brand: { contains: search as string, mode: "insensitive" } },
        ],
      }),
    };

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sortBy === "price_asc" ? { price: "asc" }
      : sortBy === "price_desc" ? { price: "desc" }
      : sortBy === "popular" ? { viewCount: "desc" }
      : { createdAt: "desc" };

    const [data, total] = await Promise.all([
      prisma.product.findMany({ where, include: productInclude, skip: (page - 1) * limit, take: limit, orderBy }),
      prisma.product.count({ where }),
    ]);

    res.json({ success: true, data: data.map(formatProductSeller), meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
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
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Chi tiết sản phẩm
 *       404:
 *         description: Không tìm thấy
 */
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.id);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { ...productInclude, auction: true },
    });
    if (!product) { res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" }); return; }

    // Tăng view count
    await prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } });

    res.json({ success: true, data: product });
  } catch (err) { next(err); }
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
 *       400:
 *         description: Validation error
 */
router.post("/", authenticate, uploadProductImages, async (req: Request, res: Response, next: NextFunction) => {
  const productImageFiles = getProductImageUploadFiles(req.files as ProductImageUploadFiles | undefined);
  const uploadedProductPaths: string[] = [];

  try {
    const seller = await getSellingUser(req.user!.userId);
    if (!canSell(seller)) {
      res.status(403).json(sellerBlockedResponse(seller?.sellerProfile?.status));
      return;
    }

    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors }); return;
    }

    const uploadedImages = await Promise.all(
      productImageFiles.map(async (file) => {
        const uploaded = await uploadToSupabase(file, "product-images", "products");
        uploadedProductPaths.push(uploaded.path);
        return uploaded.publicUrl;
      })
    );

    const images = [
      ...parsed.data.images,
      ...uploadedImages.filter((url): url is string => Boolean(url)),
    ];

    const product = await prisma.product.create({
      data: { ...parsed.data, images, sellerId: req.user!.userId },
      include: productInclude,
    });
    res.status(201).json({ success: true, data: formatProductSeller(product) });
  } catch (err) {
    await removeSupabaseObjects("product-images", uploadedProductPaths);
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
 *         schema: { type: string }
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
 */
router.put("/:id", authenticate, uploadProductImages, async (req: Request, res: Response, next: NextFunction) => {
  const productImageFiles = getProductImageUploadFiles(req.files as ProductImageUploadFiles | undefined);
  const uploadedProductPaths: string[] = [];

  try {
    const productId = String(req.params.id);
    const seller = await getSellingUser(req.user!.userId);
    if (!seller) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) { res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" }); return; }
    if (seller.role !== "ADMIN" && (existing.sellerId !== req.user!.userId || !canSell(seller))) {
      res.status(403).json({ success: false, message: "Không có quyền sửa sản phẩm này" }); return;
    }
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors }); return;
    }

    const uploadedImages = await Promise.all(
      productImageFiles.map(async (file) => {
        const uploaded = await uploadToSupabase(file, "product-images", "products");
        uploadedProductPaths.push(uploaded.path);
        return uploaded.publicUrl;
      })
    );

    const imageUrls = uploadedImages.filter((url): url is string => Boolean(url));
    const data = {
      ...parsed.data,
      ...(imageUrls.length ? { images: [...(parsed.data.images ?? []), ...imageUrls] } : {}),
    };

    const product = await prisma.product.update({ where: { id: productId }, data, include: productInclude });
    res.json({ success: true, data: formatProductSeller(product) });
  } catch (err) {
    await removeSupabaseObjects("product-images", uploadedProductPaths);
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
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Xóa thành công
 */
router.delete("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.id);
    const seller = await getSellingUser(req.user!.userId);
    if (!seller) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const existing = await prisma.product.findUnique({ where: { id: productId } });
    if (!existing) { res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" }); return; }
    if (seller.role !== "ADMIN" && (existing.sellerId !== req.user!.userId || !canSell(seller))) {
      res.status(403).json({ success: false, message: "Không có quyền xóa sản phẩm này" }); return;
    }
    await prisma.product.delete({ where: { id: productId } });
    res.json({ success: true, message: "Sản phẩm đã được xóa" });
  } catch (err) { next(err); }
});

export default router;
