CREATE TABLE IF NOT EXISTS load_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN ('POD','BOL','OTHER')),
  status text NOT NULL DEFAULT 'VALIDATED' CHECK (status IN ('RECEIVED','VALIDATED','REJECTED')),
  file_name text NOT NULL,
  content_type text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0),
  sha256 text NOT NULL,
  content bytea NOT NULL,
  uploaded_via text NOT NULL DEFAULT 'DRIVER_LINK',
  validation_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz
);
CREATE INDEX IF NOT EXISTS load_documents_load_idx ON load_documents(load_id,uploaded_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS load_documents_one_valid_pod_per_load
  ON load_documents(load_id)
  WHERE document_type='POD' AND status='VALIDATED';

CREATE TABLE IF NOT EXISTS shipper_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid UNIQUE NOT NULL REFERENCES loads(id),
  shipper_id uuid NOT NULL REFERENCES shippers(id),
  invoice_number text UNIQUE NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('DRAFT','ISSUED','PAID','VOID')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shipper_invoices_status_idx ON shipper_invoices(status,due_at);

CREATE TABLE IF NOT EXISTS carrier_payables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid UNIQUE NOT NULL REFERENCES loads(id),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),
  carrier_id uuid NOT NULL REFERENCES carriers(id),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'READY' CHECK (status IN ('HOLD','READY','SCHEDULED','PAID','VOID')),
  eligible_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz,
  paid_at timestamptz,
  hold_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_payables_status_idx ON carrier_payables(status,eligible_at);

ALTER TABLE load_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipper_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_payables ENABLE ROW LEVEL SECURITY;
