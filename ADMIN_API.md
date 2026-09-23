# REWORE Admin Module

Base paths:

```txt
/admin
/api/admin
```

All endpoints require:

```txt
Authorization: Bearer <admin-token>
```

## Setup

Apply DB migration:

```bash
npx prisma migrate deploy
```

Create or update default admin:

```bash
npm run seed
```

Optional env for seed:

```txt
ADMIN_EMAIL=admin@rewore.local
ADMIN_PASSWORD=Admin@123456
ADMIN_NAME=REWORE Admin
```

## Seller Review

### GET /admin/sellers

Query:

```txt
status=pending|approved|rejected|suspended
page=1
limit=20
sortBy=createdAt|reviewedAt|shopName|status
sortOrder=desc
```

### GET /admin/sellers/:id

Returns seller profile detail with ID card signed URLs, user info, review admin, and status history.

`id-cards` is a private Supabase Storage bucket. The raw DB values are internal bucket paths, but this endpoint replaces:

- `idCardFrontUrl`
- `idCardBackUrl`
- `selfieUrl`

with signed URLs that expire after 5 minutes. FE should call this endpoint again when admin needs to reload expired images.

### POST /admin/sellers/:id/approve

Approves seller profile, sets user role to `SELLER`, writes `SellerStatusHistory`, writes `AdminActionLog`, and sends result email.

### POST /admin/sellers/:id/reject

Body:

```json
{
  "reason": "Ảnh CCCD không rõ hoặc tên tài khoản ngân hàng không khớp"
}
```

Rejects seller profile, keeps user as `BUYER`, writes history/log, and sends result email.

## Users

### GET /admin/users

Query:

```txt
search=email-or-name-or-phone
status=active|banned
page=1
limit=20
sortBy=createdAt|email|name|role
sortOrder=desc
```

### PATCH /admin/users/:id/ban

Body:

```json
{
  "reason": "Fraudulent activity"
}
```

### PATCH /admin/users/:id/unban

Unbans a user. Admin cannot ban self.

## Products

### GET /admin/products

Query:

```txt
status=ACTIVE|SOLD|AUCTION|INACTIVE|HIDDEN|REMOVED
sellerId=user-id
page=1
limit=20
sortBy=createdAt|price|title|status|viewCount|availabilityStatus
sortOrder=desc
```

Response product includes read-only transaction fields:

```json
{
  "quantity": 1,
  "availabilityStatus": "available"
}
```

`status` is the admin moderation status. `availabilityStatus` is transaction availability for future hold/drop flows; admin APIs do not update it directly.

Product seller payload includes `seller.sellerProfile.shopName` so the admin UI can show shop name while still keeping account fields like `seller.name` and `seller.email` for review.

### PATCH /admin/products/:id/hide

Body:

```json
{
  "reason": "Listing violates marketplace policy"
}
```

Sets product status to `HIDDEN`.

Returns `409` if product has an active order (`PENDING`, `CONFIRMED`, `PAID`, `SHIPPED`).

### DELETE /admin/products/:id

Body:

```json
{
  "reason": "Counterfeit item"
}
```

Soft-removes product by setting status to `REMOVED`.

Returns `409` if product has an active order (`PENDING`, `CONFIRMED`, `PAID`, `SHIPPED`).

## Reports

### GET /admin/reports

Query:

```txt
status=open|resolved|dismissed
page=1
limit=20
sortBy=createdAt|status|resolvedAt
sortOrder=desc
```

### GET /admin/reports/:id

Returns report detail.

### POST /admin/reports/:id/resolve

Body:

```json
{
  "action": "warn",
  "note": "Seller was warned"
}
```

Allowed actions:

```txt
warn
suspend
dismiss
```

If `action=suspend`, backend finds the seller from report target and sets seller profile to `SUSPENDED`.

## Orders And Manual Payment

### GET /admin/orders

Query:

```txt
paymentStatus=UNPAID|PAID|REFUNDED
orderStatus=PENDING|CONFIRMED|PAID|SHIPPED|DELIVERED|COMPLETED|CANCELLED|REFUNDED
page=1
limit=20
sortBy=createdAt|totalPrice|paymentStatus|status|paidAt
sortOrder=desc
```

### PATCH /admin/orders/:id/confirm-payment

Manual confirmation for VietQR/bank transfer. Sets:

```txt
paymentStatus=PAID
paidAt=now
status=CONFIRMED if current status is PENDING
```

### POST /admin/orders/:id/refund

Body:

```json
{
  "reason": "Buyer refund approved"
}
```

Sets:

```txt
paymentStatus=REFUNDED
status=REFUNDED
```

## Stats

### GET /admin/stats/overview

Response data:

```json
{
  "total_users": 100,
  "total_sellers_approved": 12,
  "total_products": 80,
  "total_orders": 35,
  "gmv_total": 12500000,
  "pending_sellers_count": 4,
  "open_reports_count": 2
}
```

### GET /admin/stats/growth

Query:

```txt
range=week|month
```

Returns daily buckets:

```json
[
  {
    "date": "2026-09-12",
    "users_new": 3,
    "orders_new": 5,
    "gmv": 1500000
  }
]
```

### GET /admin/stats/top-sellers

Query:

```txt
limit=10
```

## Audit Log

Every admin mutation writes `AdminActionLog`:

```txt
SELLER_APPROVE
SELLER_REJECT
USER_BAN
USER_UNBAN
PRODUCT_HIDE
PRODUCT_REMOVE
REPORT_WARN
REPORT_SUSPEND
REPORT_DISMISS
ORDER_CONFIRM_PAYMENT
ORDER_REFUND
```

## Selling Permission

After this module, selling APIs require either admin or approved seller:

```txt
POST /api/products
PUT /api/products/:id
DELETE /api/products/:id
POST /api/auctions
PATCH /api/auctions/:id/cancel
```

If seller profile is not approved:

```json
{
  "success": false,
  "message": "Seller profile must be approved before selling",
  "requiresSellerApproval": true,
  "sellerStatus": "NONE"
}
```
