# Tribel — Backend

Backend for **Tribel**, a multi-tenant hostel booking and property management platform. Guests discover properties and book beds; owners and admins manage tenants, properties, room inventory, bookings, payments, refunds, and invoices.

Built with Node.js, Express 5, TypeScript, PostgreSQL, Prisma, Redis, RabbitMQ, Razorpay, AWS S3, and OpenTelemetry.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Request lifecycle](#request-lifecycle)
- [Authentication and authorization](#authentication-and-authorization)
- [API reference](#api-reference)
- [Domain model](#domain-model)
- [Multi-tenancy and row-level security](#multi-tenancy-and-row-level-security)
- [Booking engine](#booking-engine)
- [Payments and refunds](#payments-and-refunds)
- [Asynchronous processing](#asynchronous-processing)
- [Caching, rate limiting, and locking](#caching-rate-limiting-and-locking)
- [Background jobs](#background-jobs)
- [Observability](#observability)
- [Security](#security)
- [Deployment](#deployment)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Design decisions](#design-decisions)

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│                       EC2 instance (Docker)                  │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │              Express 5 application                   │   │
│   │                                                      │   │
│   │  middleware → routes → controllers → services → jobs  │   │
│   └───────┬──────────────┬──────────────┬────────────────┘   │
│           │              │              │                     │
│   ┌───────▼──────┐ ┌─────▼─────┐ ┌──────▼───────┐            │
│   │  PostgreSQL  │ │   Redis   │ │  RabbitMQ    │            │
│   │  (RDS) + RLS │ │  cache /  │ │  events +    │            │
│   │              │ │  limits   │ │  retry / DLQ │            │
│   └──────────────┘ └───────────┘ └──────────────┘            │
│           │                                                  │
│   ┌───────▼────────────┐   ┌──────────────────────────┐      │
│   │  AWS S3            │   │  SigNoz (OTLP)           │      │
│   │  images + invoices │   │  logs, metrics, traces   │      │
│   └────────────────────┘   └──────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
        │
        │ Auth0 · Razorpay · Resend
        ▼
```

The service is a modular monolith. HTTP handling, business rules, persistence, asynchronous work, and scheduled jobs live in one deployable unit but are separated by directory and responsibility. State that must be correct under concurrency is protected in the database, not only in application code.

---

## Tech stack

| Concern | Technology |
|---|---|
| Runtime | Node.js 22, TypeScript (ESM, native `.ts` execution) |
| HTTP | Express 5 |
| Database | PostgreSQL (AWS RDS) with row-level security |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Auth | Auth0 via `express-openid-connect` |
| Cache / limits / locks | Redis via `ioredis` |
| Messaging | RabbitMQ via `amqplib` |
| Payments | Razorpay (orders, verification, webhooks, refunds) |
| Files | AWS S3 via `@aws-sdk/client-s3` (presigned uploads) |
| Invoices | Puppeteer (HTML to PDF) |
| Email | Resend |
| Validation | Zod |
| Logging | Pino + `pino-http` |
| Telemetry | OpenTelemetry SDK (OTLP) to SigNoz |
| Scheduling | `node-cron` |
| Testing | Vitest |
| Packaging | Docker, Docker Compose |
| CI/CD | GitHub Actions |

---

## Repository structure

```
Tribel Backend/
├── src/
│   ├── index.ts                  # Entry point: error handler, server start, jobs, consumers
│   ├── app.ts                    # Express app, middleware chain, auth routes, router mounting
│   ├── instrumentation.ts        # OpenTelemetry SDK setup (traces, metrics, logs)
│   ├── config/                   # Shared configuration
│   ├── routes/                   # Express routers — one file per resource
│   ├── controller/               # Request handlers, orchestration, response shaping
│   ├── middleware/               # Validation (Zod) and rate limiting
│   ├── services/                 # Domain services: booking state, refunds, ledger, webhooks, S3
│   ├── jobs/                     # Scheduled cron jobs (lifecycle, reconciliation)
│   ├── lib/
│   │   ├── auth/                 # Auth0 config, session cookie resolution, return-path safety
│   │   ├── prisma/               # Prisma clients (app/RLS client, admin client), RLS context
│   │   ├── rabbitmq/             # Connection, exchanges, consumers, workers
│   │   ├── redis/                # Cache, rate limiter, locks, occupancy cache
│   │   ├── errors/               # ApiError hierarchy
│   │   ├── responses/            # ApiResponse envelope
│   │   ├── logger.ts             # Pino logger
│   │   ├── dates.ts              # IST calendar semantics, date range helpers
│   │   ├── user.ts               # User lookup/creation helpers
│   │   └── index.ts              # `restrictTo` role guard
│   ├── emails/                   # Email templates and sending
│   ├── templates/                # Invoice HTML template
│   ├── utils/                    # Small shared utilities
│   ├── types/                    # Shared TypeScript types
│   └── generated/                # Generated Prisma client
├── prisma/
│   ├── schema.prisma             # Data model
│   └── migrations/               # SQL migrations, including RLS policies and constraints
├── tests/                        # Unit and integration suites
├── deploy/                       # SigNoz deployment configuration
├── docs/                         # Internal design notes (booking system blueprint, ADRs)
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/            # ci.yaml (PR checks), deploy.yaml (EC2 deployment)
```

---

## Request lifecycle

Middleware is applied in this order in `src/app.ts`:

| Order | Middleware | Purpose |
|---:|---|---|
| 1 | `auth0middleware` | Auth0 session handling on every request; populates `req.oidc` |
| 2 | `cors` | Credentialed cross-origin access for the frontend origin(s) |
| 3 | `express.json` | JSON parsing, 16 KB limit, captures `rawBody` for webhook signatures |
| 4 | `express.urlencoded` | Form body parsing, 16 KB limit |
| 5 | `express.static` | Static assets from `public/` |
| 6 | `cookieParser` | Cookie parsing |
| 7 | `helmet` | Security headers |
| 8 | `hpp` | HTTP parameter pollution protection |
| 9 | `pinoHttp` | Structured request logging with correlation |
| 10 | Session hydration | Resolves the Auth0 subject to a database user and attaches `req.user` |

The public routes `/`, `/logout`, `/profile`, `/auth/login`, and `/auth/bridge` are registered before the `/api/v1` routers.

### Session hydration

A request-scoped middleware resolves the Auth0 subject into an application user:

```
Auth0 session cookie
   → auth0middleware populates req.oidc.user (claims)
   → middleware attempts Redis lookup: session:<auth0Id> (TTL 3600s)
       hit  → attach cached { id, role, email, name }
       miss → look up the user in PostgreSQL, create on first login,
              cache the projected session, attach to req.user
```

Only the projected user (`id`, `role`, `email`, `name`) is placed on the request, so authorization decisions never depend on client-supplied claims.

### Response envelope

Unless a route streams or redirects, responses use a consistent envelope from `src/lib/responses/ApiResponse.ts`:

```jsonc
{
  "statusCode": 200,
  "success": true,
  "message": "Human-readable outcome",
  "data": { }
}
```

Errors use `ApiError` with a status code and message, rendered by the final error handler in `src/index.ts`. Validation failures return `400` with field-level detail.

---

## Authentication and authorization

### Login flow

```
Frontend                Backend                     Auth0
   │                       │                          │
   │  /login?returnTo=…    │                          │
   │──────────────────────►│                          │
   │                       │  getSafeReturnPath()     │
   │                       │  (rejects open redirects)│
   │                       │─── oidc.login ──────────►│
   │                       │                          │ universal login
   │                       │◄──────── /callback ──────│
   │                       │  creates/loads DB user   │
   │                       │  caches session          │
   │◄── /auth/bridge ──────│                          │
   │    redirect to returnTo                          │
```

- Login is initiated at `GET /auth/login`, which validates `returnTo` through `getSafeReturnPath` before handing off to Auth0, preventing open-redirect abuse.
- `GET /auth/bridge` resolves the Auth0 identity to a database user, caches the session projection, and redirects to the frontend's safe path.
- `GET /logout` clears Redis session entries and delegates to Auth0's logout with the frontend origin as `returnTo`.

### Session cookie

Cookie resolution lives in `src/lib/auth/session-cookie.ts` and `auth0-utils.ts`:

- Cookie name `appSession`, rolling sessions.
- Production: `secure: true`, `sameSite: "None"`, with `COOKIE_DOMAIN` when set — required because the frontend and API are on different origins.
- Development: `secure: false`, `sameSite: "Lax"` for plain-HTTP localhost.
- A startup check logs a warning if the cookie configuration cannot reach the configured frontend origin.

### Roles

`UserRole` has four values: `Guest`, `Staff`, `Admin`, `Super_Admin`.

Roles are enforced by the `restrictTo(...roles)` guard, applied per route after `requiresAuth()`:

- `Admin` and `Super_Admin` — property, room-template, occupancy, and admin booking operations.
- `Super_Admin` — platform-wide listings such as all tenants and all bookings.
- Any authenticated role — guest booking, profile, invoice retrieval, uploads.

A database trigger blocks self-promotion: user role changes are rejected unless performed through the admin path, so an API caller cannot elevate their own role.

---

## API reference

All authenticated routes require the Auth0 session cookie. `role` notes the minimum guard applied.

### Health and session

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Public | Login status probe |
| `GET` | `/profile` | Public | Auth0 session status; returns `{ isAuthenticated, user }` with OIDC claims |
| `GET` | `/auth/login` | Public, rate-limited | Begins Auth0 login with a validated `returnTo` |
| `GET` | `/auth/bridge` | Auth0 session | Resolves the identity, caches the session, redirects to the frontend |
| `GET` | `/logout` | Public | Clears session cache and logs out of Auth0 |

### User — `/api/v1/user`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/profile` | Public | Loads (and creates on first call) the database user with role and tenant |
| `PATCH` | `/profile` | Authenticated | Updates profile fields |
| `PATCH` | `/avatar` | Authenticated | Updates the avatar image reference |
| `DELETE` | `/delete` | Authenticated, rate-limited | Deletes the account |
| `GET` | `/signout` | Public | Sign-out helper |

### Tenant — `/api/v1/tenant`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/` | Authenticated | Creates the caller's tenant (host onboarding) |
| `GET` | `/` | `Admin`/`Super_Admin` | Tenant detail for the caller |
| `PATCH` | `/` | `Admin`/`Super_Admin` | Updates tenant settings |
| `PATCH` | `/profile` | Authenticated | Updates tenant profile fields |
| `GET` | `/admin/all` | `Super_Admin` | Lists all tenants |

### Properties — `/api/v1/properties`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/search` | Public | Search with pagination |
| `GET` | `/newProperty` | Public | Recently added properties |
| `GET` | `/` | `Admin`/`Super_Admin` | Admin property list |
| `POST` | `/` | `Admin`/`Super_Admin` | Creates a property |
| `PATCH` | `/:propertyId` | `Admin`/`Super_Admin` | Updates a property |
| `DELETE` | `/:propertyId` | `Admin`/`Super_Admin` | Soft-deletes a property |
| `GET` | `/:propertyId` | Public | Property detail |
| `GET` | `/:propertyId/booking-data` | Public | Booking configuration for the property (templates, pricing inputs, availability) |

### Room templates — `/api/v1/p/:propertyId/roomTemplate`

Room templates nest under a property, and the router runs with `mergeParams` so `:propertyId` reaches the controller.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Public | Lists templates for the property |
| `GET` | `/:roomTemplateId` | Public | Template detail |
| `POST` | `/` | `Admin`/`Super_Admin` | Creates a template |
| `PATCH` | `/:roomTemplateId` | `Admin`/`Super_Admin` | Updates a template |
| `DELETE` | `/:roomTemplateId` | `Admin`/`Super_Admin` | Removes a template |

### Bookings — `/api/v1/booking`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/` | Authenticated, rate-limited | Creates a booking; accepts an `Idempotency-key` header |
| `PATCH` | `/` | Authenticated, rate-limited | Guest cancels their booking |
| `GET` | `/user` | Authenticated | Guest booking list |
| `PATCH` | `/dates` | Authenticated | Guest changes booking dates |
| `PATCH` | `/:bookingId` | Authenticated | Updates a user booking |
| `GET` | `/occupancy/:propertyId` | `Admin`/`Super_Admin` | Occupancy window for the dashboard |
| `PATCH` | `/admin/:propertyId/status` | `Admin`/`Super_Admin` | Approves, rejects, or advances status |
| `GET` | `/:propertyId` | `Admin`/`Super_Admin` | Admin booking list for a property |
| `GET` | `/admin/all` | `Super_Admin` | Every booking on the platform |
| `GET` | `/:bookingId` | `Admin`/`Super_Admin` | Booking detail |
| `PATCH` | `/admin/:propertyId` | `Admin`/`Super_Admin` | Admin cancellation |
| `PATCH` | `/admin/:propertyId/booking/assign-bed` | `Admin`/`Super_Admin` | Assigns a specific bed |
| `PATCH` | `/admin/:propertyId/booking/dates` | `Admin`/`Super_Admin` | Admin date change with re-pricing |
| `PATCH` | `/admin/:propertyId/payment/paid` | `Admin`/`Super_Admin` | Records an offline payment |
| `PATCH` | `/admin/:propertyId/payment/refund` | `Admin`/`Super_Admin` | Records and settles a refund |

Static segments such as `/dates` and `/admin/all` are registered before parameterized segments so they are not captured as IDs.

### Payments — `/api/v1/payment`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/create-order` | Authenticated | Creates a Razorpay order for a booking |
| `POST` | `/verify` | Authenticated | Verifies the client-side payment result signature |
| `POST` | `/webhook` | Signature-verified | Receives Razorpay events (no session auth; HMAC instead) |

### Invoices — `/api/v1/invoice`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Authenticated | The caller's invoices |
| `GET` | `/:bookingId` | Authenticated | Invoice for one of the caller's bookings |
| `GET` | `/admin/:bookingId` | `Admin`/`Super_Admin` | Admin invoice lookup |

### Uploads — `/api/v1/uploads`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/presign` | Authenticated | Returns a presigned PUT URL for direct S3 upload |
| `POST` | `/deleteKey` | Authenticated | Deletes an S3 object by key |

---

## Domain model

Prisma models in `prisma/schema.prisma`:

| Model | Purpose |
|---|---|
| `User` | Application user linked to an Auth0 subject, with role, profile, and optional tenant |
| `Tenant` | Hostel business/organization that owns properties; carries currency, timezone, branding, and slug |
| `Property` | Bookable property belonging to a tenant, with address, geolocation, amenities, images, and GSTIN |
| `RoomTemplate` | Reusable room definition: occupancy, base price, and attributes used when generating rooms |
| `Room` | Physical room derived from a template within a property |
| `Bed` | Individual bookable unit inside a room |
| `Booking` | Stay record: guest, property, room template, dates, guest count, price, status, and payment mode |
| `Payment` | Payment record for a booking: provider, mode, amount, captured amount, status, and gateway references |
| `Refund` | Refund against a payment: requested, processed, failed, and cumulative-capped amounts |
| `PaymentEvent` | Raw gateway/webhook event records used for reconciliation and auditing |
| `Invoice` | Invoice record with storage reference, status, and generation attempts |
| `Reviews` | Guest reviews for properties |
| `IdempotencyKey` | Stored request/response pairs keyed by an idempotency key, method, and path |

Enums: `UserRole`, `BookingStatus`, `PaymentStatus`, `PaymentMode`, `PaymentProvider`, `PaymentRefundStatus`, `InvoiceStatus`.

### Relationships

```
Tenant 1─n Property 1─n RoomTemplate 1─n Room 1─n Bed
   │           │
   │           └─n Booking ─n─ Payment 1─n Refund
   │                        │
   │                        ├─n Invoice
   │                        └─n PaymentEvent
   └─n User (owner, staff, admin)
```

---

## Multi-tenancy and row-level security

Tenancy is enforced in the database, not only in controllers, so a mistaken query cannot leak another tenant's rows.

**Two clients, one truth.** `src/lib/prisma/` exposes:

- `getSecuredClient(...)` — a scoped client that sets `app.current_user`, `app.current_role`, and `app.current_tenant` for the operation. RLS policies read these settings.
- `adminDB` — an administrative client for explicitly cross-tenant operations such as platform listings and background reconciliation.

**Policies.** Migrations under `prisma/migrations/` enable `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on tenant-scoped tables (`User`, `Tenant`, `Property`, `RoomTemplate`, `Booking`, and related), with policies keyed to the session settings.

**Role escalation protection.** A database trigger rejects direct role changes, so privilege escalation cannot happen through a normal update path.

**Design rule.** Any query touching a tenant-scoped table should run through the scoped client. Administrative access is deliberate, narrow, and limited to platform operations and jobs.

---

## Booking engine

### Price model

Pricing is computed from the room template, the date range, and occupancy. Date ranges are half-open: `[startDate, endDate)` — the checkout day is free for the next guest. Date helpers in `src/lib/dates.ts` centralize this so the frontend preview and the backend charge cannot disagree about which nights are billed.

### Preventing double booking

Double booking is prevented at three levels:

1. **Capacity check inside a transaction.** Booking creation locks the room template row (`FOR NO KEY UPDATE`) so concurrent requests against the same template serialize, then counts overlapping active bookings against the template's capacity.
2. **A PostgreSQL exclusion constraint.** A migration adds `btree_gist` and an `EXCLUDE USING gist` constraint over `(bedId WITH =, tsrange(startDate, endDate) WITH &&)` restricted to active statuses. Two active bookings cannot hold overlapping ranges for the same bed even if application logic is bypassed.
3. **Optional bed assignment.** A booking may hold a template-level reservation before a specific bed is assigned; assigning a bed moves it under the exclusion constraint.

Because the constraint is raw SQL, it is created and maintained through migrations rather than being regenerated from the schema.

### Booking lifecycle

```
        ┌──────────┐   admin approves   ┌───────────┐   check-in   ┌─────────┐
new ──► │ PENDING  │ ─────────────────► │ CONFIRMED │ ───────────► │ ONGOING │
        └────┬─────┘                    └─────┬─────┘              └────┬────┘
             │ reject / cancel                │ cancel                 │ checkout
             ▼                                ▼                        ▼
        ┌──────────┐                     ┌───────────┐            ┌───────────┐
        │ REJECTED │                     │ CANCELLED │            │ COMPLETED │
        └──────────┘                     └───────────┘            └───────────┘
```

Status transitions happen through explicit endpoints (guest cancellation, admin approval/rejection, admin cancellation) and through the lifecycle job for time-based transitions such as check-in, checkout, and no-show handling. Date changes re-price through `applyBookingDateChange` so the stored total always matches the current dates.

### Idempotency

Booking creation accepts an `Idempotency-key` header. The key is recorded with method and path, and a repeated request returns the original outcome instead of creating a second booking. This protects against client retries, double submissions, and network replays.

---

## Payments and refunds

### Online payment flow

```
Guest                Backend                    Razorpay
  │                     │                          │
  │ POST /create-order  │                          │
  │────────────────────►│  create order ──────────►│
  │◄── order id ────────│                          │
  │  checkout.js        │                          │
  │───────────────────────────────────────────────►│
  │◄── payment result (signature, ids) ────────────│
  │ POST /verify        │                          │
  │────────────────────►│  verify HMAC signature   │
  │                     │  mark payment captured   │
  │                     │  publish invoice/email   │
  │◄── success ─────────│                          │
  │                     │◄──── webhook (async) ────│
  │                     │  verify HMAC, dedupe,    │
  │                     │  reconcile state         │
```

- **Order creation** — an authenticated, validated booking produces a Razorpay order; the order reference is stored on the payment record.
- **Client verification** — `POST /verify` validates the returned signature server-side; the client's report is never trusted on its own.
- **Webhooks** — `POST /webhook` verifies the HMAC-SHA256 signature using the raw request body captured at parse time, compares in constant time, and deduplicates replayed events in Redis before applying state changes. Webhooks and client verification are both accepted, and either may arrive first; both paths write idempotent transitions.
- **Offline payments** — admins can record cash or offline settlements; the same downstream events (invoice, email) are published so reporting does not depend on the payment mode.

### Refund model

Refund state is **derived rather than stored**, which keeps the ledger consistent under retries:

- Cumulative refunds are capped against the **captured** amount, not the booking total, so a partially paid booking cannot be over-refunded.
- A single-in-flight guard prevents two concurrent refunds against the same payment.
- A gateway window check rejects refunds outside the provider's allowed period.
- `refund-ledger.service.ts` settles refunds idempotently; a repeated settlement for the same refund cannot double-apply.
- `booking-state.service.ts` computes refundable, captured, and refunded amounts and enforces the invariants above.
- Refund rows move through `REQUESTED → PROCESSED` or `FAILED`, and gateway failures are recoverable through the reconciliation job.

---

## Asynchronous processing

RabbitMQ carries work that should not block an HTTP response: invoice generation and email delivery.

### Topology

```
                       tribel.events (direct, durable)
                        │                │
              key: email│                │key: invoice
                        ▼                ▼
              tribel.email.queue   tribel.invoice.queue
                        │                │
                 (on failure)      (on failure)
                        ▼                ▼
                 tribel.retry    tribel.retry  (direct, durable)
                        │                │
              key:email.retry│           │key:invoice.retry
                        ▼                ▼
              tribel.email.retry   tribel.invoice.retry   (TTL 30s)
                        │                │
                        └───── dead-letters back to tribel.events ─────┐
                                                                       │
                        max retries exceeded                           │
                                ▼                                      │
                        tribel.dlx (direct, durable)                   │
                                │                                      │
                    key:email.failed / invoice.failed                  │
                                ▼                                      │
                    tribel.email.dlq / tribel.invoice.dlq ◄────────────┘
```

| Exchange | Type | Purpose |
|---|---|---|
| `tribel.events` | direct, durable | Primary publish point for work |
| `tribel.retry` | direct, durable | Holds messages for a delay before redelivery |
| `tribel.dlx` | direct, durable | Terminal destination for exhausted messages |

| Queue | Durability | Notes |
|---|---|---|
| `tribel.email.queue` | durable | Bound to `tribel.events` with key `email` |
| `tribel.invoice.queue` | durable | Bound to `tribel.events` with key `invoice` |
| `tribel.email.retry` | durable | 30s TTL, dead-letters back to `tribel.events` with key `email` |
| `tribel.invoice.retry` | durable | 30s TTL, dead-letters back to `tribel.events` with key `invoice` |
| `tribel.email.dlq` | durable | Bound to `tribel.dlx` with key `email.failed` |
| `tribel.invoice.dlq` | durable | Bound to `tribel.dlx` with key `invoice.failed` |

### Delivery semantics

- **Manual acknowledgement.** Consumers run with `noAck: false` and `prefetch(1)`, so each consumer holds one unacknowledged message at a time and processes in order.
- **Retry with delay.** A failed delivery is negatively acknowledged without requeue, which dead-letters it into the retry queue. After the TTL expires, the message returns to the primary exchange and is redelivered.
- **Retry ceiling.** The consumer reads the `x-death` header to count prior rejections. After three attempts, the message is published to the dead-letter exchange and acknowledged, so a poison message cannot loop forever.
- **Persistence.** Published messages are persistent and queues are durable, so a broker restart does not drop accepted work.

### Workers

| Worker | Responsibility |
|---|---|
| `email.worker` | Renders and sends transactional email through Resend |
| `invoice.worker` | Renders the invoice HTML template to PDF with Puppeteer and stores it in the private S3 bucket |
| `notification.worker` | Notification channel for user-facing alerts |

Workers are invoked by consumers and are independent of the HTTP request path, so email or invoice latency never affects API response time.

---

## Caching, rate limiting, and locking

All Redis usage is centralized under `src/lib/redis/`.

### Cache

| Key | TTL | Purpose |
|---|---|---|
| `session:<auth0Id>` | 3600s | Projected session (`id`, `role`, `email`, `name`) for every authenticated request |
| `user:<auth0Id>` | 3600s | User profile projection |
| `UserBookings:<...>` | varies | Guest booking list caching |
| `Occupancy:<propertyId>:<window>` | varies | Occupancy payloads for the dashboard |

Occupancy invalidation enumerates keys with `SCAN` and deletes them in batches, because Redis `DEL` does not accept glob patterns.

### Rate limiting

`src/lib/redis/redis-rate-limit.ts` implements a **sliding window log** as an atomic Lua script:

- Each allowed request is a member in a sorted set scored by timestamp.
- Expired members are trimmed on every call.
- The count is compared to the configured limit; denials compute `Retry-After` from the oldest surviving entry.

The limiter is applied per route category rather than globally:

| Limiter | Applied to |
|---|---|
| `loginRateLimit` | `/auth/login` — protects the login endpoint |
| `bookingRateLimit` | Booking creation and mutations |
| `propertyRateLimit` | Property create/update/delete |
| `roomTemplateRateLimit` | Room template mutations |
| `tenantRateLimit` | Tenant mutations |
| `userRateLimit` | Profile mutations |
| `publicGetRateLimit` | Read-heavy public and list endpoints |

Because the counters live in Redis rather than process memory, limits hold across multiple instances.

### Locks

`redis-lock.ts` provides `acquireLock` / `releaseLock` built on `SET key value PX <ttl> NX`, with a Lua compare-and-delete release so a lock can only be released by its owner. Jobs use this to ensure that a startup catch-up pass and a scheduled pass — or two containers — cannot apply the same transition twice.

---

## Background jobs

Jobs are registered at startup in `src/index.ts` and guarded by Redis locks.

| Job | Schedule | Purpose |
|---|---|---|
| `booking-lifecycle.job` | Daily at 00:05 IST, plus a catch-up pass at startup | Advances bookings through time-based transitions (check-in, checkout, expiry, no-show) using IST calendar semantics |
| `refund-reconciliation.job` | Every 30 minutes, plus a catch-up pass at startup | Reconciles refunds with the gateway, retries stuck settlements, and repairs derived refund state |

Startup catch-up exists because `node-cron` does not replay a window missed while the process was down; the job computes the missed window and applies it once, under a lock, so restarts and duplicate containers stay idempotent.

---

## Observability

- **Traces, metrics, and logs** are exported over OTLP to a SigNoz instance (`OTEL_EXPORTER_OTLP_ENDPOINT`). `src/instrumentation.ts` initializes the SDK before the application loads.
- **Structured logs** use Pino, with `pino-http` adding a request logger and correlation identifiers to every request.
- **Service identity** is carried by `APP_VERSION` (the commit SHA injected at image build) and `OTEL_SERVICE_NAME`, so telemetry can be tied back to a specific revision.
- **Error handling** funnels through a single handler that logs the error and returns a consistent JSON shape.

---

## Security

| Control | Implementation |
|---|---|
| Authentication | Auth0 sessions, server-side session projection, no trust in client claims |
| Authorization | `restrictTo` role guard per route, backed by database RLS |
| Tenant isolation | PostgreSQL row-level security with per-operation session context |
| Escalation protection | Database trigger rejecting direct role changes |
| Webhook integrity | HMAC-SHA256 verification against the raw body, constant-time comparison |
| Replay protection | Redis deduplication of webhook event IDs |
| Transport | HTTPS termination at the reverse proxy; secure, cross-site session cookie in production |
| Headers | `helmet` |
| Parameter pollution | `hpp` |
| Request size | 16 KB limits on JSON and URL-encoded bodies |
| Validation | Zod schemas on every mutating endpoint |
| Rate limiting | Redis sliding window, per route category |
| Redirect safety | `returnTo` values validated against an allowlist before use |
| Storage | Private S3 bucket for invoices, presigned URLs for upload and download |
| Secrets | Environment variables only; never committed |

---

## Deployment

### Container

`Dockerfile` builds a Node 22 Alpine image, generates the Prisma client, and runs the service with `tsx`. `APP_VERSION` is injected from the commit SHA at build time so telemetry can be correlated to a revision.

### Pipelines

**`ci.yaml` — pull requests to `main`:** install with `npm ci`, generate the Prisma client, run lint, type-check, and unit tests.

**`deploy.yaml` — pushes to `main`:** runs the same quality gates, builds the image, pushes `sheikhvalora/tribel-backend:latest` to Docker Hub, then deploys over SSH to EC2:

```
docker compose pull
docker compose up -d
```

### Runtime topology

`docker-compose.yml` describes the production composition on the EC2 host:

| Service | Image | Notes |
|---|---|---|
| `app` | `sheikhvalora/tribel-backend` | Reads `.env`, publishes OTLP telemetry, restart unless-stopped |
| `redis` | `redis:7.4.8-alpine` | Append-only persistence, password protected, volume-backed |
| `rabbitmq` | `rabbitmq:management-alpine` | Management UI, durable volumes |

PostgreSQL runs on managed AWS RDS rather than in Compose. `deploy/` contains the SigNoz configuration for the observability backend.

---

## Local development

### Prerequisites

Node.js 22+, PostgreSQL, Redis, and RabbitMQ. Docker Compose can provide Redis and RabbitMQ.

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.sample .env
# Fill in every variable listed in the environment table below

# 3. Start Redis and RabbitMQ (if not running locally)
docker compose up -d redis rabbitmq

# 4. Apply database migrations
npx prisma migrate dev

# 5. Generate the Prisma client
npx prisma generate

# 6. Run the server
npm run dev
```

The API listens on `PORT` (default `3000`).

### Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start with `tsx` watch mode |
| `npm run type-check` | TypeScript checks without emitting |
| `npm run lint` | ESLint |
| `npm run test:unit` | Unit test suite (the fast signal) |
| `npm test` | Full suite with the test environment loaded |
| `npm run test:integration` | Full suite loaded with `.env.test`, for real database-backed runs |

---

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port |
| `NODE_ENV` | Environment name; controls cookie and error behaviour |
| `APP_VERSION` | Commit SHA injected at image build for telemetry correlation |
| `LOG_LEVEL` | Pino log level |
| `DATABASE_URL` | Prisma connection string (migrations and administrative access) |
| `APP_DATABASE_URL` | Application connection string used with row-level security |
| `REDIS_URL` | Redis connection string |
| `RABBITMQ_URL` | RabbitMQ connection string |
| `CORS_ORIGIN` | Comma-separated allowed origins for credentialed requests |
| `FRONTEND_URL` | Frontend origin used for post-login and logout redirects |
| `BASE_URL` | Public base URL of this service |
| `COOKIE_DOMAIN` | Cookie domain for cross-subdomain sessions in production |
| `ISSUER_BASE_URL` | Auth0 tenant issuer URL |
| `CLIENT_ID` | Auth0 application client ID |
| `CLIENT_SECRET` | Auth0 application client secret |
| `AWS_REGION` | S3 region |
| `AWS_ACCESS_KEY` / `AWS_SECRET_ACCESS_KEY` | S3 credentials |
| `AWS_S3_BUCKET_NAME` | Public bucket for property images |
| `AWS_S3_PRIVATE_BUCKET_NAME` | Private bucket for invoice PDFs |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay API credentials |
| `RAZORPAY_WEBHOOK_SECRET` | Secret used to verify webhook signatures |
| `RESEND_API_KEY` | Email provider API key |
| `RESEND_FROM_EMAIL` | From address for transactional email |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint |
| `OTEL_SERVICE_NAME` | Service name reported in telemetry |

For local development, the observability variables may be left unset; instrumentation is skipped when no endpoint is configured.

---

## Testing

Tests use Vitest with two suites:

| Suite | Scope |
|---|---|
| `tests/unit/` | Pure logic: booking state and refund invariants, pricing and date boundaries, auth return-path safety, session-cookie resolution, response helpers |
| `tests/integration/` | Controllers and services against a real PostgreSQL instance, with Redis and RabbitMQ where required |

The integration setup refuses to run against non-local databases, so a test run cannot touch production data. Run `npm run test:unit` for a fast signal during development and the full suite before opening a pull request.

---

## Design decisions

| Decision | Rationale |
|---|---|
| Modular monolith over microservices | One deployable unit keeps transactions simple and operational cost low, while directory boundaries preserve separation of concerns. The domain's coordination needs (booking, payment, inventory) would otherwise require distributed transactions. |
| Database constraints over application-only checks | Exclusion constraints and row locks remain correct even when a code path forgets a check. Application validation is defence-in-depth on top, not the primary mechanism. |
| Row-level security alongside application authorization | A second, independent layer means a leaked or mistaken query still cannot read another tenant's rows. |
| Derived refund state | Storing cumulative refund state invites drift under retries; deriving it from the ledger makes reconciliation authoritative. |
| Webhooks plus client verification | Either signal can arrive first or be lost; accepting both with idempotent transitions avoids a single point of failure in payment confirmation. |
| Redis for limits, caches, and locks | Counters and locks must hold across instances; process memory would not. |
| Async invoice and email | Rendering a PDF takes seconds; the booking response should not wait for it, and failed side effects belong in a queue with retries and a dead-letter path. |
| Half-open date ranges | Encoding stays as `[start, end)` everywhere, so billing nights, availability, and the exclusion constraint all agree. |
| Idempotency keys on creation | Booking is the one operation where a duplicate costs real money; making it replay-safe at the API boundary removes that class of bug. |
