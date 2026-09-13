insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'connect-walkthrough',
  'connect-walkthrough',
  true,
  52428800,
  array['video/mp4']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Upload authorization is handled by the authenticated
-- connect-walkthrough-upload-url Edge Function, which issues a short-lived
-- signed upload token only to active STAFF users. Public bucket reads remain
-- available for the customer-facing /walkthrough page.
