CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text UNIQUE NOT NULL,
  p256dh text NOT NULL,
  auth_secret text NOT NULL,
  user_agent text,
  failure_count integer NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS web_push_subscription_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('STAFF','SHIPPER','CARRIER','DRIVER')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  shipper_id uuid REFERENCES shippers(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES carriers(id) ON DELETE CASCADE,
  load_id uuid REFERENCES loads(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(user_id,shipper_id,carrier_id,load_id,booking_id) >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS web_push_target_unique
  ON web_push_subscription_targets(
    subscription_id,audience,
    COALESCE(user_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(shipper_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(carrier_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(load_id,'00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(booking_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS web_push_target_user_idx ON web_push_subscription_targets(user_id);
CREATE INDEX IF NOT EXISTS web_push_target_shipper_idx ON web_push_subscription_targets(shipper_id);
CREATE INDEX IF NOT EXISTS web_push_target_carrier_idx ON web_push_subscription_targets(carrier_id);
CREATE INDEX IF NOT EXISTS web_push_target_load_idx ON web_push_subscription_targets(load_id);
CREATE INDEX IF NOT EXISTS web_push_target_booking_idx ON web_push_subscription_targets(booking_id);
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscription_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_push_subscriptions FROM anon, authenticated;
REVOKE ALL ON web_push_subscription_targets FROM anon, authenticated;

-- Twilio/SMS is no longer part of Arborline's delivery architecture.
-- Any unsent historical SMS is cancelled so it cannot become deliverable later.
UPDATE outbox_messages
SET status='CANCELLED',last_error='SMS_DISABLED_USE_EMAIL_OR_WEB_PUSH'
WHERE channel='SMS' AND status IN ('PENDING','WAITING_PROVIDER','WAITING_CONTACT','PROCESSING');
