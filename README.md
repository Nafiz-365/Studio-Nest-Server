# StudioNest Server

StudioNest Server is the backend API for the StudioNest marketplace platform. It powers studio discovery, host management, reservations, and wishlist features for a companion frontend application.

The service is built with Node.js, Express, and MongoDB, and it validates requests using Better Auth JWTs obtained from the frontend JWKS endpoint.

## Overview

This backend is responsible for:

- Public studio catalog browsing and search
- Host-owned studio creation, editing, and deletion
- Booking request creation, validation, and host review
- Booking cancellation and conflict prevention
- User wishlist management
- Startup data seeding and MongoDB index creation
- Auth-protected ownership checks for sensitive actions

## Tech Stack

- Node.js 20+
- Express 4
- MongoDB with official MongoDB Node driver
- `jose` for JWT/JWKS verification
- `cors` and `dotenv`
- `nodemon` for local development

## Project Structure

```text
studio-nest-server/
├── index.js            # API routes, validation, MongoDB logic, auth middleware
├── seedData.js         # Seed studio catalog data
├── .env.example        # Example environment variables
├── .env                # Local environment file (not committed)
├── package.json        # Project scripts and dependencies
├── README.md           # Project documentation
└── node_modules/       # Installed dependencies
```

## Features

- MongoDB Atlas integration with automatic collection index creation
- JWT-based auth with remote JWKS validation
- Local-only dev authentication fallback (`ALLOW_DEV_AUTH_FALLBACK`) for testing
- Protected access to owner-only listing and booking actions
- Booking validation for:
    - valid date and time format
    - future bookings only
    - minimum one-hour duration
    - guest count validation
    - overlapping booking checks for pending and confirmed reservations
- Studio image validation for URLs and bounded base64 data URLs
- Production-safe error handling
- Pagination support for studio discovery requests
- Auto-seeding when the `studios` collection is empty

## Requirements

Before running the project, make sure you have:

- Node.js 20 or newer
- MongoDB connection access
- A frontend app running with the configured `CLIENT_URL`
- A valid Better Auth/JWKS setup for the frontend

## Installation

```bash
npm install
cp .env.example .env
npm run dev
```

For production mode:

```bash
npm start
```

The server listens on:

```text
http://localhost:8000
```

## Environment Variables

Create a `.env` file using the `.env.example` template.

| Variable                  | Required | Description                                               |
| ------------------------- | :------: | --------------------------------------------------------- |
| `PORT`                    |    No    | API port, defaults to `8000`                              |
| `MONGODB_URI`             |   Yes    | MongoDB connection string                                 |
| `CLIENT_URL`              |   Yes    | Frontend base URL used for CORS and JWKS lookup           |
| `ALLOW_DEV_AUTH_FALLBACK` |    No    | Enables local-only non-production fallback authentication |
| `NODE_ENV`                |    No    | Usually set to `development` or `production`              |

Important:

- Keep `ALLOW_DEV_AUTH_FALLBACK=false` outside local development.
- Never commit secrets, credentials, or database URLs to source control.

## Authentication Model

Protected routes verify the incoming JWT by fetching the frontend JWKS from:

```text
${CLIENT_URL}/api/auth/jwks
```

The API enforces ownership checks before allowing:

- studio edits
- studio deletion
- booking cancellation by the user
- host booking decisions
- wishlist updates
- host listing access

This keeps sensitive operations tied to the authenticated account rather than trusting client-side values alone.

## API Endpoints

| Method   | Endpoint                     | Auth | Purpose                                       |
| -------- | ---------------------------- | :--: | --------------------------------------------- |
| `GET`    | `/`                          |  No  | Health check                                  |
| `POST`   | `/seed-studios`              |  No  | Seed the studio collection when empty         |
| `GET`    | `/studios`                   |  No  | Browse and filter studios                     |
| `GET`    | `/featured-studios`          |  No  | Return the top six highest-rated studios      |
| `GET`    | `/studio/:id`                |  No  | Fetch one studio by MongoDB `_id` or app ID   |
| `POST`   | `/add-studio`                | JWT  | Create a new studio listing                   |
| `PATCH`  | `/studio/:id`                | JWT  | Update editable studio data                   |
| `DELETE` | `/studio/:id`                | JWT  | Remove a studio and cancel pending bookings   |
| `POST`   | `/booking`                   | JWT  | Create a new reservation request              |
| `GET`    | `/my-bookings/:email`        | JWT  | Fetch bookings for the authenticated user     |
| `GET`    | `/host-bookings`             | JWT  | Fetch booking requests for host-owned studios |
| `PATCH`  | `/booking/:id/cancel`        | JWT  | Cancel a pending booking                      |
| `PATCH`  | `/booking/:id/host-decision` | JWT  | Confirm or decline a booking request          |
| `DELETE` | `/my-bookings/:id`           | JWT  | Remove a booking record                       |
| `GET`    | `/my-studios/:email`         | JWT  | Fetch studios owned by the authenticated host |
| `GET`    | `/wishlist/:email`           | JWT  | Read saved studio IDs for a user              |
| `POST`   | `/wishlist`                  | JWT  | Add or remove a studio from the wishlist      |

### Studio Search and Filtering

`GET /studios` supports these query parameters:

- `category`
- `search`
- `minPrice`
- `maxPrice`
- `sort`
- `page`
- `limit`

Supported sort values:

- `price_asc`
- `price_desc`
- `rating_desc`
- `newest`

Example:

```text
/studios?page=1&limit=24&sort=rating_desc
```

Without pagination, the endpoint returns a raw array of studios for compatibility with the existing client.

## Database Collections

The server uses MongoDB collections for the following data:

- `studios` — studio listings, host data, images, reviews, and details
- `bookings` — bookings, statuses, date/time slots, and cancellation metadata
- `wishlists` — saved studio IDs per normalized user email

Startup logic creates indexes for:

- owner-specific studio lookup
- category and rate filtering
- booking collision detection
- user booking retrieval
- wishlist lookup

## Seed Data

The application automatically seeds demo studios when the `studios` collection is empty. The seed data comes from `seedData.js` and contains production-style studio examples such as photo studios, film stages, and podcast lounges.

## Security and Validation

The backend includes several safeguards:

- JWT verification through remote JWKS
- Owner-only access enforcement for listing and booking actions
- Restricted editable fields for studio updates
- validation of booking date/time inputs
- overlap protection for concurrent reservations
- restricted image formats and size constraints
- bounded JSON size (`10mb`)
- production-safe server error responses

## Production Checklist

1. Set a valid `MONGODB_URI` and `CLIENT_URL`.
2. Keep `ALLOW_DEV_AUTH_FALLBACK=false` in production.
3. Use the real frontend origin in CORS configuration.
4. Run the app with `npm start` in deployment.
5. Ensure the frontend points to the deployed API endpoint.
6. Never commit `.env`, secrets, or credentials.

## Notes

This project is designed to work with a frontend application that handles the user session and proxies API requests securely. The server is intentionally strict about ownership validation and reservation integrity so that listing operations and bookings remain consistent.
