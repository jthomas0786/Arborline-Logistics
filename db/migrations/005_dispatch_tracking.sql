ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tracking_token uuid;
UPDATE bookings SET tracking_token=gen_random_uuid() WHERE tracking_token IS NULL;
ALTER TABLE bookings ALTER COLUMN tracking_token SET DEFAULT gen_random_uuid();
ALTER TABLE bookings ALTER COLUMN tracking_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_tracking_token_unique ON bookings(tracking_token);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tracking_started_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS last_location geography(Point,4326);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS last_location_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta_at timestamptz;
CREATE INDEX IF NOT EXISTS bookings_last_location_gix ON bookings USING gist(last_location);
