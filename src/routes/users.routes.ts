import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";
import { prisma } from "../lib/prisma";

const router = Router();

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  bio: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  avatar: z.string().optional(),
});

const userSelect = {
  id: true, email: true, name: true, avatar: true, bio: true,
  phone: true, address: true, role: true, reputation: true,
  totalSales: true, totalBids: true, isVerified: true, createdAt: true,
};

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: Lấy danh sách người dùng
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Tìm theo tên hoặc email
 *     responses:
 *       200:
 *         description: Danh sách users
 */
router.get("/", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || 1)));
    const limit = Math.min(50, parseInt(String(req.query.limit || 10)));
    const search = req.query.search as string | undefined;

    const where = search
      ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { email: { contains: search, mode: "insensitive" as const } }] }
      : {};

    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.user.count({ where }),
    ]);

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: Lấy thông tin profile của một user
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User profile
 *       404:
 *         description: User không tìm thấy
 */
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.id);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user) { res.status(404).json({ success: false, message: "User không tìm thấy" }); return; }
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/{id}:
 *   put:
 *     tags: [Users]
 *     summary: Cập nhật profile của user
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
 *             type: object
 *             properties:
 *               name: { type: string }
 *               bio: { type: string }
 *               phone: { type: string }
 *               address: { type: string }
 *               avatar: { type: string }
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *       403:
 *         description: Không có quyền
 */
router.put("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.id);
    if (req.user!.userId !== userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Không có quyền cập nhật profile này" }); return;
    }
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors }); return;
    }
    const user = await prisma.user.update({ where: { id: userId }, data: parsed.data, select: userSelect });
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

/**
 * @openapi
 * /api/users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: Xóa tài khoản user (Admin only)
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
 *       403:
 *         description: Không có quyền
 */
router.delete("/:id", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.id);
    if (req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Chỉ Admin mới có quyền xóa user" }); return;
    }
    await prisma.user.delete({ where: { id: userId } });
    res.json({ success: true, message: `User ${userId} đã được xóa` });
  } catch (err) { next(err); }
});

export default router;
