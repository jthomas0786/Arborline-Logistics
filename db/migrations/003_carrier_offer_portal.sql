ALTER TABLE carriers ADD COLUMN IF NOT EXISTS dispatch_phone text;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS dispatch_email text;

ALTER TABLE offers ADD COLUMN IF NOT EXISTS public_token uuid;
UPDATE offers SET public_token=gen_random_uuid() WHERE public_token IS NULL;
ALTER TABLE offers ALTER COLUMN public_token SET DEFAULT gen_random_uuid();
ALTER TABLE offers ALTER COLUMN public_token SET NOT NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS opened_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS offers_public_token_unique ON offers(public_token);
