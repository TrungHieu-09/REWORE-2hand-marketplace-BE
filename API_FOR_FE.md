# REWORE Backend API cho FE

Base URL local: `http://localhost:3001`

Swagger UI: `GET http://localhost:3001/api-docs`

Swagger JSON: `GET http://localhost:3001/api-docs.json`

## Quy uoc chung

- Body gui dang JSON: `Content-Type: application/json`.
- Cac API can dang nhap gui header:

```http
Authorization: Bearer <token>
```

- Response thanh cong thuong co dang:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "total": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 0
  }
}
```

- Response loi thuong co dang:

```json
{
  "success": false,
  "message": "Validation error",
  "errors": {}
}
```

- Phan trang: `page` mac dinh `1`, `limit` tuy API mac dinh `10` hoac `12`, backend gioi han toi da `50`.

## Enums

```ts
type Role = "BUYER" | "SELLER" | "ADMIN";

type ProductStatus = "ACTIVE" | "SOLD" | "AUCTION" | "INACTIVE";

type ProductCondition = "NEW" | "LIKE_NEW" | "GOOD" | "FAIR" | "POOR";

type AuctionStatus = "UPCOMING" | "LIVE" | "ENDED" | "CANCELLED";

type OrderStatus = "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "REFUNDED";
```

## Health

### `GET /health`

Public. Kiem tra server.

Response:

```json
{
  "status": "ok",
  "timestamp": "2026-09-05T00:00:00.000Z"
}
```

## Auth

### `POST /api/auth/register`

Public. Dang ky tai khoan moi va gui OTP email. Endpoint nay khong login ngay, khong tra token.

Body:

```json
{
  "email": "user@example.com",
  "password": "Password123",
  "name": "Nguyen Van A"
}
```

Validate:

- `email`: dung format email
- `password`: toi thieu 6 ky tu
- `name`: toi thieu 2 ky tu

Response `201`:

```json
{
  "success": true,
  "message": "OTP sent to email",
  "email": "user@example.com",
  "requiresOtp": true
}
```

Loi hay gap:

- `400` neu email da duoc verify va da ton tai, hoac body sai.
- `429` neu dang ky lai email chua verify nhung vua gui OTP trong vong 60 giay.

Response `429`:

```json
{
  "success": false,
  "message": "Please wait before requesting another OTP",
  "retryAfter": 42,
  "requiresOtp": true,
  "email": "user@example.com"
}
```

### `POST /api/auth/verify-otp`

Public. Xac thuc OTP sau dang ky. Neu thanh cong thi FE luu token va coi nhu user da login.

Body:

```json
{
  "email": "user@example.com",
  "otp": "123456"
}
```

Validate:

- `email`: dung format email
- `otp`: chuoi gom dung 6 chu so

Response `200`:

```json
{
  "success": true,
  "token": "jwt-token",
  "user": {
    "id": "userId",
    "email": "user@example.com",
    "name": "Nguyen Van A",
    "avatar": null,
    "bio": null,
    "phone": null,
    "address": null,
    "role": "BUYER",
    "reputation": 0,
    "totalSales": 0,
    "totalBids": 0,
    "isVerified": true,
    "createdAt": "2026-09-05T00:00:00.000Z",
    "updatedAt": "2026-09-05T00:00:00.000Z"
  }
}
```

Loi hay gap:

- `400` validation, OTP sai, OTP het han, OTP da dung, hoac vuot qua 5 lan nhap sai.

Response loi OTP:

```json
{
  "success": false,
  "message": "Invalid or expired OTP"
}
```

### `POST /api/auth/resend-otp`

Public. Gui lai OTP cho email chua verify. De tranh leak email, neu email khong ton tai hoac da verify thi backend van tra success va khong gui OTP.

Body:

```json
{
  "email": "user@example.com"
}
```

Response `200`:

```json
{
  "success": true,
  "message": "OTP resent"
}
```

Response `429` neu goi lai qua nhanh:

```json
{
  "success": false,
  "message": "Please wait before requesting another OTP",
  "retryAfter": 42,
  "requiresOtp": true,
  "email": "user@example.com"
}
```

Response `410` neu pending registration da qua 6 phut va BE da xoa user chua verify:

```json
{
  "success": false,
  "message": "OTP expired. Please register again",
  "requiresRegister": true,
  "email": "user@example.com"
}
```

### `POST /api/auth/login`

Public. Dang nhap va lay JWT.

Body:

```json
{
  "email": "user@example.com",
  "password": "Password123"
}
```

Response `200`:

```json
{
  "success": true,
  "token": "jwt-token",
  "user": {
    "id": "userId",
    "email": "user@example.com",
    "name": "Nguyen Van A",
    "role": "BUYER"
  }
}
```

Loi hay gap: `400` validation, `401` sai email/mat khau.

Response `403` neu email/password dung nhung user chua verify email:

```json
{
  "success": false,
  "message": "Please verify your email before logging in",
  "requiresOtp": true,
  "email": "user@example.com"
}
```

### `GET /api/auth/me`

Auth required. Lay thong tin user hien tai tu token.

Response:

```json
{
  "success": true,
  "user": {
    "id": "userId",
    "email": "user@example.com",
    "name": "Nguyen Van A",
    "avatar": null,
    "bio": null,
    "phone": null,
    "address": null,
    "role": "BUYER",
    "reputation": 0,
    "totalSales": 0,
    "totalBids": 0,
    "isVerified": false,
    "createdAt": "2026-09-05T00:00:00.000Z"
  }
}
```

### `POST /api/auth/logout`

Auth required. Backend khong blacklist token; FE chi can xoa token o client.

Response:

```json
{
  "success": true,
  "message": "Dang xuat thanh cong. Vui long xoa token phia client."
}
```

## Users

### `GET /api/users`

Auth required. Lay danh sach user.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `page` | number | `1` | Trang |
| `limit` | number | `10` | Toi da `50` |
| `search` | string | | Tim theo `name` hoac `email` |

Response:

```json
{
  "success": true,
  "data": [],
  "meta": {
    "total": 0,
    "page": 1,
    "limit": 10,
    "totalPages": 0
  }
}
```

### `GET /api/users/:id`

Public. Lay profile cua mot user.

Response:

```json
{
  "success": true,
  "data": {
    "id": "userId",
    "email": "user@example.com",
    "name": "Nguyen Van A",
    "avatar": null,
    "bio": null,
    "phone": null,
    "address": null,
    "role": "BUYER",
    "reputation": 0,
    "totalSales": 0,
    "totalBids": 0,
    "isVerified": false,
    "createdAt": "2026-09-05T00:00:00.000Z"
  }
}
```

### `PUT /api/users/:id`

Auth required. Chi chinh user cua minh, hoac `ADMIN`.

Body, tat ca field optional:

```json
{
  "name": "Nguyen Van B",
  "bio": "Mo ta ngan",
  "phone": "0900000000",
  "address": "HCM",
  "avatar": "https://example.com/avatar.png"
}
```

### `DELETE /api/users/:id`

Auth required. Chi `ADMIN`.

Response:

```json
{
  "success": true,
  "message": "User userId da duoc xoa"
}
```

## Products

### `GET /api/products`

Public. Lay danh sach san pham dang ban. Luu y backend chi tra ve product co `status = ACTIVE`; product dang dau gia co `status = AUCTION` se nam ben `/api/auctions`.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `page` | number | `1` | Trang |
| `limit` | number | `12` | Toi da `50` |
| `category` | string | | Loc theo category |
| `condition` | enum | | `NEW`, `LIKE_NEW`, `GOOD`, `FAIR`, `POOR` |
| `minPrice` | number | | Gia tu |
| `maxPrice` | number | | Gia den |
| `search` | string | | Tim trong `title`, `description`, `brand` |
| `sellerId` | string | | Loc theo nguoi ban |
| `sortBy` | enum | `newest` | `price_asc`, `price_desc`, `newest`, `popular` |

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "productId",
      "title": "Ao khoac vintage",
      "description": "Mo ta san pham",
      "price": 350000,
      "images": ["https://example.com/image.jpg"],
      "category": "Clothing",
      "condition": "LIKE_NEW",
      "status": "ACTIVE",
      "brand": "Levi's",
      "size": "M",
      "color": "Blue",
      "tags": ["vintage"],
      "viewCount": 0,
      "sellerId": "sellerId",
      "seller": {
        "id": "sellerId",
        "name": "Seller",
        "avatar": null,
        "reputation": 0,
        "isVerified": false
      },
      "_count": {
        "wishlistItems": 0
      },
      "createdAt": "2026-09-05T00:00:00.000Z",
      "updatedAt": "2026-09-05T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 12,
    "totalPages": 1
  }
}
```

