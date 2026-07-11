-- ============================================================
--  Filey ERP — function EXECUTE hardening (security advisor pass)
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Safe to re-run (idempotent).  APPLIED to live DB 2026-07-11.
--
--  Postgres grants EXECUTE on new functions to PUBLIC by default, so
--  every SECURITY DEFINER helper was callable via /rest/v1/rpc/ by the
--  anon role. None were exploitable (each checks auth.uid() or is a
--  trigger), but anon has no business calling any of them.
--
--  Kept anon-callable BY DESIGN: get_shared_doc / get_shared_invoice
--  (public share links — token-gated, strip user/org ids).
--  Kept authenticated on RLS helpers (current_org, current_org_id,
--  is_org_admin, my_email): RLS policies evaluate them as the caller.
-- ============================================================

-- Trigger / event-trigger functions: never callable via RPC (Postgres
-- rejects direct calls) and trigger firing does not check EXECUTE.
revoke execute on function public.force_org_id() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_audit() from public, anon, authenticated;
revoke execute on function public.notify_mentions() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Maintenance job: service-role only (SECURITY DEFINER delete across orgs).
revoke execute on function public.prune_tool_runs(interval) from public, anon, authenticated;
grant execute on function public.prune_tool_runs(interval) to service_role;

-- Signed-in-only RPCs: strip anon + PUBLIC, keep authenticated.
revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.adjust_account_balance(bigint, numeric) from public, anon;
revoke execute on function public.adjust_product_stock(bigint, numeric) from public, anon;
revoke execute on function public.register_device(text, text) from public, anon;
revoke execute on function public.sync_bump_sequences() from public, anon;
revoke execute on function public.current_org() from public, anon;
revoke execute on function public.current_org_id() from public, anon;
revoke execute on function public.is_org_admin() from public, anon;
revoke execute on function public.my_email() from public, anon;

-- Pin search_path (advisor: function_search_path_mutable). SECURITY DEFINER
-- + mutable search_path = hijackable if an attacker can create objects in
-- an earlier schema; pinning closes it.
alter function public.set_updated_at() set search_path = public;
alter function public.adjust_product_stock(bigint, numeric) set search_path = public;
alter function public.adjust_account_balance(bigint, numeric) set search_path = public;
alter function public.current_org_id() set search_path = public;
