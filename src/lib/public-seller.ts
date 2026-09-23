export const publicSellerSelect = {
  id: true,
  name: true,
  avatar: true,
  reputation: true,
  isVerified: true,
  sellerProfile: {
    select: {
      shopName: true,
      status: true,
    },
  },
} as const;

type SellerWithProfile = {
  name: string;
  sellerProfile?: {
    shopName: string;
    status: string;
  } | null;
  [key: string]: unknown;
};

export const formatPublicSeller = <T extends SellerWithProfile | null | undefined>(seller: T) => {
  if (!seller) return seller;

  const { sellerProfile, ...sellerData } = seller;
  const shopName = sellerProfile?.status === "APPROVED" ? sellerProfile.shopName : null;

  return {
    ...sellerData,
    accountName: sellerData.name,
    shopName,
    name: shopName || sellerData.name,
  };
};

export const formatProductSeller = <T extends { seller?: SellerWithProfile | null }>(product: T) => ({
  ...product,
  seller: formatPublicSeller(product.seller),
});