### `GET /api/products/:id`

Public. Lay chi tiet san pham. Moi lan goi API nay backend tang `viewCount` len 1.

Response co them field `auction` neu san pham co phien dau gia.

### `POST /api/products`

Auth required. Tao san pham moi. Backend tu lay `sellerId` tu token.

Body:

```json
{
  "title": "Ao khoac vintage Levi's",
  "description": "Ao khoac chinh hang, con rat dep",
  "price": 350000,
  "category": "Clothing",
  "condition": "LIKE_NEW",
  "images": ["https://example.com/image.jpg"],
  "brand": "Levi's",
  "size": "M",
  "color": "Blue",
  "tags": ["vintage", "jacket"]
}
```

Required: `title`, `description`, `price`, `category`, `condition`.

Validate:

- `title`: toi thieu 3 ky tu
- `description`: toi thieu 10 ky tu
- `price`: so duong
- `condition`: `NEW`, `LIKE_NEW`, `GOOD`, `FAIR`, `POOR`

### `PUT /api/products/:id`

Auth required. Chi chu san pham hoac `ADMIN`.

Body giong create product nhung tat ca field optional.

### `DELETE /api/products/:id`

Auth required. Chi chu san pham hoac `ADMIN`.

Response:

```json
{
  "success": true,
  "message": "San pham da duoc xoa"
}
```

