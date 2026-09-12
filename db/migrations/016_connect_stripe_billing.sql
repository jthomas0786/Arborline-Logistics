ALTER TABLE connect_clients
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'UNBILLED',
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_latest_invoice_id text,
  ADD COLUMN IF NOT EXISTS billing_current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS billing_last_paid_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'connect_clients_billing_status_check'
  ) THEN
    ALTER TABLE connect_clients
      ADD CONSTRAINT connect_clients_billing_status_check
      CHECK (billing_status IN ('UNBILLED','PENDING','ACTIVE','PAST_DUE','CANCELED'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS connect_clients_stripe_customer_uidx
  ON connect_clients (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS connect_clients_stripe_subscription_uidx
  ON connect_clients (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS connect_stripe_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  processed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS connect_stripe_webhook_events_type_idx
  ON connect_stripe_webhook_events (event_type, processed_at DESC);
