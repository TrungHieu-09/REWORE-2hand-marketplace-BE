import { prisma } from "./prisma";

export const PENDING_REGISTRATION_TTL_MINUTES = 6;

const getPendingRegistrationCutoff = (): Date =>
  new Date(Date.now() - PENDING_REGISTRATION_TTL_MINUTES * 60 * 1000);

export const cleanupExpiredPendingRegistrations = async (email?: string): Promise<number> => {
  const cutoff = getPendingRegistrationCutoff();
  const deleted = await prisma.user.deleteMany({
    where: {
      isVerified: false,
      createdAt: { lte: cutoff },
      ...(email && { email }),
      products: { none: {} },
      auctions: { none: {} },
      bids: { none: {} },
      ordersAsBuyer: { none: {} },
      ordersAsSeller: { none: {} },
      wishlistItems: { none: {} },
      reviews: { none: {} },
      reviewsReceived: { none: {} },
      emailOtps: {
        none: {
          usedAt: null,
          lastSentAt: { gt: cutoff },
        },
      },
    },
  });

  if (deleted.count > 0) {
    console.log(`[PENDING REGISTRATION CLEANUP] deleted=${deleted.count}${email ? ` email=${email}` : ""}`);
  }

  return deleted.count;
};

export const startPendingRegistrationCleanupJob = (): NodeJS.Timeout => {
  const interval = setInterval(() => {
    cleanupExpiredPendingRegistrations().catch((err) => {
      console.error("[PENDING REGISTRATION CLEANUP ERROR]", err);
    });
  }, 60 * 1000);

  interval.unref();
  return interval;
};
