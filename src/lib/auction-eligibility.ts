type SellerSubscriptionProfile = {
  subscriptionPlan: string;
  subscriptionExpiresAt: Date | null;
} | null;

export const PREMIUM_SELLER_PLAN = "PREMIUM";

export const isPremiumSellerSubscriptionActive = (
  sellerProfile: SellerSubscriptionProfile,
  now = new Date()
) =>
  sellerProfile?.subscriptionPlan === PREMIUM_SELLER_PLAN &&
  (!sellerProfile.subscriptionExpiresAt || sellerProfile.subscriptionExpiresAt > now);

export const getAuctionEligibility = (sellerProfile: SellerSubscriptionProfile, role?: string) => {
  const adminBypass = role === "ADMIN";
  const subscriptionActive = isPremiumSellerSubscriptionActive(sellerProfile);
  const eligible = adminBypass || subscriptionActive;

  return {
    eligible,
    requiredPlan: PREMIUM_SELLER_PLAN,
    currentPlan: adminBypass ? PREMIUM_SELLER_PLAN : sellerProfile?.subscriptionPlan || "FREE",
    subscriptionActive: adminBypass ? true : subscriptionActive,
    subscriptionExpiresAt: adminBypass ? null : sellerProfile?.subscriptionExpiresAt || null,
  };
};
