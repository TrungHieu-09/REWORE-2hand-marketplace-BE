DO $$
BEGIN
  CREATE TYPE "ProductAvailabilityStatus" AS ENUM ('upcoming_drop', 'available', 'held', 'sold');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;
UPDATE "products" SET "quantity" = 1 WHERE "quantity" IS NULL OR "quantity" <> 1;
ALTER TABLE "products" ALTER COLUMN "quantity" SET DEFAULT 1;
ALTER TABLE "products" ALTER COLUMN "quantity" SET NOT NULL;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "availability_status" "ProductAvailabilityStatus";
UPDATE "products" SET "availability_status" = 'available' WHERE "availability_status" IS NULL;
ALTER TABLE "products" ALTER COLUMN "availability_status" SET DEFAULT 'available';
ALTER TABLE "products" ALTER COLUMN "availability_status" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_quantity_one_check" CHECK ("quantity" = 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
