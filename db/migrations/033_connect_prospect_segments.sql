create table if not exists connect_prospect_segments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references connect_clients(id) on delete cascade,
  slug text not null,
  name text not null,
  service_vertical text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','ACTIVE','PAUSED','ARCHIVED')),
  target_industries text[] not null default '{}',
  target_geographies text[] not null default '{}',
  min_employees integer,
  max_employees integer,
  min_locations integer,
  max_locations integer,
  facility_types text[] not null default '{}',
  decision_maker_titles text[] not null default '{}',
  buying_signals text[] not null default '{}',
  exclusions text[] not null default '{}',
  qualification_notes text,
  minimum_score integer not null default 70 check (minimum_score between 0 and 100),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug)
);

alter table connect_prospect_segments enable row level security;

alter table connect_prospects
  add column if not exists segment_id uuid references connect_prospect_segments(id) on delete set null;

alter table connect_sourcing_runs
  add column if not exists segment_id uuid references connect_prospect_segments(id) on delete set null;

create index if not exists connect_prospect_segments_client_status_idx
  on connect_prospect_segments(client_id,status,created_at desc);

create index if not exists connect_prospects_segment_idx
  on connect_prospects(segment_id,qualification_status,outreach_status,created_at desc);

create index if not exists connect_sourcing_runs_segment_idx
  on connect_sourcing_runs(segment_id,created_at desc);
