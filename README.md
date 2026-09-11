# Arborline Logistics

Arborline is an automated freight-brokerage operations platform built around **exception-only operations**: routine freight should move from quote to capacity search, carrier offer, booking, tracking, documents, invoicing, and settlement without a human dispatcher touching it.

## Live deployment

Production is deployed on Vercel at `https://arborline-logistics.vercel.app` and is backed by the dedicated Arborline Logistics Supabase Postgres project. Runtime secrets such as `DATABASE_URL` are configured in Vercel and are never committed to this repository. Deployment configuration is intentionally managed through Vercel so production secrets remain outside source control.

## Working operational flow

The repository now contains a functioning quote-to-booking loop:

1. A shipper enters a shipment at `/shipper/new`.
2. Deterministic pricing creates an expiring quote with target margin and carrier ceiling.
3. Accepting the quote creates a load atomically.
4. Autopilot searches nearby verified/available trucks using PostGIS and expands the radius when needed.
5. Candidates are hard-filtered and ranked by proximity, reliability, rate fit, tracking compliance, and fraud risk.
6. The top eligible carriers receive persistent outbound offer messages in the outbox.
7. Every offer has an opaque carrier link at `/carrier/offers/:token` where the carrier can accept, decline, or counter.
8. Carrier responses pass through hard booking guardrails.
9. A safe response books the carrier atomically and cancels competing offers/messages.
10. If every carrier declines or an offer expires, Autopilot searches again while excluding those failed offers.
11. Risk, high-value cargo, low margins, excessive counters, missing geocoding, or no capacity become human exceptions.

The system never reports an outbound message as delivered unless a configured provider confirms it. Without a provider, messages remain visible in `/outbox` and the carrier offer link can still be opened manually for testing.

## Local setup

```bash
cp .env.example .env.local
docker compose up -d
npm install
npm run dev
```

For an existing database created from an earlier version:

```bash
set -a; source .env.local; set +a
npm run db:migrate
```

To add three safe fake carriers/trucks around Chicago for local testing:

```bash
npm run db:seed
```

Open `http://localhost:3000` and use **New quote**. Chicago → Dallas is prefilled because both cities are available in the built-in development geocoder and the demo trucks are near Chicago.

## Carrier offers and outbound delivery

Offer records contain random public UUID tokens; database IDs are not exposed to carriers. The legacy offer-by-ID response endpoint is protected by `AUTOMATION_INTERNAL_TOKEN`.

To connect SMS/email/push delivery, configure a server-side webhook:

```env
APP_BASE_URL=https://your-domain.example
AUTOMATION_INTERNAL_TOKEN=long-random-secret
OUTBOUND_WEBHOOK_URL=https://your-provider-adapter.example/messages
OUTBOUND_WEBHOOK_TOKEN=optional-provider-secret
```

The webhook receives the message channel, recipient, template, payload, and an absolute carrier `offerUrl`. Failed deliveries are retried with bounded backoff. Missing carrier contacts are held as `WAITING_CONTACT` instead of being falsely marked sent.

## Automation tick

Production should schedule the protected automation tick on a short interval. One call handles both routine maintenance and outbound work: it expires stale offers, automatically relaunches capacity search when the final offer dies, and dispatches the outbound queue.

```bash
curl -X POST http://localhost:3000/api/internal/automation/tick \
  -H "Authorization: Bearer $AUTOMATION_INTERNAL_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"outboxLimit":25}'
```

The narrower `/api/internal/outbox/dispatch` endpoint is also available when a deployment wants separate scheduling for message delivery.

## APIs

- `GET/POST /api/quotes` — quote history / create quote
- `POST /api/quotes/:id/accept` — accept quote, create load, start Autopilot
- `GET/POST /api/loads` — load history / direct load creation
- `POST /api/loads/:id/autopilot` — rerun capacity search + offers
- `POST /api/public/offers/:token/respond` — carrier accept, decline, or counter using opaque offer token
- `POST /api/offers/:id/respond` — internal-only offer response endpoint
- `POST /api/internal/automation/tick` — expire stale offers, recover capacity, and dispatch outbound messages
- `POST /api/internal/outbox/dispatch` — protected outbound-only worker entrypoint
- `POST /api/matches` — pure carrier-ranking endpoint
- `POST /api/automation/booking` — pure booking-guardrail endpoint
- `GET /api/health` — service health

## Safety and compliance architecture

AI will later handle language-heavy work such as email intake, negotiation phrasing, document interpretation, customer support, and exception summaries. Deterministic rules remain authoritative for carrier eligibility, booking locks, fraud blocks, pricing ceilings, payment approval, permissions, and compliance-sensitive decisions.

Production launch still requires broker authority, financial security, contracts, legal/compliance review, authoritative carrier identity/insurance integrations, secure staff/shipper authentication and RBAC, secrets management, privacy/security controls, and production payment processes.

## Next milestones

- Staff/shipper authentication and role-based access
- Authoritative FMCSA/carrier-verification adapter
- Real geocoding/routing and market-rate provider adapters
- Production scheduler and SMS/email provider adapter
- Driver tracking/geofences and automated service-risk recovery
- BOL/POD document intake and validation
- Shipper invoicing, carrier settlement, and payment holds
- External contracted capacity-provider adapters
