-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('NONE', 'PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SellerApplicationStatus" AS ENUM ('PENDING_VERIFICATION', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SellerReportStatus" AS ENUM ('PENDING', 'VALID', 'DISMISSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "sellerStatus" "SellerStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "users" ADD COLUMN "sellerApprovedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "sellerSuspendedReason" TEXT;

-- CreateTable
CREATE TABLE "seller_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "idCardFrontImage" TEXT NOT NULL,
    "idCardBackImage" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "bankName" TEXT,
    "bankAccountNumber" TEXT NOT NULL,
    "bankAccountHolder" TEXT NOT NULL,
    "vietQr" TEXT,
    "sellingDescription" TEXT,
    "acceptedSellerTerms" BOOLEAN NOT NULL,
    "status" "SellerApplicationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "rejectionReason" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" "SellerReportStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_applications_userId_idx" ON "seller_applications"("userId");

-- CreateIndex
CREATE INDEX "seller_applications_status_idx" ON "seller_applications"("status");

-- CreateIndex
CREATE INDEX "seller_reports_reporterId_idx" ON "seller_reports"("reporterId");

-- CreateIndex
CREATE INDEX "seller_reports_sellerId_idx" ON "seller_reports"("sellerId");

-- CreateIndex
CREATE INDEX "seller_reports_status_idx" ON "seller_reports"("status");

-- AddForeignKey
ALTER TABLE "seller_applications" ADD CONSTRAINT "seller_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_reports" ADD CONSTRAINT "seller_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_reports" ADD CONSTRAINT "seller_reports_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
