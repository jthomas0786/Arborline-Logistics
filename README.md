# Arborline Logistics

Arborline is an automated freight-brokerage operations platform built around **exception-only operations**: routine freight should move from quote to capacity search, offer, booking, tracking, documents, invoicing, and settlement without a human dispatcher touching it.

## Working operational flow

The repository now contains the first end-to-end brokerage workflow:

1. Shipper enters a shipment at `/shipper/new`.
2. Deterministic pricing creates an expiring quote with target margin and carrier ceiling.
3. Accepting the quote creates a load atomically.
4. Autopilot searches nearby verified/available trucks using PostGIS and expands the radius when needed.
5. Candidates are hard-filtered and ranked by proximity, reliability, rate fit, tracking compliance, and fraud risk.
6. The top eligible carriers receive persistent outbound offer messages in the outbox.
7. Carrier accept/counter/decline responses pass through hard booking guardrails.
8. A safe response books the carrier atomically and cancels competing offers.
9. Risk, high-value cargo, low margins, excessive counters, missing geocoding, or no capacity become human exceptions.

External communication is intentionally represented by a persistent outbox until an SMS/email/app provider is connected. The system never reports an offer as externally delivered without a provider adapter.

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

## APIs

- `GET/POST /api/quotes` — quote history / create quote
- `POST /api/quotes/:id/accept` — accept quote, create load, start Autopilot
- `GET/POST /api/loads` — load history / direct load creation
- `POST /api/loads/:id/autopilot` — rerun capacity search + offers
- `POST /api/offers/:id/respond` — carrier accept, decline, or counter
- `POST /api/matches` — pure carrier-ranking endpoint
- `POST /api/automation/booking` — pure booking-guardrail endpoint
- `GET /api/health` — service health

Example carrier response:

```bash
curl -X POST http://localhost:3000/api/offers/OFFER_ID/respond \
  -H 'content-type: application/json' \
  -d '{"response":"COUNTER","counterRate":2475}'
```

## Safety and compliance architecture

AI will later handle language-heavy work such as email intake, negotiation phrasing, document interpretation, customer support, and exception summaries. Deterministic rules remain authoritative for carrier eligibility, booking locks, fraud blocks, pricing ceilings, payment approval, permissions, and compliance-sensitive decisions.

Production launch still requires broker authority, financial security, contracts, legal/compliance review, authoritative carrier identity/insurance integrations, secure authentication/RBAC, secrets management, privacy/security controls, and production payment processes.

## Next milestones

- Authentication and role-based access for staff, shippers, carriers, and drivers
- Authoritative FMCSA/carrier-verification adapter
- Real geocoding/routing and market-rate provider adapters
- SMS/email/push outbox worker and carrier offer links
- Driver tracking/geofences and service-risk recovery
- BOL/POD document intake and validation
- Shipper invoicing, carrier settlement, and payment holds
- External contracted capacity-provider adapters
