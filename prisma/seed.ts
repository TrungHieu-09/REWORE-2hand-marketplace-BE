import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const main = async () => {
  const email = process.env.ADMIN_EMAIL || "admin@rewore.local";
  const password = process.env.ADMIN_PASSWORD || "Admin@123456";
  const name = process.env.ADMIN_NAME || "REWORE Admin";

  const hashedPassword = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      name,
      role: "ADMIN",
      isVerified: true,
      isBanned: false,
      bannedReason: null,
      bannedAt: null,
    },
    create: {
      email,
      password: hashedPassword,
      name,
      role: "ADMIN",
      isVerified: true,
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`[SEED ADMIN] email=${admin.email} role=${admin.role}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("[SEED ADMIN WARNING] Using default ADMIN_PASSWORD=Admin@123456. Change it in .env for real deployments.");
  }
};

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
