# ArborLine Connect

**Qualified business connections. Automatically.**

ArborLine Connect is being built as an automation-first B2B prospecting, qualification, and appointment-generation platform for recurring service businesses.

The initial launch market is commercial cleaning because the target accounts, service areas, and buying roles are straightforward to define. The product is intentionally broader than one niche so the same engine can later support adjacent commercial services.

## Product direction

The normal workflow is designed to become:

`Client ICP → prospect discovery → enrichment → fit scoring → personalized outreach → follow-up → reply classification → qualification → appointment handoff → reporting`

The operating goal is for **85–95% of normal activity to run without manual intervention**, while humans handle unusual replies, disputes, strategic accounts, and high-value conversations.

A qualified appointment is not merely a contact or a meeting acceptance. A valid handoff should match the client’s targeting rules, involve a relevant decision maker or influencer, contain a legitimate reason to discuss the service, and include a specific agreed next step.

## Current application structure

- `/` — public ArborLine Connect website and founding-pilot interest form
- `/login` — secure account access
- `/operations` — internal Connect dashboard
- `/prospects` — target-account workspace foundation
- `/campaigns` — outbound automation foundation
- `/appointments` — qualified handoff workspace foundation
- `/clients` — client ICP and qualification-rules foundation
- `/outbox` — communications queue retained from the existing automation stack

## Reused infrastructure

The repository began as an automated freight-brokerage prototype. Useful infrastructure is being retained during the pivot, including Supabase authentication/RBAC, PostgreSQL, audit-friendly workflows, Resend email integration, Web Push/PWA support, Vercel deployment, and the existing ArborLine visual system.

Legacy freight routes and database objects remain in the repository temporarily for reference and reuse, but they are no longer the public ArborLine Connect product direction.

## Stack

- Next.js / React / TypeScript
- PostgreSQL / Supabase Auth
- Vercel
- Resend for email
- Native Web Push / PWA notifications

## Local development

```bash
npm install
npm run typecheck
npm run dev
```

Database migrations are in `db/migrations` and are additive. Do not rerun the original non-idempotent foundation schema against an existing environment.
