import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getAuctionEligibility } from "../lib/auction-eligibility";
import { canSell, getSellingUser, sellerBlockedResponse } from "../lib/seller-permissions";
import {
  formatSellerStaffMember,
  getSellerAccessContext,
  getSellerOwnerContext,
  normalizeStaffEmail,
  SELLER_STAFF_PERMISSIONS,
} from "../lib/seller-staff";
import { removeSupabaseObjects, uploadToSupabase } from "../lib/supabase-storage";
import { authenticate } from "../middleware/auth.middleware";
import {
  getSellerIdentityUploadFiles,
  SellerIdentityUploadFiles,
  uploadSellerIdentityImages,
} from "../middleware/upload.middleware";

const router = Router();

const sellerApplicationSchema = z.object({
  shopName: z.string().trim().min(2, "Shop name is required"),
  legalName: z.string().trim().min(2, "Legal name is required"),
  phone: z.string().trim().min(6, "Phone is required"),
  pickupAddress: z.string().trim().min(10, "Pickup address for courier pickup is required"),
  bankName: z.string().trim().optional(),
  bankAccountNumber: z.string().trim().min(4, "Bank account number is required"),
  bankAccountHolder: z.string().trim().min(2, "Bank account holder is required"),
  vietQr: z.string().trim().optional(),
  sellingDescription: z.string().trim().optional(),
  acceptedSellerTerms: z.preprocess((value) => value === true || value === "true", z.literal(true)),
});

const normalizeApplicationBody = (body: Record<string, unknown>) => ({
  shopName: body.shopName ?? body.shop_name,
  legalName: body.legalName ?? body.legal_name,
  phone: body.phone,
  pickupAddress: body.pickupAddress ?? body.pickup_address,
  bankName: body.bankName ?? body.bank_name,
  bankAccountNumber: body.bankAccountNumber ?? body.bank_account_number,
  bankAccountHolder: body.bankAccountHolder ?? body.bank_account_holder,
  vietQr: body.vietQr ?? body.viet_qr,
  sellingDescription: body.sellingDescription ?? body.selling_description,
  acceptedSellerTerms: body.acceptedSellerTerms ?? body.accepted_seller_terms,
});

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const sellerProfileInclude = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      address: true,
      role: true,
      isVerified: true,
      createdAt: true,
    },
  },
  reviewedByAdmin: {
    select: { id: true, email: true, name: true },
  },
};

const PREMIUM_MONTHLY_PRICE = Number(process.env.PREMIUM_MONTHLY_PRICE || 75000);

const subscriptionRequestSchema = z.object({
  plan: z.enum(["PREMIUM"]).optional().default("PREMIUM"),
  durationMonths: z.coerce.number().int().min(1).max(12).optional().default(1),
  paymentReference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

const subscriptionRequestInclude = {
  sellerProfile: {
    select: {
      id: true,
      shopName: true,
      status: true,
      subscriptionPlan: true,
      subscriptionExpiresAt: true,
    },
  },
  reviewedByAdmin: {
    select: { id: true, email: true, name: true },
  },
};

const staffPermissionsSchema = z.array(z.enum(SELLER_STAFF_PERMISSIONS)).min(1, "At least one permission is required");

const grantStaffSchema = z.object({
  email: z.string().email("Email không hợp lệ"),
  permissions: staffPermissionsSchema,
});

router.use(authenticate);

const requireSellerOwner = async (req: Request, res: Response) => {
  const owner = await getSellerOwnerContext(req.user!.userId);
  if (!owner) {
    res.status(403).json({ success: false, message: "Only shop owner can manage staff" });
    return null;
  }
  return owner;
};

router.get("/staff", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owner = await requireSellerOwner(req, res);
    if (!owner) return;

    const staff = await prisma.sellerStaff.findMany({
      where: { sellerId: owner.sellerId },
      include: {
        sellerProfile: {
          select: {
            id: true,
            shopName: true,
            status: true,
            subscriptionPlan: true,
            subscriptionExpiresAt: true,
          },
        },
        user: { select: { id: true, email: true, name: true, avatar: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: staff.map(formatSellerStaffMember) });
  } catch (err) {
    next(err);
  }
});

router.post("/staff", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owner = await requireSellerOwner(req, res);
    if (!owner) return;

    const parsed = grantStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        message: parsed.error.flatten().fieldErrors.permissions ? "Invalid staff permission" : "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const email = normalizeStaffEmail(parsed.data.email);
    const permissions = [...new Set(parsed.data.permissions)];
    const staffUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, avatar: true, role: true },
    });

    if (!staffUser) {
      res.status(404).json({ success: false, message: "User with this email not found" });
      return;
    }

    if (staffUser.id === owner.sellerId) {
      res.status(400).json({ success: false, message: "Cannot add yourself as staff" });
      return;
    }

    if (staffUser.role === "ADMIN") {
      res.status(400).json({ success: false, message: "Cannot add admin as staff" });
      return;
    }

    const staff = await prisma.sellerStaff.upsert({
      where: {
        sellerId_userId: {
          sellerId: owner.sellerId,
          userId: staffUser.id,
        },
      },
      create: {
        sellerId: owner.sellerId,
        sellerProfileId: owner.sellerProfile.id,
        userId: staffUser.id,
        email: staffUser.email,
        permissions,
        status: "ACTIVE",
      },
      update: {
        email: staffUser.email,
        permissions,
        status: "ACTIVE",
      },
      include: {
        sellerProfile: {
          select: {
            id: true,
            shopName: true,
            status: true,
            subscriptionPlan: true,
            subscriptionExpiresAt: true,
          },
        },
        user: { select: { id: true, email: true, name: true, avatar: true } },
      },
    });

    res.status(201).json({
      success: true,
      message: "Staff access granted",
      data: formatSellerStaffMember(staff),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/staff/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const owner = await requireSellerOwner(req, res);
    if (!owner) return;

    const staffId = String(req.params.id);
    const result = await prisma.sellerStaff.updateMany({
      where: {
        id: staffId,
        sellerId: owner.sellerId,
      },
      data: { status: "REVOKED" },
    });

    if (result.count === 0) {
      res.status(404).json({ success: false, message: "Staff access not found" });
      return;
    }

    res.json({ success: true, message: "Staff access revoked" });
  } catch (err) {
    next(err);
  }
});

