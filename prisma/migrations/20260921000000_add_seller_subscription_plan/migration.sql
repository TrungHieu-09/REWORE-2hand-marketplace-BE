DO $$ BEGIN
  CREATE TYPE "SellerSubscriptionPlan" AS ENUM ('FREE', 'PREMIUM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "seller_profiles"
  ADD COLUMN IF NOT EXISTS "subscription_plan" "SellerSubscriptionPlan" NOT NULL DEFAULT 'FREE',
  ADD COLUMN IF NOT EXISTS "subscription_expires_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "seller_profiles_subscription_plan_idx" ON "seller_profiles"("subscription_plan");
