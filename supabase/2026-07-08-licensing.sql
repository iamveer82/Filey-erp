-- ============================================================
--  Filey ERP — licensing: one-time desktop licenses + device slots
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).
--  Writes happen ONLY via the stripe edge function (service role);
--  clients get read-only visibility of their own rows through RLS.
-- ============================================================

create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null default 'filey-desktop',
  status text not null default 'active',            -- active | revoked
  stripe_payment_intent text,
  created_at timestamptz not null default now()
);

create table if not exists license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id) on delete cascade,
  fingerprint text not null,
  device_name text,
  activated_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create unique index if not exists idx_license_devices_unique
  on license_devices(license_id, fingerprint);
create index if not exists idx_licenses_user on licenses(user_id);

alter table licenses enable row level security;
drop policy if exists licenses_read on licenses;
create policy licenses_read on licenses for select
  using (user_id = auth.uid());

alter table license_devices enable row level security;
drop policy if exists license_devices_read on license_devices;
create policy license_devices_read on license_devices for select
  using (exists (
    select 1 from licenses l
    where l.id = license_id and l.user_id = auth.uid()
  ));
