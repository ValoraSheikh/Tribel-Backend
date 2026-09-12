# Booking System Blueprint — Hostel/PMS Research & Tribel Gap Analysis

> Scope: how end-to-end booking systems work in production hostel/property-management
> products (Cloudbeds, Opera, Beds24, Little Hotelier, eZee), and where the Tribel
> implementation stands against them. Primary sources were fetched and read for the
> load-bearing claims; every claim cites its page.
> Date: 2026-09-03.

## 1. Inventory & availability model

Production PMS products separate three layers: **room types** (what you sell —
"Deluxe Dorm"), **physical rooms** (inventory units inside a type), and
**beds/spaces** (the actual bookable unit in dorms). Availability for any date
range is *derived*, never stored: `available = inventory − sum(active bookings
overlapping the range) − blocks`. Cloudbeds exposes exactly this through its
API: reservations carry room-level sub-units, and availability comes from
subtracting confirmed reservations and blocks from per-date inventory
([Cloudbeds API](https://developers.cloudbeds.com/reference/put_putreservation-2)).

Beds24 goes furthest for dorms: it models **bed-level availability per date**
and treats overbooking as a per-room-type setting rather than a hard error
([Beds24 wiki](https://wiki.beds24.com/index.php/Main_Page)).

Key production behaviors:

- Occupancy is **date-windowed**. A bed is "occupied" *on a given night*, not
  globally. A booking starting next month must not make a bed show occupied today.
- **Blocks/out-of-service** are first-class: a bed can be unusable (maintenance)
  without a booking attached.
- Availability checks happen **at creation, inside the same transaction** as the
  booking insert — the client is never trusted to have re-checked.

**Tribel today:** rooms → beds exist and belong to room templates; availability
is *not* enforced at creation (no overlapping-booking conflict check on a bed);
the inventory table shows a bed as occupied because `Bed.userId` is set — a
global assignment, not a date-windowed one, so a booking starting next month
already renders the bed taken.

## 2. Booking lifecycle states

Cloudbeds' reservation lifecycle is the hostel-benchmark:
`confirmed`, `not_confirmed`, `canceled`, `checked_in`, `checked_out`,
`no_show` — exposed verbatim in the API
([putReservation](https://developers.cloudbeds.com/reference/put_putreservation-2))
and the UI ([Reservation Details](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/8354513114907-Reservation-Details-Page-Everything-you-need-to-know)).
Oracle Opera models the same stages as arrival/occupancy/departure phases:
**Due In → In House → Due Out → Departed**, with Cancelled and No-Show as
terminal branches ([Opera 5.6 help](https://docs.oracle.com/cd/E98457_01/index.html)).

Production rules that matter:

- **Who moves the state:** check-in/out is an *explicit front-desk action*
  ([Cloudbeds check-in/out](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/221677468-Check-in-and-check-out-guests-in-Cloudbeds-PMS)),
  while no-show sweeps and auto-archival of past departures are *date-based
  jobs*. Confirmed bookings do not silently become "completed" — they pass
  through checked-out so the folio can be settled.
- **Check-out is gated on money**: Cloudbeds' API refuses `checked_out` while a
  balance is open
  ([Check-in docs](https://developers.cloudbeds.com/docs/check-in-upsell-upgrade)).
- **Cancellation records its actor**: the API has an explicit `canceledByGuest`
  flag that must accompany `status='canceled'`, and the reservation records
  *who* cancelled it
  ([putReservation](https://developers.cloudbeds.com/reference/put_putreservation-2)).

**Tribel today:** `PENDING → CONFIRMED → ONGOING → COMPLETED` with
`CANCELLED/REJECTED` terminal — a reasonable map of the above, except: nothing
ever moves CONFIRMED → ONGOING → COMPLETED (no date-based job, no explicit
check-in/out actions), there is **no no-show state**, and booking records don't
capture cancellation actor separately (admin vs guest is implicit in which
endpoint ran).

## 3. Payment states & flows

Production products decouple **who collects money** from **what the booking
status is**. The folio (payment list) is the source of truth; the booking's
payment status is an aggregate of the folio. Three standard flows:

1. **Full prepay (online)** — gateway collects at booking; webhook confirms.
2. **Pay at property (offline)** — nothing collected until arrival; the desk
   records a payment (method, reference, who took it, when) via an explicit
   action.
3. **Deposit** — part now, rest at property; booking shows partial payment.

A reservation can't leave the "open balance" state until the folio is settled
([Cloudbeds check-out gating](https://developers.cloudbeds.com/docs/check-in-upsell-upgrade)).

**Tribel today:** `Payment` rows with provider/reference/paidAt/verifiedById are
the folio — good. `mark-paid` and `record-refund` actions exist and are
guarded. Missing: partial payments/deposits, and `paymentStatus` transitions
are correct but the folio has no "open balance" concept gating check-out.

## 4. Refunds

The universal production rule: **a refund is a separate, recorded action — never
an automatic status flip**. The payment record stays intact; a refund record is
appended with amount, method, reference, and timestamp. Razorpay's refund
entity is exactly this: amount (partial allowed), status
`pending → processed` (or `failed`), speed, and it **cannot refund payments
older than 6 months**
([Razorpay Refunds](https://razorpay.com/docs/api/refunds/)).

Refund status must be tracked asynchronously: `pending` until the gateway
confirms `processed` — an instantly-flipped "REFUNDED" is a lie if the gateway
fails.

**Tribel today:** refund-as-separate-action is implemented correctly (amount,
method, reference, refundedAt, verifiedById; full → REFUNDED, partial →
PARTIALLY_PAID, over-refund rejected). Missing: the Razorpay API call (admin
pastes the refund id today — by design, deferred), refund *state* (no
pending/processed distinction), and any 6-month window guard.

## 5. Cancellation policies & windows

Products configure **policy types** (flexible / moderate / strict) that define
a cutoff: free cancellation until N days before check-in, then a fee % or the
first night, then nothing inside the last window. Cancellation inside the stay
(mid-stay) is an *admin decision with manual settlement*, not a guest
self-service action. After the end date, "cancelling" is meaningless — the
stay happened; corrections happen on the folio
([Cloudbeds cancellations](https://myallocator.cloudbeds.com/hc/en-us/sections/204039458-Cancellations)).

**Tribel today + the agreed policy matrix** (from the bookings-engine diagram):

| Action | Rule |
|---|---|
| Guest cancel — offline, unpaid | Allowed **before start date** (PENDING or CONFIRMED) |
| Guest cancel — online (paid) | Allowed **before start date**; payment stays PAID → admin records refund |
| Guest cancel — mid-stay (ONGOING) | **Blocked** — "can't cancel in-between without admin permission" |
| Anyone cancel — after end date | **Blocked** (COMPLETED is final; corrections go on the folio) |
| Admin cancel | Allowed until end date **including mid-stay (ONGOING)**; if paid → refund action follows |
| Admin cancel — after end date | Blocked |

**Gap:** current guards are stricter than the matrix — guest cancel is
PENDING-only (should be PENDING/CONFIRMED pre-arrival, unpaid-offline-only for
offline), and admin cancel excludes ONGOING (should include it). Code deltas
are listed in §9.

## 6. Check-in / check-out

Front-desk actions, per guest/per bed in dorms (Cloudbeds toggles occupancy per
accommodation inside one reservation), with the checkout gate on settled folios
([Cloudbeds check-in/out](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/221677468-Check-in-and-check-out-guests-in-Cloudbeds-PMS)).
Walk-ins are check-in + booking creation fused into one flow.

**Tribel today:** no explicit check-in/check-out actions; ONGOING/COMPLETED are
not reachable by any endpoint. The drawer has no front-desk workflow.

## 7. Overbooking prevention

Production systems prevent double-booking by checking **overlapping active
bookings per bed inside the creation transaction** (row-locked or
unique-constraint backed). Beds24 makes it configurable per room type; hard
stop is the default for hostels because a sold bed twice is a walk-out.

**Tribel today:** no conflict check at all — two guests can hold the same bed
for the same nights. This is the highest-severity gap. A
`@@unique([bedId, ...])`-style exclusion or a transactional overlap check in
`createBooking` is required.

## 8. Pricing models

- **Nightly per bed** — the hostel standard (Hostelworld model).
- **Monthly/long-stay** — the co-living standard (Zolo/Stanza tier), often with
  deposits and lock-ins.
- **LOS (length-of-stay) pricing** — rate varies with stay length; seasonal
  rate calendars layered on top.
- Tribel's agreed hybrid: nightly (`pricePerBed ÷ 30`) under 30 nights, started
  months at or above — implemented server-side in `booking-state.service.ts`
  with a client-side mirror for the booking flow.

**Tribel today:** hybrid in place; deposits, tenure tiers, seasonal rates not
modeled (deferred — acceptable).

## 9. Gaps & recommendations

| # | Area | Production standard | Tribel today | Recommendation | Priority |
|---|---|---|---|---|---|
| 1 | Overbooking | Transactional overlap check per bed | None — double-booking possible | Bed-level overlap check in `createBooking` (same transaction) | **P0** |
| 2 | Lifecycle automation | Date-based jobs (no-show sweep, auto-advance) | Nothing advances ONGOING/COMPLETED | Daily job: start→ONGOING at startDate, end→COMPLETED at endDate (and folio check) | **P0** |
| 3 | Cancellation matrix | Per-policy windows | Stricter than agreed matrix | Update guards: guest = PENDING/CONFIRMED pre-arrival (offline: unpaid only); admin += ONGOING; never post-end-date | **P0** |
| 4 | Occupancy semantics | Date-windowed | `Bed.userId` global assignment | Derive current occupancy from active bookings in window, not `Bed.userId`; keep `userId` only as long-term tenant shortcut | P1 |
| 5 | Check-in/out | Explicit front-desk actions, folio-gated checkout | Absent | Add check-in/check-out endpoints + drawer actions; block check-out while unpaid (offline) | P1 |
| 6 | No-show | Dedicated state + sweep job | Absent | Add NO_SHOW status (terminal) + daily sweep for no-shows | P1 |
| 7 | Refund lifecycle | pending → processed async | Instant flip | Track refund status; webhook/refresh confirms processed; Razorpay API call to replace manual id entry | P1 |
| 8 | Deposits | Deposit at booking (co-living standard) | Absent | Schema: depositAmount/depositPaid; collect with offline flow | P2 |
| 9 | Cancellation fees | Fee % / first-night inside window | Free cancel until window closes | Add policy field (days + fee%) when monetization matters | P2 |

## 10. Proposed target state machine

```
Booking:  PENDING ──approve──▶ CONFIRMED ──check-in──▶ ONGOING ──check-out──▶ COMPLETED
             │  │                  │   │                │
             │  └─reject──▶ REJECTED│   └──admin cancel──┐
             └─cancel (pre-arrival)▼                    ▼
                                  CANCELLED ◀──admin cancel (any pre-end state)
Payment:  PENDING ──mark-paid(offline)/webhook(online)──▶ PAID
          PAID ──record-refund(full)──▶ REFUNDED
          PAID ──record-refund(partial)──▶ PARTIALLY_PAID ──record-refund──▶ REFUNDED
No-show:  CONFIRMED + start date passed without check-in ──sweep job──▶ NO_SHOW
```

Guest cancel: pre-arrival only; offline must be unpaid; online keeps PAID and
surfaces a refund duty to the admin. Admin cancel: anything before the end
date, including mid-stay, with refund duty when paid. Nothing cancels or
refunds after the end date — corrections happen on the folio.
