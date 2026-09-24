import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma } from ".prisma/client";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";
import { formatProductSeller, publicSellerSelect } from "../lib/public-seller";

const router = Router();

const cartItemSchema = z.object({
  productId: z.string().min(1, "productId là bắt buộc"),
});

const cartInclude = {
  product: {
    include: {
      seller: { select: publicSellerSelect },
      _count: { select: { wishlistItems: true } },
    },
  },
};

const getCartAvailability = (product: {
  status: string;
  availabilityStatus: string;
}) => {
  if (product.status === "SOLD" || product.availabilityStatus === "sold") {
    return { isAvailable: false, unavailableReason: "SOLD" };
  }
  if (product.status !== "ACTIVE") {
    return { isAvailable: false, unavailableReason: product.status };
  }
  if (product.availabilityStatus !== "available") {
    return { isAvailable: false, unavailableReason: product.availabilityStatus };
  }
  return { isAvailable: true, unavailableReason: null };
};

const formatCartItem = <T extends {
  product: Parameters<typeof formatProductSeller>[0] & {
    status: string;
    availabilityStatus: string;
  };
}>(item: T) => {
  const availability = getCartAvailability(item.product);
  return {
    ...item,
    ...availability,
    product: formatProductSeller(item.product),
  };
};

router.use(authenticate);

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 20)));

    const where = { userId: req.user!.userId };
    const [data, total] = await Promise.all([
      prisma.cartItem.findMany({
        where,
        include: cartInclude,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.cartItem.count({ where }),
    ]);

    res.json({
      success: true,
      data: data.map(formatCartItem),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = cartItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: {
        id: true,
        sellerId: true,
        status: true,
        availabilityStatus: true,
      },
    });
    if (!product) {
      res.status(404).json({ success: false, message: "Sản phẩm không tìm thấy" });
      return;
    }
    if (product.sellerId === req.user!.userId) {
      res.status(400).json({ success: false, message: "Không thể thêm sản phẩm của chính bạn vào giỏ hàng" });
      return;
    }

    const availability = getCartAvailability(product);
    if (!availability.isAvailable) {
      res.status(409).json({
        success: false,
        message: "Sản phẩm đã hết hàng hoặc không còn khả dụng",
        ...availability,
      });
      return;
    }

    try {
      const item = await prisma.cartItem.create({
        data: { userId: req.user!.userId, productId: product.id },
        include: cartInclude,
      });
      res.status(201).json({ success: true, data: formatCartItem(item) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ success: false, message: "Sản phẩm đã có trong giỏ hàng" });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/:productId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.productId);
    const item = await prisma.cartItem.findUnique({
      where: { userId_productId: { userId: req.user!.userId, productId } },
    });
    if (!item) {
      res.status(404).json({ success: false, message: "Sản phẩm không có trong giỏ hàng" });
      return;
    }

    await prisma.cartItem.delete({
      where: { userId_productId: { userId: req.user!.userId, productId } },
    });
    res.json({ success: true, message: "Đã xóa khỏi giỏ hàng" });
  } catch (err) {
    next(err);
  }
});

router.get("/check/:productId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = String(req.params.productId);
    const item = await prisma.cartItem.findUnique({
      where: { userId_productId: { userId: req.user!.userId, productId } },
      include: cartInclude,
    });
    res.json({
      success: true,
      isInCart: Boolean(item),
      item: item ? formatCartItem(item) : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
