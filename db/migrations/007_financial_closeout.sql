ALTER TABLE shippers ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE shipper_invoices ADD COLUMN IF NOT EXISTS queued_at timestamptz;
ALTER TABLE shipper_invoices ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE shipper_invoices ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE shipper_invoices ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE carrier_payables ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE carrier_payables ADD COLUMN IF NOT EXISTS payment_reference text;

CREATE TABLE IF NOT EXISTS financial_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES shipper_invoices(id) ON DELETE SET NULL,
  payable_id uuid REFERENCES carrier_payables(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'INVOICE_QUEUED','SHIPPER_PAYMENT_RECORDED','PAYABLE_HELD','PAYABLE_RELEASED',
    'CARRIER_PAYMENT_RECORDED','LOAD_SETTLED','LOAD_CLOSED'
  )),
  direction text NOT NULL CHECK (direction IN ('AR','AP','SYSTEM')),
  amount numeric(12,2),
  method text,
  reference text,
  is_test boolean NOT NULL DEFAULT true,
  actor_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_events_load_idx ON financial_events(load_id,created_at DESC);
ALTER TABLE financial_events ENABLE ROW LEVEL SECURITY;
