# Arborline Logistics

Automated freight-brokerage operations platform. The product is designed around **exception-only operations**: routine loads move from intake to matching, booking, tracking, POD, invoicing, and settlement automatically; a human sees only the decisions that exceed configured risk or margin guardrails.

## What is in this first foundation

- Next.js 16 web application and Autopilot operations dashboard
- PostgreSQL + PostGIS data model for shippers, carriers, trucks, loads, offers, bookings, events, exceptions, and automation decisions
- Deterministic carrier matching/ranking engine with hard eligibility gates
- Booking automation engine with margin, authority, insurance, fraud, banking-change, and cargo-value guardrails
- Load creation/list API
- Standalone match-ranking API for testing the carrier selection logic before external integrations are connected
- Docker Compose local PostGIS environment
- GitHub Actions typecheck/build validation

## Local setup

1. Install Node.js 24+ and Docker.
2. Copy `.env.example` to `.env.local`.
3. Start PostgreSQL/PostGIS:

```bash
docker compose up -d
```

4. Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Health check: `GET /api/health`

## API examples

Create a load:

```bash
curl -X POST http://localhost:3000/api/loads \
  -H 'content-type: application/json' \
  -d '{
    "originCity":"Chicago",
    "originState":"IL",
    "destinationCity":"Dallas",
    "destinationState":"TX",
    "pickupStart":"2026-09-14T14:00:00Z",
    "equipmentType":"DRY_VAN",
    "weightLbs":38000,
    "commodity":"Packaged food",
    "shipperRate":3000,
    "targetCarrierRate":2450,
    "maxCarrierRate":2550
  }'
```

Evaluate booking automation:

```bash
curl -X POST http://localhost:3000/api/automation/booking \
  -H 'content-type: application/json' \
  -d '{
    "shipperRate":3000,
    "carrierRate":2450,
    "carrierFraudScore":12,
    "authorityActive":true,
    "insuranceValid":true,
    "bankingChangedWithin48Hours":false,
    "cargoValue":32000
  }'
```

## Architecture principle

AI will be used for language-heavy work (email intake, document interpretation, negotiation, support, exception summaries). Deterministic rules remain responsible for money limits, carrier eligibility, booking locks, fraud blocks, payment approval, permissions, and compliance-sensitive gates.

## Next build milestones

1. Authentication and role-based access for admin, shipper, carrier, and driver users
2. Shipper quote/tender workflow and pricing guardrails
3. Carrier onboarding and authoritative identity/authority verification adapters
4. PostGIS nearby-capacity search with expanding radius strategy
5. Offer lifecycle and atomic carrier booking transaction
6. Driver tracking/geofences and late-pickup prediction
7. BOL/POD document storage and extraction
8. Invoicing, carrier settlement, and payment holds
9. Email/SMS communications agent
10. External capacity provider adapters (contracted load-board/API providers)

## Important

This repository is an engineering foundation, not a representation that the brokerage is legally ready to operate. Production launch requires the appropriate broker authority, financial security, contracts, insurance/compliance processes, privacy/security controls, and legal review. Carrier identity and payment changes should remain hard-gated rather than delegated solely to an AI model.
