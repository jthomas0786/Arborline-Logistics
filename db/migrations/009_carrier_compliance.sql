ALTER TABLE carriers ADD COLUMN IF NOT EXISTS verification_source text;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS fmcsa_allow_to_operate boolean;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS fmcsa_out_of_service boolean;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS fmcsa_out_of_service_date date;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS fmcsa_snapshot_at timestamptz;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS insurance_verified_at timestamptz;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS insurance_expires_at timestamptz;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS compliance_hold_reason text;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS is_test_carrier boolean NOT NULL DEFAULT false;

ALTER TABLE exceptions ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES carriers(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS exceptions_carrier_open_idx ON exceptions(carrier_id,status,created_at DESC) WHERE carrier_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS carrier_compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  verification_check_id uuid REFERENCES carrier_verification_checks(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'VERIFICATION_QUEUED','FMCSA_PASSED','FMCSA_FAILED','INSURANCE_PASSED','INSURANCE_FAILED',
    'CARRIER_VERIFIED','CARRIER_HELD','REVERIFICATION_DUE','TEST_OVERRIDE_RECORDED'
  )),
  source text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_compliance_events_carrier_idx ON carrier_compliance_events(carrier_id,created_at DESC);
ALTER TABLE carrier_compliance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON carrier_compliance_events FROM anon, authenticated;

UPDATE carriers c
SET is_test_carrier=true, verification_source='TEST_OVERRIDE'
WHERE EXISTS (
  SELECT 1 FROM carrier_verification_checks v
  WHERE v.carrier_id=c.id AND v.provider='TEST_OVERRIDE' AND v.status='PASSED'
);

INSERT INTO carrier_compliance_events (carrier_id,verification_check_id,event_type,source,details)
SELECT c.id,v.id,'TEST_OVERRIDE_RECORDED','TEST_OVERRIDE',jsonb_build_object('testOnly',true)
FROM carriers c
JOIN LATERAL (
  SELECT id FROM carrier_verification_checks
  WHERE carrier_id=c.id AND provider='TEST_OVERRIDE' AND status='PASSED'
  ORDER BY created_at DESC LIMIT 1
) v ON true
WHERE c.is_test_carrier=true
  AND NOT EXISTS (
    SELECT 1 FROM carrier_compliance_events e
    WHERE e.carrier_id=c.id AND e.event_type='TEST_OVERRIDE_RECORDED'
  );