## Auctions

### `GET /api/auctions`

Public. Lay danh sach phien dau gia.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `page` | number | `1` | Trang |
| `limit` | number | `10` | Toi da `50` |
| `status` | enum | | `UPCOMING`, `LIVE`, `ENDED`, `CANCELLED` |
| `category` | string | | Loc theo category cua product |

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "auctionId",
      "productId": "productId",
      "sellerId": "sellerId",
      "startPrice": 100000,
      "currentBid": 100000,
      "minIncrement": 10000,
      "startTime": "2026-09-05T10:00:00.000Z",
      "endTime": "2026-09-05T12:00:00.000Z",
      "status": "LIVE",
      "winnerId": null,
      "product": {},
      "seller": {},
      "_count": {
        "bids": 0
      },
      "createdAt": "2026-09-05T00:00:00.000Z",
      "updatedAt": "2026-09-05T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

### `GET /api/auctions/:id`

Public. Lay chi tiet phien dau gia. Response co them `bids`, lay toi da 10 bid moi nhat, moi bid include `bidder`.

### `POST /api/auctions`

Auth required. Tao phien dau gia moi. Product phai ton tai va thuoc ve user dang nhap, tru `ADMIN`.

Body:

```json
{
  "productId": "productId",
  "startPrice": 100000,
  "minIncrement": 10000,
  "startTime": "2026-09-05T10:00:00.000Z",
  "endTime": "2026-09-05T12:00:00.000Z"
}
```

Required: `productId`, `startPrice`, `startTime`, `endTime`.

Validate:

- `startPrice`: so duong
- `minIncrement`: so duong, optional, default backend `10000`
- `startTime`, `endTime`: ISO datetime
- `endTime` phai sau `startTime`

Sau khi tao auction, backend update product status thanh `AUCTION`.

### `PATCH /api/auctions/:id/cancel`

