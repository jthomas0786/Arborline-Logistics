-- Durable claim-level idempotency for the GitHub-runner mailbox verifier.
-- A claim UUID is minted when a domain lock is acquired and is carried back
-- with the SMTP result. The unique attempt index guarantees the same claim
-- cannot be recorded twice, even if the result POST is retried.

alter table public.connect_mailbox_domain_state
  add column if not exists active_claim_id uuid;

alter table public.connect_mailbox_verification_attempts
  add column if not exists claim_id uuid;

create unique index if not exists connect_mailbox_verification_attempts_claim_uidx
  on public.connect_mailbox_verification_attempts (claim_id)
  where claim_id is not null;

create index if not exists connect_mailbox_domain_state_active_claim_idx
  on public.connect_mailbox_domain_state (active_claim_id)
  where active_claim_id is not null;
