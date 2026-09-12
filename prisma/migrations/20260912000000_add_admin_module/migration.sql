-- CreateEnum safely
DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "SellerProfileStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'PRODUCT', 'ORDER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReportResolutionAction" AS ENUM ('WARN', 'SUSPEND', 'DISMISS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Extend existing enums
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'HIDDEN';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'REMOVED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- Extend users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isBanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bannedReason" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bannedAt" TIMESTAMP(3);

-- Extend orders for manual transfer/VietQR flow
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "qrCodeRef" TEXT;

UPDATE "orders"
SET "paymentStatus" = 'PAID'
WHERE "status" IN ('PAID', 'SHIPPED', 'DELIVERED') AND "paymentStatus" = 'UNPAID';

UPDATE "orders"
SET "paymentStatus" = 'REFUNDED'
WHERE "status" = 'REFUNDED';

-- Seller profiles
CREATE TABLE IF NOT EXISTS "seller_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "shopName" TEXT NOT NULL,
  "idCardFrontUrl" TEXT NOT NULL,
  "idCardBackUrl" TEXT NOT NULL,
  "selfieUrl" TEXT,
  "bankAccountName" TEXT NOT NULL,
  "bankAccountNumber" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "pickupAddress" TEXT NOT NULL,
  "status" "SellerProfileStatus" NOT NULL DEFAULT 'PENDING',
  "rejectedReason" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "seller_profiles_userId_key" ON "seller_profiles"("userId");
CREATE INDEX IF NOT EXISTS "seller_profiles_status_idx" ON "seller_profiles"("status");
CREATE INDEX IF NOT EXISTS "seller_profiles_reviewedBy_idx" ON "seller_profiles"("reviewedBy");

DO $$ BEGIN
  ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Seller status history
CREATE TABLE IF NOT EXISTS "seller_status_history" (
  "id" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "fromStatus" "SellerProfileStatus",
  "toStatus" "SellerProfileStatus" NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "seller_status_history_sellerProfileId_idx" ON "seller_status_history"("sellerProfileId");
CREATE INDEX IF NOT EXISTS "seller_status_history_actorId_idx" ON "seller_status_history"("actorId");

DO $$ BEGIN
  ALTER TABLE "seller_status_history" ADD CONSTRAINT "seller_status_history_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "seller_status_history" ADD CONSTRAINT "seller_status_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Reports
CREATE TABLE IF NOT EXISTS "reports" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetType" "ReportTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionAction" "ReportResolutionAction",
  "resolutionNote" TEXT,
  "resolvedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reports_reporterId_idx" ON "reports"("reporterId");
CREATE INDEX IF NOT EXISTS "reports_targetType_targetId_idx" ON "reports"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "reports_status_idx" ON "reports"("status");

DO $$ BEGIN
  ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "reports" ADD CONSTRAINT "reports_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Admin audit log
CREATE TABLE IF NOT EXISTS "admin_action_logs" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_action_logs_adminId_idx" ON "admin_action_logs"("adminId");
CREATE INDEX IF NOT EXISTS "admin_action_logs_targetType_targetId_idx" ON "admin_action_logs"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "admin_action_logs_actionType_idx" ON "admin_action_logs"("actionType");

DO $$ BEGIN
  ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Cleanup legacy seller-onboarding experiment from 20260911010000.
-- The admin module now uses seller_profiles, reports, and admin_action_logs.
DROP TABLE IF EXISTS "seller_reports";
DROP TABLE IF EXISTS "seller_applications";
ALTER TABLE "users" DROP COLUMN IF EXISTS "sellerStatus";
ALTER TABLE "users" DROP COLUMN IF EXISTS "sellerApprovedAt";
ALTER TABLE "users" DROP COLUMN IF EXISTS "sellerSuspendedReason";
DROP TYPE IF EXISTS "SellerReportStatus";
DROP TYPE IF EXISTS "SellerApplicationStatus";
DROP TYPE IF EXISTS "SellerStatus";
