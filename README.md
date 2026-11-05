# StudioNest API

The StudioNest API is an Express and MongoDB service for a peer-to-peer
creative studio marketplace. It supports public studio discovery and protected
studio management, booking, cancellation, and wishlist operations for the
companion Next.js client.

## Highlights

- MongoDB Atlas integration using the official MongoDB driver.
- Better Auth JWT verification through the frontend JWKS endpoint.
- Ownership-protected studio listing management.
- Booking validation for dates, times, guest capacity, and overlapping
  pending/confirmed reservations.
- Calendar-accurate booking date validation and transactional listing removal
  with pending-booking cancellation.
- Server-controlled pending booking status and protected booking cancellation.
- Wishlist persistence with atomic saved-state updates, production-safe error
  responses, CORS configuration, startup seed data, pagination, and query
  indexes.
- Backward-compatible array responses for `/studios` plus optional pagination.

## Technology

- Node.js with native ES modules
- Express 4
- MongoDB driver
- `jose` for remote JWKS JWT verification
- `cors`, `dotenv`, and `nodemon`

## API endpoints

| Method   | Endpoint                     | Auth | Purpose                                                                      |
| -------- | ---------------------------- | :--: | ---------------------------------------------------------------------------- |
| `GET`    | `/`                          |  No  | Health check                                                                 |
| `POST`   | `/seed-studios`              |  No  | Seed studios when the collection is empty                                    |
| `GET`    | `/studios`                   |  No  | Search, filter, sort, and optionally paginate studios                        |
| `GET`    | `/featured-studios`          |  No  | Return the six highest-rated studios                                         |
| `GET`    | `/studio/:id`                |  No  | Read a studio by MongoDB `_id` or application ID                             |
| `POST`   | `/add-studio`                | JWT  | Create a studio owned by the authenticated user                              |
| `PATCH`  | `/studio/:id`                | JWT  | Update editable fields of an owned studio                                    |
| `DELETE` | `/studio/:id`                | JWT  | Remove an owned studio and cancel pending bookings                           |
| `POST`   | `/booking`                   | JWT  | Create a validated pending booking request                                   |
| `GET`    | `/my-bookings/:email`        | JWT  | Read the authenticated user's bookings                                       |
| `GET`    | `/host-bookings`             | JWT  | Read requests for the authenticated host's studios                           |
| `PATCH`  | `/booking/:id/cancel`        | JWT  | Cancel an owned pending booking                                              |
| `PATCH`  | `/booking/:id/host-decision` | JWT  | Confirm or decline a request for an owned studio (`Confirmed` or `Declined`) |
| `DELETE` | `/my-bookings/:id`           | JWT  | Delete an owned booking record                                               |
| `GET`    | `/my-studios/:email`         | JWT  | Read the authenticated user's listings                                       |
| `GET`    | `/wishlist/:email`           | JWT  | Read saved studio IDs                                                        |
| `POST`   | `/wishlist`                  | JWT  | Set a studio's saved state                                                   |

### Studio discovery query parameters

`GET /studios` accepts `category`, `search`, `minPrice`, `maxPrice`, and
`sort`. Supported sort values are `price_asc`, `price_desc`, `rating_desc`,
and `newest`.

For paginated results, add `page` and `limit`:

```text
/studios?page=1&limit=24&sort=rating_desc
```

The maximum page size is `100`. Without pagination parameters, the endpoint
keeps returning the studio array expected by the current client.

## Local development

### Prerequisites

- Node.js 20 or newer
- A MongoDB connection string
- The companion frontend running on the configured client URL

### Setup

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

The API starts on [http://localhost:8000](http://localhost:8000) by default.
Use `npm start` for the production process.

### Environment variables

| Variable                  | Required | Purpose                             |
| ------------------------- | :------: | ----------------------------------- |
| `PORT`                    |    No    | API port; defaults to `8000`        |
| `MONGODB_URI`             |   Yes    | MongoDB connection string           |
| `CLIENT_URL`              |   Yes    | Frontend origin and JWKS base URL   |
| `ALLOW_DEV_AUTH_FALLBACK` |    No    | Explicit local-only fallback switch |

Keep `ALLOW_DEV_AUTH_FALLBACK=false` in shared and production environments.
The fallback accepts `x-user-email` only when explicitly enabled for local
testing and is not an authentication mechanism.

## Security and data integrity

- Protected routes verify Better Auth JWTs using the frontend JWKS endpoint.
  The companion Next.js app reads its HttpOnly auth session cookie and proxies
  private API requests server-side; the JWT is never returned to browser code.
- Studio updates accept only approved editable fields.
- Studio updates and deletion require an existing owner email matching the
  authenticated account.
- Studio listing, booking, cancellation, deletion, and wishlist operations
  verify the authenticated user's ownership.
- New bookings are always created as `Pending`; clients cannot confirm them.
- Studio galleries accept up to six HTTP(S) or bounded JPEG/PNG/WebP data URLs.
- JSON request bodies are limited to 10 MB to support the bounded local image
  fallback without accepting unbounded payloads.
- Historical confirmed/completed bookings are preserved when a studio is
  removed; pending bookings are cancelled with a reason.
- Production responses hide internal error details while server logs retain
  diagnostic information.
- Startup indexes support owner listings, booking collision queries, user
  bookings, category/rate filtering, and wishlist lookups.

## Database collections

- `studios` — studio metadata, availability-related details, hosts, and reviews
- `bookings` — reservation windows, financial breakdowns, and status history
- `wishlists` — one saved-studio list per normalized user email

The server automatically inserts the bundled seed studios when the `studios`
collection is empty.

## Production checklist

1. Set a strong `MONGODB_URI`, `CLIENT_URL`, and Better Auth configuration.
2. Keep `ALLOW_DEV_AUTH_FALLBACK=false`.
3. Configure CORS with the real deployed frontend origin.
4. Run `npm start` from the backend deployment.
5. Confirm the frontend points `NEXT_PUBLIC_API_BASE_URL` to this API.
6. Never commit `.env`, credentials, JWT secrets, or database URLs.
