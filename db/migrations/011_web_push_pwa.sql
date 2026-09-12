CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text UNIQUE NOT NULL,
  p256dh text NOT NULL,
  auth_secret text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('STAFF','SHIPPER','CARRIER','DRIVER')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  shipper_id uuid REFERENCES shippers(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES carriers(id) ON DELETE CASCADE,
  load_id uuid REFERENCES loads(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  user_agent text,
  failure_count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(user_id,shipper_id,carrier_id,load_id,booking_id) >= 1)
);
CREATE INDEX IF NOT EXISTS web_push_user_idx ON web_push_subscriptions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS web_push_shipper_idx ON web_push_subscriptions(shipper_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS web_push_carrier_idx ON web_push_subscriptions(carrier_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS web_push_load_idx ON web_push_subscriptions(load_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS web_push_booking_idx ON web_push_subscriptions(booking_id) WHERE revoked_at IS NULL;
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_push_subscriptions FROM anon, authenticated;

-- Twilio/SMS is no longer part of Arborline's delivery architecture.
-- Any unsent historical SMS is cancelled so it cannot become deliverable later.
UPDATE outbox_messages
SET status='CANCELLED',last_error='SMS_DISABLED_USE_EMAIL_OR_WEB_PUSH'
WHERE channel='SMS' AND status IN ('PENDING','WAITING_PROVIDER','WAITING_CONTACT','PROCESSING');
