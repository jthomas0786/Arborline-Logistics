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

alter table storage.objects enable row level security;

drop policy if exists "Public can view Connect walkthrough" on storage.objects;
create policy "Public can view Connect walkthrough"
on storage.objects
for select
to public
using (bucket_id = 'connect-walkthrough');

drop policy if exists "Staff can upload Connect walkthrough" on storage.objects;
create policy "Staff can upload Connect walkthrough"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'connect-walkthrough'
  and exists (
    select 1
    from public.app_users au
    where au.user_id = auth.uid()
      and au.is_active = true
      and au.role = 'STAFF'
  )
);

drop policy if exists "Staff can update Connect walkthrough" on storage.objects;
create policy "Staff can update Connect walkthrough"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'connect-walkthrough'
  and exists (
    select 1
    from public.app_users au
    where au.user_id = auth.uid()
      and au.is_active = true
      and au.role = 'STAFF'
  )
)
with check (
  bucket_id = 'connect-walkthrough'
  and exists (
    select 1
    from public.app_users au
    where au.user_id = auth.uid()
      and au.is_active = true
      and au.role = 'STAFF'
  )
);

drop policy if exists "Staff can delete Connect walkthrough" on storage.objects;
create policy "Staff can delete Connect walkthrough"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'connect-walkthrough'
  and exists (
    select 1
    from public.app_users au
    where au.user_id = auth.uid()
      and au.is_active = true
      and au.role = 'STAFF'
  )
);
