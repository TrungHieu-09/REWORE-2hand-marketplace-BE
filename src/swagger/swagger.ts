import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "REWORE Marketplace API",
      version: "1.0.0",
      description: `
## REWORE - 2nd Hand Marketplace API

Nền tảng mua bán đồ cũ kết hợp đấu giá trực tuyến.

### Authentication
Hầu hết các endpoint yêu cầu **Bearer JWT Token**.
1. Đăng ký tài khoản qua \`POST /api/auth/register\`
2. Xác thực OTP qua \`POST /api/auth/verify-otp\` để nhận token
3. Đăng nhập qua \`POST /api/auth/login\` cho các lần sau
4. Click **Authorize** và nhập \`Bearer <token>\`
      `,
      contact: {
        name: "REWORE Dev Team",
        email: "dev@rewore.vn",
      },
      license: {
        name: "ISC",
      },
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Local Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Nhập JWT token nhận được sau khi đăng nhập",
        },
      },
      schemas: {
        // ── Common ──────────────────────────────────────────────────────────
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            message: { type: "string" },
            errors: { type: "object" },
          },
        },
        PaginationMeta: {
          type: "object",
          properties: {
            total: { type: "integer", example: 100 },
            page: { type: "integer", example: 1 },
            limit: { type: "integer", example: 10 },
            totalPages: { type: "integer", example: 10 },
          },
        },
        // ── User ────────────────────────────────────────────────────────────
        User: {
          type: "object",
          properties: {
            id: { type: "string", example: "clxyz123" },
            email: { type: "string", format: "email", example: "user@example.com" },
            name: { type: "string", example: "Nguyễn Văn A" },
            avatar: { type: "string", nullable: true },
            bio: { type: "string", nullable: true },
            phone: { type: "string", nullable: true },
            address: { type: "string", nullable: true },
            role: { type: "string", enum: ["BUYER", "SELLER", "ADMIN"] },
            reputation: { type: "number", example: 4.8 },
            totalSales: { type: "integer", example: 24 },
            totalBids: { type: "integer", example: 56 },
            isVerified: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        RegisterBody: {
          type: "object",
          required: ["email", "password", "name"],
          properties: {
            email: { type: "string", format: "email", example: "user@example.com" },
            password: { type: "string", minLength: 6, example: "Password123" },
            name: { type: "string", example: "Nguyễn Văn A" },
          },
        },
        VerifyOtpBody: {
          type: "object",
          required: ["email", "otp"],
          properties: {
            email: { type: "string", format: "email", example: "user@example.com" },
            otp: { type: "string", minLength: 6, maxLength: 6, example: "123456" },
          },
        },
        ResendOtpBody: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", example: "user@example.com" },
          },
        },
        OtpRequiredResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "OTP sent to email" },
            email: { type: "string", format: "email", example: "user@example.com" },
            requiresOtp: { type: "boolean", example: true },
          },
        },
        LoginBody: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", example: "user@example.com" },
            password: { type: "string", example: "Password123" },
          },
        },
        AuthResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
            user: { $ref: "#/components/schemas/User" },
          },
        },
        // ── Product ─────────────────────────────────────────────────────────
        Product: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string", example: "Áo khoác vintage Levi's" },
            description: { type: "string" },
            price: { type: "number", example: 350000 },
            images: { type: "array", items: { type: "string" } },
            category: { type: "string", example: "Clothing" },
            condition: {
              type: "string",
              enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"],
            },
            status: {
              type: "string",
              enum: ["ACTIVE", "SOLD", "AUCTION", "INACTIVE"],
            },
            brand: { type: "string", nullable: true },
            size: { type: "string", nullable: true },
            color: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            viewCount: { type: "integer" },
            sellerId: { type: "string" },
            seller: { $ref: "#/components/schemas/User" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CreateProductBody: {
          type: "object",
          required: ["title", "description", "price", "category", "condition"],
          properties: {
            title: { type: "string", example: "Áo khoác vintage Levi's" },
            description: { type: "string", example: "Áo khoác chính hãng, còn rất đẹp" },
            price: { type: "number", example: 350000 },
            images: { type: "array", items: { type: "string" } },
            category: { type: "string", example: "Clothing" },
            condition: {
              type: "string",
              enum: ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"],
              example: "LIKE_NEW",
            },
            brand: { type: "string", example: "Levi's" },
            size: { type: "string", example: "M" },
            color: { type: "string", example: "Blue" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
        // ── Auction ─────────────────────────────────────────────────────────
        Auction: {
          type: "object",
          properties: {
            id: { type: "string" },
            productId: { type: "string" },
            sellerId: { type: "string" },
            startPrice: { type: "number", example: 100000 },
            currentBid: { type: "number", example: 250000 },
            minIncrement: { type: "number", example: 10000 },
            startTime: { type: "string", format: "date-time" },
            endTime: { type: "string", format: "date-time" },
            status: {
              type: "string",
              enum: ["UPCOMING", "LIVE", "ENDED", "CANCELLED"],
            },
            product: { $ref: "#/components/schemas/Product" },
            seller: { $ref: "#/components/schemas/User" },
            bidsCount: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CreateAuctionBody: {
          type: "object",
          required: ["productId", "startPrice", "startTime", "endTime"],
          properties: {
            productId: { type: "string" },
            startPrice: { type: "number", example: 100000 },
            minIncrement: { type: "number", example: 10000 },
            startTime: { type: "string", format: "date-time", example: "2026-08-20T10:00:00Z" },
            endTime: { type: "string", format: "date-time", example: "2026-08-20T12:00:00Z" },
          },
        },
        // ── Bid ─────────────────────────────────────────────────────────────
        Bid: {
          type: "object",
          properties: {
            id: { type: "string" },
            auctionId: { type: "string" },
            bidderId: { type: "string" },
            amount: { type: "number", example: 300000 },
            isWinning: { type: "boolean" },
            bidder: { $ref: "#/components/schemas/User" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        PlaceBidBody: {
          type: "object",
          required: ["auctionId", "amount"],
          properties: {
            auctionId: { type: "string" },
            amount: { type: "number", example: 300000 },
          },
        },
        // ── Order ────────────────────────────────────────────────────────────
        Order: {
          type: "object",
          properties: {
            id: { type: "string" },
            buyerId: { type: "string" },
            sellerId: { type: "string" },
            productId: { type: "string", nullable: true },
            auctionId: { type: "string", nullable: true },
            totalPrice: { type: "number" },
            shippingFee: { type: "number" },
            status: {
              type: "string",
              enum: ["PENDING", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"],
            },
            shippingAddress: { type: "string", nullable: true },
            note: { type: "string", nullable: true },
            product: { $ref: "#/components/schemas/Product" },
            buyer: { $ref: "#/components/schemas/User" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        // ── WishlistItem ─────────────────────────────────────────────────────
        WishlistItem: {
          type: "object",
          properties: {
            id: { type: "string" },
            userId: { type: "string" },
            productId: { type: "string" },
            product: { $ref: "#/components/schemas/Product" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Đăng ký & Đăng nhập" },
      { name: "Users", description: "Quản lý người dùng" },
      { name: "Products", description: "Quản lý sản phẩm" },
      { name: "Auctions", description: "Quản lý phiên đấu giá" },
      { name: "Bids", description: "Đặt bid & lịch sử đấu giá" },
      { name: "Orders", description: "Quản lý đơn hàng" },
      { name: "Wishlist", description: "Danh sách yêu thích" },
      { name: "Health", description: "Server health check" },
    ],
  },
  apis: ["./src/routes/*.ts", "./src/index.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
