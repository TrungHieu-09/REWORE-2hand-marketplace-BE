CREATE TYPE "SellerStaffPermission" AS ENUM (
  'VIEW_DASHBOARD',
  'MANAGE_PRODUCTS',
  'MANAGE_ORDERS',
  'MANAGE_AUCTIONS'
);

CREATE TYPE "SellerStaffStatus" AS ENUM (
  'ACTIVE',
  'REVOKED'
);

CREATE TABLE "seller_staff" (
  "id" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "permissions" "SellerStaffPermission"[] NOT NULL,
  "status" "SellerStaffStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "seller_staff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_staff_sellerId_userId_key" ON "seller_staff"("sellerId", "userId");
CREATE INDEX "seller_staff_sellerProfileId_idx" ON "seller_staff"("sellerProfileId");
CREATE INDEX "seller_staff_userId_status_idx" ON "seller_staff"("userId", "status");
CREATE INDEX "seller_staff_sellerId_status_idx" ON "seller_staff"("sellerId", "status");

ALTER TABLE "seller_staff"
  ADD CONSTRAINT "seller_staff_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seller_staff"
  ADD CONSTRAINT "seller_staff_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seller_staff"
  ADD CONSTRAINT "seller_staff_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
