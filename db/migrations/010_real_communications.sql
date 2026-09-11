ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS provider_status text;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS failed_at timestamptz;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS last_callback_at timestamptz;
ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS outbox_provider_message_unique
  ON outbox_messages(provider,provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS communication_delivery_events (
  id bigserial PRIMARY KEY,
  outbox_id bigint NOT NULL REFERENCES outbox_messages(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_event_id text,
  event_type text NOT NULL,
  provider_status text,
  provider_message_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communication_delivery_events_outbox_idx
  ON communication_delivery_events(outbox_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS communication_delivery_event_provider_unique
  ON communication_delivery_events(provider,provider_event_id)
  WHERE provider_event_id IS NOT NULL;
ALTER TABLE communication_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON communication_delivery_events FROM anon, authenticated;

-- Historical demo messages must never become real sends when providers are enabled later.
UPDATE outbox_messages m
SET status='SUPPRESSED',
    provider_status='suppressed',
    last_error='TEST_ONLY_RECIPIENT'
WHERE m.status IN ('PENDING','WAITING_PROVIDER')
  AND (
    lower(m.recipient) LIKE '%.invalid'
    OR EXISTS (SELECT 1 FROM carriers c WHERE c.id=m.carrier_id AND c.is_test_carrier=true)
  );