Auth required. Chi seller cua auction hoac `ADMIN`. Khong huy duoc neu auction da `ENDED` hoac `CANCELLED`.

Sau khi huy, backend update product status ve `ACTIVE`.

Response:

```json
{
  "success": true,
  "message": "Phien dau gia da bi huy",
  "data": {}
}
```

## Bids

### `POST /api/bids`

Auth required. Dat bid cho phien dau gia.

Body:

```json
{
  "auctionId": "auctionId",
  "amount": 300000
}
```

Validate:

- Auction phai ton tai va co `status = LIVE`.
- User khong duoc bid auction cua chinh minh.
- Auction chua het `endTime`.
- `amount` phai >= `currentBid + minIncrement`.

Response `201`:

```json
{
  "success": true,
  "data": {
    "id": "bidId",
    "auctionId": "auctionId",
    "bidderId": "userId",
    "amount": 300000,
    "isWinning": true,
    "createdAt": "2026-09-05T00:00:00.000Z",
    "bidder": {
      "id": "userId",
      "name": "Bidder",
      "avatar": null
    }
  }
}
```

### `GET /api/bids/auction/:auctionId`

Public. Lay lich su bid cua mot auction.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `page` | number | `1` | Trang |
| `limit` | number | `20` | Toi da `50` |

### `GET /api/bids/my-bids`

Auth required. Lay lich su bid cua user dang nhap.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `page` | number | `1` | Trang |
| `limit` | number | `10` | Toi da `50` |

Response moi item include `auction`, trong `auction` include `product` voi cac field `id`, `title`, `images`, `category`.

## Orders

### `GET /api/orders`

Auth required. Lay danh sach don hang cua user dang nhap.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `role` | enum | `buyer` | `buyer` hoac `seller`; backend dung de loc `buyerId`/`sellerId` theo user hien tai |
| `status` | enum | | `PENDING`, `PAID`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `REFUNDED` |
| `page` | number | `1` | Trang |
| `limit` | number | `10` | Toi da `50` |

Response moi order include:

- `buyer`: `id`, `name`, `avatar`, `email`
- `seller`: `id`, `name`, `avatar`, `email`
- `product`: `id`, `title`, `images`, `category`, `price`
- `auction`: `id`, `currentBid`, `endTime`

### `GET /api/orders/:id`

Auth required. Lay chi tiet don hang. User phai la buyer, seller hoac `ADMIN`.

### `PATCH /api/orders/:id/status`

Auth required. Buyer, seller hoac `ADMIN` cua order deu co quyen update status theo code hien tai.

Body:

```json
{
  "status": "PAID"
}
```

Status duoc chap nhan: `PAID`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `REFUNDED`.

Ghi chu side effect:

- `PAID`: backend set `paidAt`.
- `SHIPPED`: backend set `shippedAt`.
- `DELIVERED`: backend set `deliveredAt`, tang `totalSales` cua seller, neu order co `productId` thi update product status thanh `SOLD`.

## Wishlist

### `GET /api/wishlist`

Auth required. Lay wishlist cua user dang nhap.

Query:

| Query | Type | Default | Ghi chu |
| --- | --- | --- | --- |
| `page` | number | `1` | Trang |
| `limit` | number | `12` | Toi da `50` |

Response moi item include `product`, trong `product` include `seller` va `_count.wishlistItems`.

### `POST /api/wishlist`

Auth required. Them product vao wishlist.

Body:

```json
{
  "productId": "productId"
}
```

Loi hay gap:

- `404`: san pham khong ton tai
- `409`: san pham da co trong wishlist

### `DELETE /api/wishlist/:productId`

Auth required. Xoa product khoi wishlist cua user dang nhap.

Response:

```json
{
  "success": true,
  "message": "Da xoa khoi danh sach yeu thich"
}
```

### `GET /api/wishlist/check/:productId`

Auth required. Kiem tra product da co trong wishlist chua.

Response:

```json
{
  "success": true,
  "isInWishlist": true
}
```

## Type goi y cho FE

