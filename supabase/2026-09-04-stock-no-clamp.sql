-- Stop adjust_product_stock clamping at zero.
--
-- Every stock move in the app has a reverse — reverting an invoice to draft,
-- deleting a bill, un-posting a purchase. greatest(0, …) made that pair
-- asymmetric: selling 5 from a stock of 3 clamped to 0, and reversing it added
-- 5 back, leaving 5 on hand where 3 had been. Overselling silently invented
-- inventory, and the products row stopped agreeing with the stock_movements
-- ledger, which had recorded the honest -5 and +5.
--
-- Negative stock is information, not corruption: it says units are owed. The
-- JS fallback in src/lib/api.ts (used whenever this RPC is unavailable, which
-- is always in offline mode) drops the same clamp.
--
-- Safe to re-run. Existing rows are not rewritten — quantities already flattened
-- to zero by the old function stay as they are; this only changes future moves.

create or replace function public.adjust_product_stock(p_id bigint, p_delta numeric)
returns bigint language sql as $$
  update public.products
     set quantity = quantity + p_delta
   where id = p_id
  returning quantity;
$$;

grant execute on function public.adjust_product_stock(bigint, numeric) to authenticated;
