# Arborline Logistics

Arborline is an automated freight-brokerage operations platform built around **exception-only operations**: routine freight should move from quote to capacity search, carrier offer, booking, tracking, documents, invoicing, and settlement without a human dispatcher touching it.

## Live deployment

Production is deployed on Vercel at `https://arborline-logistics.vercel.app` and is backed by the dedicated Arborline Logistics Supabase Postgres project. Runtime secrets such as `DATABASE_URL` are configured in Vercel and are never committed to this repository. Deployment configuration is intentionally managed through Vercel so production secrets remain outside source control. The production project environment is linked directly to the Arborline deployment.

Authentication uses Supabase Auth with Arborline authorization roles stored server-side in `app_users`. Vercel must provide `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to both Preview and Production deployments. After adding or changing either environment variable, create a fresh Vercel deployment so the new values are injected into the runtime.

## Working operational flow

The repository contains the core freight lifecycle from customer quote through financial closeout:

1. A shipper enters a shipment at `/shipper/new`.
2. Deterministic pricing creates an expiring quote with target margin and carrier ceiling.
3. Accepting the quote rechecks customer credit/exposure and creates a load atomically.
4. Autopilot searches nearby verified/available trucks using PostGIS and expands the radius when needed.
5. Candidates are hard-filtered and ranked by proximity, reliability, rate fit, tracking compliance, and fraud risk.
6. Eligible carriers receive offer notifications through email and/or native Web Push.
7. Every offer has an opaque carrier link at `/carrier/offers/:token` where the carrier can accept, decline, or counter.
8. Carrier responses pass through hard booking guardrails and fresh compliance checks.
9. A safe response books the carrier atomically and cancels competing offers/messages.
10. Carrier dispatch assigns the driver; email provides the first driver tracking link and the driver can opt into Web Push for ongoing alerts.
11. Driver milestones, POD capture, invoicing, carrier payable creation, settlement, and closeout are audited end to end.
12. Risk, compliance failures, no capacity, delivery failures, overdue receivables, and other abnormal conditions become human exceptions.

Resend email records provider acceptance and webhook delivery/bounce events. Native Web Push records push-service acceptance and automatically revokes expired browser subscriptions. Messages that cannot yet be pushed because the recipient has not opted in remain visible as `WAITING_SUBSCRIBER` in `/outbox`.

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

## Email and Web Push

Arborline intentionally uses only **Resend email** and standards-based **Web Push/PWA notifications** for outbound delivery. SMS/Twilio is not part of the communication architecture.

Configure:

```env
APP_BASE_URL=https://your-domain.example
AUTOMATION_INTERNAL_TOKEN=long-random-secret
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_WEBHOOK_SECRET=
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=https://your-domain.example
```

Register `/api/webhooks/resend` as the Resend webhook endpoint. Web Push subscriptions are created from explicit user opt-in in Arborline and are scoped to the authenticated account or opaque carrier/driver capability link that registered the device. Carrier offers are queued to Web Push and to dispatch email when available. Driver tracking is queued to Web Push and to the driver's email when supplied. Phone numbers may still be stored as operational contact information but are not used for messaging.

Arborline is installable as a PWA. The service worker handles background push notifications and notification clicks. On platforms that require installation before web push is available, users can add Arborline to the home screen and then enable notifications from the app.

## Automation tick

Production should schedule the protected automation tick on a short interval. One call handles routine maintenance and outbound work: it expires stale offers, automatically relaunches capacity search when the final offer dies, runs compliance rechecks, and dispatches the outbound queue.

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
- `POST /api/internal/automation/tick` — maintenance, recovery, verification, and outbound delivery
- `POST /api/internal/outbox/dispatch` — protected outbound-only worker entrypoint
- `GET/POST/DELETE /api/push/subscriptions` — authenticated browser push subscription management
- `POST/DELETE /api/public/push/subscriptions` — capability-scoped carrier/driver push subscription management
- `POST /api/matches` — pure carrier-ranking endpoint
- `POST /api/automation/booking` — pure booking-guardrail endpoint
- `GET /api/health` — service health

## Safety and compliance architecture

AI may handle language-heavy work such as email intake, negotiation phrasing, document interpretation, customer support, and exception summaries. Deterministic rules remain authoritative for carrier eligibility, booking locks, fraud blocks, pricing ceilings, payment approval, permissions, and compliance-sensitive decisions.

Production launch still requires broker authority, financial security, contracts, legal/compliance review, authoritative carrier identity/insurance integrations, privacy/security controls, and production payment processes.

## Next milestones

- Activate real FMCSA/insurance provider credentials and validate production carrier onboarding
- Replace demo/public routing with a commercial geocoding/routing provider
- Move POD/document bytes from Postgres to durable object storage
- Add BOL capture and loading guardrails
- Connect real payment/ACH rails after settlement controls are proven
- Build claims, fraud, and exception-resolution workflows
