import { SellerStaffPermission } from ".prisma/client";
import { prisma } from "./prisma";

export const SELLER_STAFF_PERMISSIONS = [
  "VIEW_DASHBOARD",
  "MANAGE_PRODUCTS",
  "MANAGE_ORDERS",
  "MANAGE_AUCTIONS",
] as const satisfies readonly SellerStaffPermission[];

export type SellerStaffPermissionValue = (typeof SELLER_STAFF_PERMISSIONS)[number];

const sellerStaffAccessInclude = {
  sellerProfile: {
    select: {
      id: true,
      shopName: true,
      status: true,
      subscriptionPlan: true,
      subscriptionExpiresAt: true,
    },
  },
  user: {
    select: { id: true, email: true, name: true, avatar: true },
  },
} as const;

type SellerStaffAccessRecord = Awaited<ReturnType<typeof getActiveSellerStaffAccess>>;

export const normalizeStaffEmail = (email: string) => email.trim().toLowerCase();

export const formatSellerStaffAccess = (staff: NonNullable<SellerStaffAccessRecord>) => ({
  id: staff.id,
  sellerId: staff.sellerId,
  sellerProfileId: staff.sellerProfileId,
  shopName: staff.sellerProfile.shopName,
  permissions: staff.permissions,
  status: staff.status,
});

export const formatSellerStaffMember = (staff: NonNullable<SellerStaffAccessRecord>) => ({
  ...formatSellerStaffAccess(staff),
  userId: staff.userId,
  email: staff.email,
  name: staff.user.name,
  user: staff.user,
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt,
});

export const getActiveSellerStaffAccess = (userId: string) =>
  prisma.sellerStaff.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      sellerProfile: { status: "APPROVED" },
      seller: { isBanned: false },
    },
    include: sellerStaffAccessInclude,
    orderBy: { updatedAt: "desc" },
  });

export const appendSellerStaffAccess = async <T extends { id: string }>(user: T) => {
  const staffAccess = await getActiveSellerStaffAccess(user.id);
  return {
    ...user,
    sellerStaffAccess: staffAccess ? formatSellerStaffAccess(staffAccess) : null,
  };
};

export const getSellerOwnerContext = async (userId: string) => {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      sellerProfile: {
        select: {
          id: true,
          shopName: true,
          status: true,
          subscriptionPlan: true,
          subscriptionExpiresAt: true,
        },
      },
    },
  });

  if (!owner || owner.role !== "SELLER" || owner.sellerProfile?.status !== "APPROVED") return null;

  return {
    actorUserId: userId,
    sellerId: owner.id,
    sellerProfile: owner.sellerProfile,
    isOwner: true,
    isStaff: false,
    isAdmin: false,
    staffAccess: null,
  };
};

export const getSellerAccessContext = async (
  userId: string,
  permission?: SellerStaffPermissionValue
) => {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      sellerProfile: {
        select: {
          id: true,
          shopName: true,
          status: true,
          subscriptionPlan: true,
          subscriptionExpiresAt: true,
        },
      },
    },
  });

  if (!owner) return null;

  if (owner.role === "ADMIN") {
    return {
      actorUserId: userId,
      sellerId: userId,
      sellerProfile: owner.sellerProfile,
      isOwner: false,
      isStaff: false,
      isAdmin: true,
      staffAccess: null,
    };
  }

  if (owner.role === "SELLER" && owner.sellerProfile?.status === "APPROVED") {
    return {
      actorUserId: userId,
      sellerId: owner.id,
      sellerProfile: owner.sellerProfile,
      isOwner: true,
      isStaff: false,
      isAdmin: false,
      staffAccess: null,
    };
  }

  const staffAccess = await getActiveSellerStaffAccess(userId);
  if (!staffAccess) return null;
  if (permission && !staffAccess.permissions.includes(permission)) return null;

  return {
    actorUserId: userId,
    sellerId: staffAccess.sellerId,
    sellerProfile: staffAccess.sellerProfile,
    isOwner: false,
    isStaff: true,
    isAdmin: false,
    staffAccess,
  };
};
