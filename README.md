# 🚀 ArtHub Server — Backend REST API Engine

> High-performance Node.js & Express.js REST API layer powering the ArtHub Marketplace. Handles role-based access control (RBAC), multi-tier user subscriptions, automated payment gateway intents via Stripe, and complex aggregations for transactional art commerce analytics.

---

## 🌐 Production API & Repository

🔗 **Live Production API:** [https://arthub-server-z4w8.onrender.com/](https://arthub-server-z4w8.onrender.com/)  
🔗 **Backend Repository:** [https://github.com/Asmual/arthub-server](https://github.com/Asmual/arthub-server)  
🔗 **Frontend Repository:** [https://github.com/Asmual/arthub-client](https://github.com/Asmual/arthub-client)

---

## 🛠️ Architecture & Core Dependencies

The server follows a modular router-middleware architectural design, ensuring clean separation of concerns and high maintainability.

| Dependency Package | Version Scope | Technical Core Purpose |
|---|---|---|
| **`express`** | `^4.x` | Web framework handles routing matrices and centralized error handling middleware. |
| **`mongodb`** | `^6.x` | Dynamic native driver executing atomic CRUD commands, schema row matching, and custom aggregation pipelines. |
| **`jsonwebtoken`** | `^9.x` | Stateless security layer issuing tokens with a 7-day expiration shelf life. |
| **`stripe`** | `^14.x` | Processes live remote checkout instances for premium subscription scales and artwork item transactions. |
| **`cors`** | `^2.x` | Isolates cross-origin requests safely between specific Vercel clients and the Render host. |
| **`dotenv`** | `^16.x` | Sandboxes runtime environment keys, isolating MongoDB string formats and webhook tokens. |

---

## 🔒 Security & Middleware Matrix

The server employs multi-layered authentication barriers inside `middlewares.js` to safeguard operational logic:

1. **`verifyToken`:** Decodes incoming `Bearer` authorization headers utilizing cryptographic secret keys. Prevents unsigned or mutated payloads from executing private server directives.
2. **`verifyRole(allowedRoles)`:** Resolves verified context emails against the centralized `user` collection to ensure client permissions accurately align with `admin` or `artist` administrative tiers.

---

## 📋 Centralized API Endpoints Map

### 📦 Artwork Asset Routing (`/api/artworks`)
- `GET /api/artworks` - public inventory engine with page numbers, filters (category, min-max price), and flexible sorting matrixes (Newest, Price: Low-to-High).
- `GET /api/artworks/:id` - extracts full metadata context for a targeted piece including verified user review strings.
- `POST /api/artworks/:id/comments` - conditional gateway allowing buyers to comment *only* after a purchase record is confirmed in the database.

### 💳 Payment & Subscriptions (`/api/payment`)
- `POST /api/payment/create-subscription-checkout` - locks standard buyer profiles into a Stripe gateway session to upgrade accounts to Pro/Premium matrices.
- `POST /api/payment/create-artwork-checkout` - reads active subscription tiers to enforce listing limits prior to initializing transaction sessions.
- `GET /api/payment/all-transactions` - **(Admin Only)** master operational ledger compiling site-wide dynamic transaction analytics.

### 🧑‍🎨 Creator Matrix Routing (`/api/artists`)
- `GET /api/artists/:id/artworks` - isolates the complete digital library catalog matching a single verified user profile.
- `GET /api/artists/sales` - **(Artist Only)** tracks localized micro-ledgers detailing historical buyer emails, order tags, and gross profits.

### 🛡️ Administrative Controls (`/api/admin`)
- `PATCH /api/admin/update-role/:id` - updates global user document models across user, artist, and admin configurations.
- `GET /api/admin/analytics-summary` - maps out total revenue, sales curves, and category pie chart metrics using asynchronous multi-collection counters.

---

## 🗄️ Database Schemas Model Example

### `orders` / `transactions` Collection Sample
```json
{
  "_id": "65f3a1b2c4d5e6f7a8b9c0d1",
  "transactionId": "ch_3Mtwb2LkdIwHu7ix28aZklM",
  "type": "purchase",
  "buyerEmail": "buyer@example.com",
  "artistEmail": "artist@example.com",
  "artworkId": "65f3a1b2c4d5e6f7a8b9c0d2",
  "artworkTitle": "Midnight Eclipse Canvas",
  "amount": 250.00,
  "status": "paid",
  "date": "2026-06-28T06:30:00.000Z"
}
