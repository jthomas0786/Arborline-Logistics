CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE organization_type AS ENUM ('SHIPPER','CARRIER','BROKER');
CREATE TYPE load_status AS ENUM ('DRAFT','VALIDATING','QUOTED','SHIPPER_ACCEPTED','SEARCHING','OFFERING','BOOKED','DISPATCHED','AT_PICKUP','LOADED','IN_TRANSIT','AT_DELIVERY','DELIVERED','POD_RECEIVED','INVOICED','SETTLED','CLOSED','EXCEPTION','CANCELLED');
CREATE TYPE offer_status AS ENUM ('PENDING','OPENED','ACCEPTED','DECLINED','COUNTERED','EXPIRED','CANCELLED');
CREATE TYPE exception_status AS ENUM ('OPEN','ACKNOWLEDGED','RESOLVED');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type organization_type NOT NULL,
  legal_name text NOT NULL,
  dba_name text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shippers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid UNIQUE NOT NULL REFERENCES organizations(id),
  credit_status text NOT NULL DEFAULT 'PENDING',
  credit_limit numeric(12,2),
  payment_terms_days integer NOT NULL DEFAULT 30,
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100)
);

CREATE TABLE carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid UNIQUE NOT NULL REFERENCES organizations(id),
  usdot_number text,
  mc_number text,
  authority_status text NOT NULL DEFAULT 'PENDING',
  insurance_status text NOT NULL DEFAULT 'PENDING',
  fraud_score integer NOT NULL DEFAULT 0 CHECK (fraud_score BETWEEN 0 AND 100),
  performance_score numeric(5,2) NOT NULL DEFAULT 50,
  verified_at timestamptz,
  last_verified_at timestamptz,
  UNIQUE (usdot_number),
  UNIQUE (mc_number)
);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES carriers(id),
  name text NOT NULL,
  phone text,
  email text,
  status text NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE trucks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES carriers(id),
  driver_id uuid REFERENCES drivers(id),
  unit_number text NOT NULL,
  equipment_type text NOT NULL,
  current_location geography(Point,4326),
  available_at timestamptz,
  status text NOT NULL DEFAULT 'AVAILABLE',
  location_updated_at timestamptz
);
CREATE INDEX trucks_location_gix ON trucks USING gist(current_location);

CREATE TABLE loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text UNIQUE NOT NULL,
  shipper_id uuid REFERENCES shippers(id),
  status load_status NOT NULL DEFAULT 'DRAFT',
  origin_city text NOT NULL,
  origin_state text NOT NULL,
  origin_location geography(Point,4326),
  destination_city text NOT NULL,
  destination_state text NOT NULL,
  destination_location geography(Point,4326),
  pickup_start timestamptz NOT NULL,
  pickup_end timestamptz,
  delivery_start timestamptz,
  delivery_end timestamptz,
  equipment_type text NOT NULL,
  weight_lbs integer,
  commodity text,
  cargo_value numeric(12,2),
  shipper_rate numeric(12,2),
  target_carrier_rate numeric(12,2),
  max_carrier_rate numeric(12,2),
  automation_mode text NOT NULL DEFAULT 'AUTOPILOT',
  risk_level text NOT NULL DEFAULT 'NORMAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  booked_at timestamptz,
  delivered_at timestamptz,
  closed_at timestamptz
);
CREATE INDEX loads_status_idx ON loads(status);
CREATE INDEX loads_origin_gix ON loads USING gist(origin_location);

CREATE TABLE load_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES carriers(id),
  truck_id uuid REFERENCES trucks(id),
  deadhead_miles numeric(8,2),
  proposed_rate numeric(12,2),
  reliability_score numeric(5,2),
  fraud_score numeric(5,2),
  match_score numeric(5,2),
  eligible boolean NOT NULL DEFAULT false,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX load_matches_rank_idx ON load_matches(load_id, eligible, match_score DESC);

CREATE TABLE offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  carrier_id uuid NOT NULL REFERENCES carriers(id),
  truck_id uuid REFERENCES trucks(id),
  initial_rate numeric(12,2) NOT NULL,
  current_rate numeric(12,2) NOT NULL,
  maximum_rate numeric(12,2) NOT NULL,
  status offer_status NOT NULL DEFAULT 'PENDING',
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  responded_at timestamptz
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid UNIQUE NOT NULL REFERENCES loads(id),
  carrier_id uuid NOT NULL REFERENCES carriers(id),
  driver_id uuid REFERENCES drivers(id),
  truck_id uuid REFERENCES trucks(id),
  carrier_rate numeric(12,2) NOT NULL,
  booked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE load_events (
  id bigserial PRIMARY KEY,
  load_id uuid NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_time timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'SYSTEM',
  location geography(Point,4326),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX load_events_timeline_idx ON load_events(load_id, event_time DESC);

CREATE TABLE exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id uuid REFERENCES loads(id),
  severity text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  recommended_action text,
  status exception_status NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX exceptions_open_idx ON exceptions(status, severity, created_at DESC);

CREATE TABLE automation_decisions (
  id bigserial PRIMARY KEY,
  load_id uuid REFERENCES loads(id),
  decision_type text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
