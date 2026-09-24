import "dotenv/config";
import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger/swagger";

// Routes
import authRoutes from "./routes/auth.routes";
import usersRoutes from "./routes/users.routes";
import productsRoutes from "./routes/products.routes";
import auctionsRoutes from "./routes/auctions.routes";
import bidsRoutes from "./routes/bids.routes";
import ordersRoutes from "./routes/orders.routes";
import wishlistRoutes from "./routes/wishlist.routes";
import cartRoutes from "./routes/cart.routes";
import reportsRoutes from "./routes/reports.routes";
import adminRoutes from "./routes/admin.routes";
import sellerRoutes from "./routes/seller.routes";
import { startPendingRegistrationCleanupJob } from "./lib/pending-registration-cleanup";

// Middleware
import { errorHandler } from "./middleware/error.middleware";

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Core Middleware ───────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "production") {
  app.use("/api/auth", (req, _res, next) => {
    console.log(`[AUTH REQUEST] ${req.method} ${req.originalUrl}`);
    next();
  });
}

// ─── Swagger UI ────────────────────────────────────────────────────────────────
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: `
      .swagger-ui .topbar { background-color: #974226; }
      .swagger-ui .topbar-wrapper img { content: url('https://via.placeholder.com/120x40?text=REWORE'); }
      .swagger-ui .info .title { color: #231a11; }
    `,
    customSiteTitle: "REWORE API Docs",
    swaggerOptions: {
      persistAuthorization: true,
    },
  })
);

// Redirect /api-docs (no trailing slash) handled above, also expose JSON spec
app.get("/api-docs.json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ─── Health Check ──────────────────────────────────────────────────────────────
/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Server is running
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/auctions", auctionsRoutes);
app.use("/api/bids", bidsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/admin", adminRoutes);
app.use("/api/admin", adminRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
startPendingRegistrationCleanupJob();

app.listen(PORT, () => {
  console.log(`\n🚀 REWORE Server running on http://localhost:${PORT}`);
  console.log(`📚 Swagger UI available at http://localhost:${PORT}/api-docs\n`);
});

export default app;
