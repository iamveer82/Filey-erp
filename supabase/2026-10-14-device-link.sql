-- 2026-10-14: Filey Link — the devices signed in to one account find each other
-- and a paired phone or browser runs Filey AI on that account's open desktop app
-- (src/lib/deviceLink.ts, src/lib/linkedAgent.ts). Private Realtime topic per
-- account: `filey-link:<user id>`, broadcast + presence. Nothing is stored.
-- Idempotent: safe to re-run. Realtime-only: not part of the fresh installer,
-- which targets plain PostgreSQL without the realtime schema.
--
-- Only the signed-in account may join, track presence on or broadcast to its own
-- topic. Driving a computer additionally needs a device key the desktop approved
-- (checked in the app); this policy only keeps other accounts out.
begin;

drop policy if exists "filey link: own topic read" on realtime.messages;
create policy "filey link: own topic read" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'filey-link:' || (select auth.uid())::text
    and realtime.messages.extension in ('broadcast', 'presence')
  );

drop policy if exists "filey link: own topic write" on realtime.messages;
create policy "filey link: own topic write" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() = 'filey-link:' || (select auth.uid())::text
    and realtime.messages.extension in ('broadcast', 'presence')
  );

commit;