router.get("/auction-eligibility", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerAccess = await getSellerAccessContext(req.user!.userId, "MANAGE_AUCTIONS");
    if (!sellerAccess) {
      res.status(403).json({ success: false, message: "Không có quyền quản lý đấu giá" });
      return;
    }

    res.json({
      success: true,
      ...getAuctionEligibility(sellerAccess.sellerProfile, sellerAccess.isAdmin ? "ADMIN" : req.user!.role),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/application", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const application = await prisma.sellerProfile.findUnique({
      where: { userId: req.user!.userId },
      include: sellerProfileInclude,
    });

    if (!application) {
      res.status(404).json({ success: false, message: "Seller application not found" });
      return;
    }

    res.json({ success: true, application, sellerStatus: application.status });
  } catch (err) {
    next(err);
  }
});

router.get("/subscription", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerAccess = await getSellerAccessContext(req.user!.userId, "VIEW_DASHBOARD");
    if (!sellerAccess || !sellerAccess.sellerProfile) {
      res.status(403).json({ success: false, message: "Không có quyền xem dashboard seller" });
      return;
    }

    const pendingRequest = await prisma.sellerSubscriptionRequest.findFirst({
      where: {
        sellerProfileId: sellerAccess.sellerProfile.id,
        status: "PENDING",
      },
      include: subscriptionRequestInclude,
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      data: {
        plan: sellerAccess.sellerProfile.subscriptionPlan,
        subscriptionExpiresAt: sellerAccess.sellerProfile.subscriptionExpiresAt,
        monthlyFreeProductLimit: Number(process.env.FREE_MONTHLY_PRODUCT_LIMIT || 10),
        premiumMonthlyPrice: PREMIUM_MONTHLY_PRICE,
        pendingRequest,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/subscription-requests", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seller = await getSellingUser(req.user!.userId);
    if (!canSell(seller)) {
      res.status(403).json(sellerBlockedResponse(seller?.sellerProfile?.status));
      return;
    }

    const requests = await prisma.sellerSubscriptionRequest.findMany({
      where: { sellerProfileId: seller!.sellerProfile!.id },
      include: subscriptionRequestInclude,
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    res.json({ success: true, data: requests });
  } catch (err) {
    next(err);
  }
});

router.post("/subscription-requests", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seller = await getSellingUser(req.user!.userId);
    if (!canSell(seller)) {
      res.status(403).json(sellerBlockedResponse(seller?.sellerProfile?.status));
      return;
    }

    const parsed = subscriptionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Validation error", errors: parsed.error.flatten().fieldErrors });
      return;
    }

    const existingPending = await prisma.sellerSubscriptionRequest.findFirst({
      where: {
        sellerProfileId: seller!.sellerProfile!.id,
        status: "PENDING",
      },
      select: { id: true },
    });

    if (existingPending) {
      res.status(409).json({
        success: false,
        message: "You already have a pending Premium request",
        requestId: existingPending.id,
      });
      return;
    }

    const request = await prisma.sellerSubscriptionRequest.create({
      data: {
        sellerProfileId: seller!.sellerProfile!.id,
        plan: "PREMIUM",
        durationMonths: parsed.data.durationMonths,
        amount: parsed.data.durationMonths * PREMIUM_MONTHLY_PRICE,
        paymentReference: parsed.data.paymentReference,
        note: parsed.data.note,
      },
      include: subscriptionRequestInclude,
    });

    res.status(201).json({
      success: true,
      message: "Premium request submitted",
      data: request,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/application", uploadSellerIdentityImages, async (req: Request, res: Response, next: NextFunction) => {
  const uploadedFiles = req.files as SellerIdentityUploadFiles | undefined;
  const identityFiles = getSellerIdentityUploadFiles(uploadedFiles);
  const uploadedObjectPaths: string[] = [];

  const fail = async (status: number, payload: Record<string, unknown>) => {
    res.status(status).json(payload);
  };

  try {
    const parsed = sellerApplicationSchema.safeParse(normalizeApplicationBody(req.body));
    if (!parsed.success) {
      await fail(400, {
        success: false,
        message: "Validation error",
        errors: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    if (!identityFiles.idCardFrontFile || !identityFiles.idCardBackFile) {
      await fail(400, {
        success: false,
        message: "Validation error",
        errors: {
          idCardFrontImage: identityFiles.idCardFrontFile ? undefined : ["ID card front image is required"],
          idCardBackImage: identityFiles.idCardBackFile ? undefined : ["ID card back image is required"],
        },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { sellerProfile: true },
    });

    if (!user) {
      await fail(404, { success: false, message: "User not found" });
      return;
    }

    if (!user.isVerified) {
      await fail(403, {
        success: false,
        message: "Please verify your email before applying to become a seller",
        requiresOtp: true,
        email: user.email,
      });
      return;
    }

    if (normalizeName(parsed.data.bankAccountHolder) !== normalizeName(parsed.data.legalName)) {
      await fail(400, {
        success: false,
        message: "Bank account holder must match legal name on ID card",
      });
      return;
    }

    if (user.sellerProfile?.status === "PENDING") {
      await fail(409, {
        success: false,
        message: "Seller application is already pending verification",
        sellerStatus: "PENDING",
      });
      return;
    }

    if (user.sellerProfile?.status === "APPROVED") {
      await fail(409, {
        success: false,
        message: "Seller account already approved",
        sellerStatus: "APPROVED",
      });
      return;
    }

    if (user.sellerProfile?.status === "SUSPENDED") {
      await fail(403, {
        success: false,
        message: "Seller account is suspended",
        sellerStatus: "SUSPENDED",
      });
      return;
    }

    const idCardFrontAsset = await uploadToSupabase(identityFiles.idCardFrontFile, "id-cards", "seller-applications");
    uploadedObjectPaths.push(idCardFrontAsset.path);

    const idCardBackAsset = await uploadToSupabase(identityFiles.idCardBackFile, "id-cards", "seller-applications");
    uploadedObjectPaths.push(idCardBackAsset.path);

    const selfieAsset = identityFiles.selfieFile
      ? await uploadToSupabase(identityFiles.selfieFile, "id-cards", "seller-applications")
      : null;
    if (selfieAsset) uploadedObjectPaths.push(selfieAsset.path);

    const application = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: parsed.data.legalName,
          phone: parsed.data.phone,
          address: parsed.data.pickupAddress,
          role: "BUYER",
        },
      });

      const data = {
        shopName: parsed.data.shopName,
        idCardFrontUrl: idCardFrontAsset.path,
        idCardBackUrl: idCardBackAsset.path,
        selfieUrl: selfieAsset?.path || null,
        bankAccountName: parsed.data.bankAccountHolder,
        bankAccountNumber: parsed.data.bankAccountNumber,
        bankName: parsed.data.bankName || "Not provided",
        pickupAddress: parsed.data.pickupAddress,
        status: "PENDING" as const,
        rejectedReason: null,
        reviewedBy: null,
        reviewedAt: null,
      };

      const saved = user.sellerProfile
        ? await tx.sellerProfile.update({
            where: { userId: user.id },
            data,
            include: sellerProfileInclude,
          })
        : await tx.sellerProfile.create({
            data: { userId: user.id, ...data },
            include: sellerProfileInclude,
          });

      await tx.sellerStatusHistory.create({
        data: {
          sellerProfileId: saved.id,
          fromStatus: user.sellerProfile?.status ?? null,
          toStatus: "PENDING",
          actorId: user.id,
          reason: user.sellerProfile?.status === "REJECTED" ? "Seller resubmitted application" : "Seller submitted application",
        },
      });

      return saved;
    });

    res.status(201).json({
      success: true,
      message: "Seller application submitted and pending verification",
      sellerStatus: "PENDING",
      application,
    });
  } catch (err) {
    await removeSupabaseObjects("id-cards", uploadedObjectPaths);
    next(err);
  }
});

export default router;
