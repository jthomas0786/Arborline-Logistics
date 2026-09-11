DO $$ BEGIN CREATE TYPE quote_status AS ENUM ('OPEN','ACCEPTED','EXPIRED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE carriers ADD COLUMN IF NOT EXISTS banking_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text UNIQUE NOT NULL,
  shipper_id uuid REFERENCES shippers(id),
  status quote_status NOT NULL DEFAULT 'OPEN',
  origin_city text NOT NULL,
  origin_state text NOT NULL,
  origin_location geography(Point,4326),
  destination_city text NOT NULL,
  destination_state text NOT NULL,
  destination_location geography(Point,4326),
  pickup_start timestamptz NOT NULL,
  equipment_type text NOT NULL,
  estimated_miles numeric(8,1) NOT NULL,
  weight_lbs integer,
  commodity text,
  cargo_value numeric(12,2),
  expected_carrier_cost numeric(12,2) NOT NULL,
  target_carrier_rate numeric(12,2) NOT NULL,
  max_carrier_rate numeric(12,2) NOT NULL,
  shipper_price numeric(12,2) NOT NULL,
  target_margin_pct numeric(5,2) NOT NULL,
  pricing_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loads ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES quotes(id);
CREATE UNIQUE INDEX IF NOT EXISTS loads_quote_id_unique ON loads(quote_id) WHERE quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbox_messages (
  id bigserial PRIMARY KEY,
  load_id uuid REFERENCES loads(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES carriers(id),
  channel text NOT NULL,
  recipient text NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_messages(status,available_at);
