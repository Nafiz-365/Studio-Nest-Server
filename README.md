# StudioNest Server — Peer-to-Peer Creative Studio Sharing Platform API

> **Assignment:** B14-A8-Cat_Harry  
> **Server Stack:** Node.js, Express.js 4/5, MongoDB Atlas, Jose JWT  
> **Default Port:** `8000`  
> **Client Pairing:** `http://localhost:3000` (Next.js App Router)

---

## 🌟 Key Backend Features

- **High-Performance Express & MongoDB Architecture:** Fully decoupled, high-throughput REST API communicating with MongoDB Atlas via the official native `mongodb` driver.
- **Smart Double-Booking Collision Prevention:** Time-range overlap detection algorithms prevent conflicting reservations on identical calendar dates and studio spaces.
- **JWKS Remote JWT Authentication:** Secure integration with client-side Better-Auth tokens verified dynamically through `${CLIENT_URL}/api/auth/jwks` using `jose`.
- **Complete Studio Lifecycle Management (Full CRUD):** Endpoints to query, filter (by category, price, search query), sort, insert, update, and remove studio spaces.
- **Automated Seed Mechanism:** Automatically initializes 6 top-rated production studios (Cyc Wall, Sound Stage, Podcast Lounge, SSL Music Suite, Virtual Chroma, Art Loft) on initial startup.
- **Robust Error Handling & CORS:** Built-in CORS whitelisting for Next.js development and production origins.

---

## 📡 REST API Endpoints Specification

| Method   | Endpoint              | Auth Required | Description                                             |
| :------- | :-------------------- | :-----------: | :------------------------------------------------------ |
| `GET`    | `/`                   |      No       | Server health check & status                            |
| `POST`   | `/seed-studios`       |      No       | Seed initial 6 creative studios if database empty       |
| `GET`    | `/studios`            |      No       | Search, filter by category/price, and sort all studios  |
| `GET`    | `/featured-studios`   |      No       | Returns top 6 rated studios using `.limit(6)`           |
| `GET`    | `/studio/:id`         |      No       | Retrieve single studio details by MongoDB `_id` or `id` |
| `POST`   | `/add-studio`         | **Yes (JWT)** | Publish new creative studio space                       |
| `PATCH`  | `/studio/:id`         | **Yes (JWT)** | Update existing studio listing (verifies owner)         |
| `DELETE` | `/studio/:id`         | **Yes (JWT)** | Remove studio listing and cascade cleanup               |
| `POST`   | `/booking`            | **Yes (JWT)** | Reserve slot with double-booking collision check        |
| `GET`    | `/my-bookings/:email` | **Yes (JWT)** | Retrieve all reservations made by user                  |
| `PATCH`  | `/booking/:id/cancel` | **Yes (JWT)** | Cancel pending studio reservation                       |
| `DELETE` | `/my-bookings/:id`    | **Yes (JWT)** | Delete reservation entry                                |
| `GET`    | `/my-studios/:email`  | **Yes (JWT)** | Retrieve all spaces listed by a specific host           |
| `GET`    | `/wishlist/:email`    | **Yes (JWT)** | Retrieve user's saved studio IDs                        |
| `POST`   | `/wishlist`           | **Yes (JWT)** | Toggle studio in saved wishlist                         |

`GET /studios` continues to return an array by default. Add `page` and `limit`
query parameters (maximum `100`) to receive a paginated `{ data, pagination }`
response. The server also creates indexes for owner listings, booking collision
queries, user bookings, and wishlist lookups at startup.

---

## ⚙️ Environment Configuration

Create a `.env` file in the root of the server repository:

```env
PORT=8000
MONGODB_URI=your_mongodb_atlas_connection_string
CLIENT_URL=http://localhost:3000
ALLOW_DEV_AUTH_FALLBACK=false
```

`ALLOW_DEV_AUTH_FALLBACK` must remain `false` in shared or production environments.
Set it to `true` only when intentionally testing protected API routes locally without
a valid Better Auth JWT. This fallback accepts the `x-user-email` header and must
never be used as a production authentication mechanism.

---

## 🚀 Local Installation & Execution

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

### 3. Start Development Server (with auto-reload)

```bash
npm run dev
```

### 4. Start Production Server

```bash
npm start
```
