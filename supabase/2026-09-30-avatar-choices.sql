-- Apply after 2026-09-28-member-avatars.sql, before shipping the new picker.
-- Expand preset choices only; existing values and RPC permissions are unchanged.
begin;
alter table public.org_members drop constraint if exists org_members_avatar_preset;
alter table public.org_members add constraint org_members_avatar_preset check (
  avatar is null or avatar in (
    '/avatars/sun.svg','/avatars/mint.svg','/avatars/coral.svg','/avatars/sky.svg',
    '/avatars/lilac.svg','/avatars/peach.svg','/avatars/slate.svg','/avatars/sage.svg',
    '/avatars/sunburst.svg','/avatars/triangle.svg'
  ) or avatar ~ '^/avatars/blobatar/(round|organic|boxy|capsule|nub|cloud|droplet|hexagon|sunburst|triangle)-(sun|mint|coral|sky|lilac|peach|slate|sage|amber|rose)[.]svg$'
);
comment on constraint org_members_avatar_preset on public.org_members is
  'Only ten legacy Filey presets or an exact supported Blobatar shape-colour SVG; no arbitrary URLs.';
notify pgrst, 'reload schema';
commit;
