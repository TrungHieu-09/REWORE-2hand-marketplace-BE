import { prisma } from "./prisma";

export type SellingUser = {
  id: string;
  role: string;
  sellerProfile: {
    id: string;
    shopName: string;
    status: string;
    subscriptionPlan: string;
    subscriptionExpiresAt: Date | null;
  } | null;
};

export const getSellingUser = (userId: string): Promise<SellingUser | null> =>
  prisma.user.findUnique({
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

export const canSell = (user: SellingUser | null): boolean =>
  Boolean(user && (user.role === "ADMIN" || (user.role === "SELLER" && user.sellerProfile?.status === "APPROVED")));

export const sellerBlockedResponse = (status?: string) => ({
  success: false,
  message: "Seller profile must be approved before selling",
  requiresSellerApproval: true,
  sellerStatus: status || "NONE",
});
