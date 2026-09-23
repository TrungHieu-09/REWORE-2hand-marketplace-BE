import { prisma } from "./prisma";

let auctionCloserTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Đóng tất cả các phiên đấu giá đã hết thời gian.
 * - Cập nhật status LIVE → ENDED
 * - Nếu có winning bid → tạo Order cho winner
 * - Nếu không có bid nào → trả product về ACTIVE
 */
export async function closeEndedAuctions(): Promise<void> {
  const now = new Date();

  // Lấy tất cả phiên LIVE đã hết giờ
  const expiredAuctions = await prisma.auction.findMany({
    where: { status: "LIVE", endTime: { lte: now } },
    include: {
      product: true,
      bids: {
        where: { isWinning: true },
        orderBy: { amount: "desc" },
        take: 1,
      },
    },
  });

  if (expiredAuctions.length === 0) return;

  console.log(`[AUCTION CLOSER] Found ${expiredAuctions.length} expired auction(s) to close.`);

  for (const auction of expiredAuctions) {
    try {
      await prisma.$transaction(async (tx) => {
        const winningBid = auction.bids[0] ?? null;

        // Cập nhật auction → ENDED, lưu winner
        await tx.auction.update({
          where: { id: auction.id },
          data: {
            status: "ENDED",
            winnerId: winningBid?.bidderId ?? null,
          },
        });

        if (winningBid) {
          // Tạo Order cho winner
          await tx.order.create({
            data: {
              buyerId: winningBid.bidderId,
              sellerId: auction.sellerId,
              productId: auction.productId,
              auctionId: auction.id,
              totalPrice: winningBid.amount,
              shippingFee: 0,
              status: "PENDING",
              paymentStatus: "UNPAID",
            },
          });

          // Đánh dấu sản phẩm là INACTIVE cho đến khi delivered
          await tx.product.update({
            where: { id: auction.productId },
            data: { status: "INACTIVE" },
          });

          console.log(
            `[AUCTION CLOSER] Auction ${auction.id} ENDED — winner: ${winningBid.bidderId}, amount: ${winningBid.amount}`
          );
        } else {
          // Không có ai bid → trả product về ACTIVE
          await tx.product.update({
            where: { id: auction.productId },
            data: { status: "ACTIVE" },
          });

          console.log(`[AUCTION CLOSER] Auction ${auction.id} ENDED — no bids, product restored to ACTIVE.`);
        }
      });
    } catch (err) {
      console.error(`[AUCTION CLOSER] Failed to close auction ${auction.id}:`, err);
    }
  }
}

/**
 * Đồng thời chuyển các phiên UPCOMING đã tới giờ bắt đầu sang LIVE.
 */
export async function activateUpcomingAuctions(): Promise<void> {
  const now = new Date();

  const result = await prisma.auction.updateMany({
    where: { status: "UPCOMING", startTime: { lte: now } },
    data: { status: "LIVE" },
  });

  if (result.count > 0) {
    console.log(`[AUCTION CLOSER] Activated ${result.count} auction(s) from UPCOMING → LIVE.`);
  }
}

/**
 * Khởi động cron job chạy mỗi phút để:
 * 1. Kích hoạt phiên UPCOMING → LIVE
 * 2. Đóng phiên LIVE đã hết giờ
 */
export function startAuctionCloserJob(): void {
  if (auctionCloserTimer) return; // Tránh khởi động 2 lần

  const runTick = async () => {
    try {
      await activateUpcomingAuctions();
      await closeEndedAuctions();
    } catch (err) {
      console.error("[AUCTION CLOSER] Tick error:", err);
    }
  };

  // Chạy ngay khi khởi động
  runTick();

  // Sau đó mỗi 60 giây
  auctionCloserTimer = setInterval(runTick, 60_000);
  console.log("[AUCTION CLOSER] Started — running every 60s.");
}

export function stopAuctionCloserJob(): void {
  if (auctionCloserTimer) {
    clearInterval(auctionCloserTimer);
    auctionCloserTimer = null;
    console.log("[AUCTION CLOSER] Stopped.");
  }
}
