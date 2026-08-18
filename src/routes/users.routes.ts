import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Mock data store (replace with Prisma)
const users: Array<Record<string, unknown>> = [];

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  bio: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  avatar: z.string().url().optional(),
});

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: Lấy danh sách người dùng (Admin only)
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
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm theo tên hoặc email
 *     responses:
 *       200:
 *         description: Danh sách users
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
 *                     $ref: '#/components/schemas/User'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 */
router.get("/", authenticate, (_req: Request, res: Response) => {
  // TODO: Add admin role check + Prisma query
  res.json({ success: true, data: users, meta: { total: users.length, page: 1, limit: 10, totalPages: 1 } });
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
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       404:
 *         description: User không tìm thấy
 */
router.get("/:id", (req: Request, res: Response) => {
  const user = users.find((u) => u["id"] === req.params.id);
  if (!user) {
    res.status(404).json({ success: false, message: "User không tìm thấy" });
    return;
  }
  res.json({ success: true, data: user });
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
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               bio:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               avatar:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 *       403:
 *         description: Không có quyền cập nhật
 */
router.put("/:id", authenticate, (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user!.userId !== req.params.id && req.user!.role !== "ADMIN") {
      res.status(403).json({ success: false, message: "Không có quyền cập nhật profile này" });
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    // TODO: Prisma update
    res.json({ success: true, message: "Cập nhật thành công", data: { id: req.params.id, ...parsed.data } });
  } catch (err) {
    next(err);
  }
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
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Xóa thành công
 *       403:
 *         description: Không có quyền
 */
router.delete("/:id", authenticate, (req: Request, res: Response) => {
  if (req.user!.role !== "ADMIN") {
    res.status(403).json({ success: false, message: "Chỉ Admin mới có quyền xóa user" });
    return;
  }
  // TODO: Prisma delete
  res.json({ success: true, message: `User ${req.params.id} đã được xóa` });
});

export default router;
