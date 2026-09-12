/**
 * Seed: tạo tài khoản SELLER để test
 * Chạy: npx tsx prisma/seed-seller.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "seller@rewore.com";
  const password = "seller123";

  // Xóa nếu đã tồn tại để tạo lại
  await prisma.user.deleteMany({ where: { email } });

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name: "Old Soul Studio",
      role: "SELLER",
      isVerified: true,
      reputation: 78,
      totalSales: 24,
      bio: "Curated vintage & archival fashion. Specializing in 70s-90s designer pieces.",
    },
  });

  console.log("\n✅ Seller account created!");
  console.log("─────────────────────────────");
  console.log(`   Email   : ${email}`);
  console.log(`   Password: ${password}`);
  console.log(`   Role    : ${user.role}`);
  console.log(`   ID      : ${user.id}`);
  console.log("─────────────────────────────\n");
}

main()
  .catch((e) => { console.error("❌ Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