```ts
type ApiListResponse<T> = {
  success: true;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

type ApiItemResponse<T> = {
  success: true;
  data: T;
};

type ApiError = {
  success: false;
  message: string;
  errors?: Record<string, string[]>;
  stack?: string;
};

type User = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  bio: string | null;
  phone: string | null;
  address: string | null;
  role: Role;
  reputation: number;
  totalSales: number;
  totalBids: number;
  isVerified: boolean;
  createdAt: string;
  updatedAt?: string;
};

type RegisterOtpResponse = {
  success: true;
  message: "OTP sent to email";
  email: string;
  requiresOtp: true;
};

type VerifyOtpResponse = {
  success: true;
  token: string;
  user: User;
};

type ResendOtpResponse = {
  success: true;
  message: "OTP resent";
};

type OtpRequiredError = {
  success: false;
  message: "Please verify your email before logging in" | "Please wait before requesting another OTP";
  requiresOtp: true;
  email: string;
  retryAfter?: number;
};

type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
  images: string[];
  category: string;
  condition: ProductCondition;
  status: ProductStatus;
  brand: string | null;
  size: string | null;
  color: string | null;
  tags: string[];
  viewCount: number;
  sellerId: string;
  seller?: Pick<User, "id" | "name" | "avatar" | "reputation" | "isVerified">;
  _count?: {
    wishlistItems: number;
  };
  auction?: Auction | null;
  createdAt: string;
  updatedAt: string;
};

type Auction = {
  id: string;
  productId: string;
  sellerId: string;
  startPrice: number;
  currentBid: number;
  minIncrement: number;
  startTime: string;
  endTime: string;
  status: AuctionStatus;
  winnerId: string | null;
  product?: Product;
  seller?: Pick<User, "id" | "name" | "avatar" | "reputation" | "isVerified">;
  bids?: Bid[];
  _count?: {
    bids: number;
  };
  createdAt: string;
  updatedAt: string;
};

type Bid = {
  id: string;
  auctionId: string;
  bidderId: string;
  amount: number;
  isWinning: boolean;
  bidder?: Pick<User, "id" | "name" | "avatar">;
  auction?: Auction;
  createdAt: string;
};

type Order = {
  id: string;
  buyerId: string;
  sellerId: string;
  productId: string | null;
  auctionId: string | null;
  totalPrice: number;
  shippingFee: number;
  status: OrderStatus;
  shippingAddress: string | null;
  note: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  buyer?: Pick<User, "id" | "name" | "avatar" | "email">;
  seller?: Pick<User, "id" | "name" | "avatar" | "email">;
  product?: Pick<Product, "id" | "title" | "images" | "category" | "price"> | null;
  auction?: Pick<Auction, "id" | "currentBid" | "endTime"> | null;
  createdAt: string;
  updatedAt: string;
};

type WishlistItem = {
  id: string;
  userId: string;
  productId: string;
  product: Product;
  createdAt: string;
};
```

## Luu y quan trong cho FE

- Flow register hien tai bat buoc verify OTP truoc khi login. User chua verify se bi xoa sau 6 phut neu khong xac thuc OTP, de email co the dang ky lai. Neu chua cau hinh SMTP, BE se tra `500` voi message `Unable to send OTP email`; local dev van in OTP ra console voi prefix `[DEV OTP]` de debug. Production can cau hinh `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`.
- Hien tai backend chua co API upload anh. `images` va `avatar` dang nhan URL string.
- Hien tai backend chua co API tao order (`POST /api/orders`) va chua co checkout/payment API. Route order chi co list, detail va update status.
- Hien tai backend chua co API ket thuc auction tu dong, chon winner, hay tao order tu auction winner.
- Hien tai backend chua co route cho review du model Prisma co bang `Review`.
- Role user mac dinh khi register la `BUYER`; code hien tai chua co API doi role thanh `SELLER`.
- Nen uu tien dung Swagger JSON `/api-docs.json` neu FE muon generate client tu OpenAPI, nhung docs nay da ghi them cac side effect/constraint trong code.
