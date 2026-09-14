CREATE TABLE IF NOT EXISTS connect_follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES connect_clients(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES connect_prospects(id) ON DELETE CASCADE,
  reply_id uuid REFERENCES connect_replies(id) ON DELETE SET NULL,
  due_at timestamptz NOT NULL,
  reason text NOT NULL DEFAULT 'NOT_NOW',
  notes text,
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS connect_follow_up_tasks_open_reply_uq
  ON connect_follow_up_tasks(reply_id)
  WHERE reply_id IS NOT NULL AND status='SCHEDULED';

CREATE INDEX IF NOT EXISTS connect_follow_up_tasks_due_idx
  ON connect_follow_up_tasks(status,due_at);

ALTER TABLE connect_follow_up_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE connect_follow_up_tasks FROM anon, authenticated;
