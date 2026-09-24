DO $$ BEGIN
  CREATE TYPE "SellerSubscriptionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "seller_subscription_requests" (
  "id" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "plan" "SellerSubscriptionPlan" NOT NULL,
  "durationMonths" INTEGER NOT NULL DEFAULT 1,
  "amount" DOUBLE PRECISION,
  "paymentReference" TEXT,
  "note" TEXT,
  "status" "SellerSubscriptionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_subscription_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "seller_subscription_requests_sellerProfileId_idx" ON "seller_subscription_requests"("sellerProfileId");
CREATE INDEX IF NOT EXISTS "seller_subscription_requests_status_idx" ON "seller_subscription_requests"("status");
CREATE INDEX IF NOT EXISTS "seller_subscription_requests_reviewedBy_idx" ON "seller_subscription_requests"("reviewedBy");

DO $$ BEGIN
  ALTER TABLE "seller_subscription_requests" ADD CONSTRAINT "seller_subscription_requests_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "seller_subscription_requests" ADD CONSTRAINT "seller_subscription_requests_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
