-- ============================================================
--  Filey ERP — remap legacy emirate codes to PINT-AE 3-letter
--  Rows saved before the 2026-06-24 code-list switch hold ISO 3166-2
--  "AE-xx" values; PINT-AE / Schematron (ibr-143/144-ae) require the
--  3-letter codes AUH/DXB/SHJ/AJM/UAQ/RAK/FUJ. This rewrites existing rows.
--  Run in:  Supabase Dashboard → SQL Editor → New query
--  Idempotent — only touches rows still in the old format (WHERE LIKE 'AE-%').
--  NOTE: local/offline (SQLite) is handled in app code by normalizeEmirate().
-- ============================================================

-- Shared mapping, applied per table+column below.
--   AE-AZ→AUH  AE-DU→DXB  AE-SH→SHJ  AE-AJ→AJM  AE-UQ→UAQ  AE-RK→RAK  AE-FU→FUJ

update company_profile set country_subdivision = case upper(country_subdivision)
  when 'AE-AZ' then 'AUH' when 'AE-DU' then 'DXB' when 'AE-SH' then 'SHJ'
  when 'AE-AJ' then 'AJM' when 'AE-UQ' then 'UAQ' when 'AE-RK' then 'RAK'
  when 'AE-FU' then 'FUJ' else country_subdivision end
where country_subdivision like 'AE-%';

update crm_customers set country_subdivision = case upper(country_subdivision)
  when 'AE-AZ' then 'AUH' when 'AE-DU' then 'DXB' when 'AE-SH' then 'SHJ'
  when 'AE-AJ' then 'AJM' when 'AE-UQ' then 'UAQ' when 'AE-RK' then 'RAK'
  when 'AE-FU' then 'FUJ' else country_subdivision end
where country_subdivision like 'AE-%';

update invoice_docs set seller_country_subdivision = case upper(seller_country_subdivision)
  when 'AE-AZ' then 'AUH' when 'AE-DU' then 'DXB' when 'AE-SH' then 'SHJ'
  when 'AE-AJ' then 'AJM' when 'AE-UQ' then 'UAQ' when 'AE-RK' then 'RAK'
  when 'AE-FU' then 'FUJ' else seller_country_subdivision end
where seller_country_subdivision like 'AE-%';

update invoice_docs set buyer_country_subdivision = case upper(buyer_country_subdivision)
  when 'AE-AZ' then 'AUH' when 'AE-DU' then 'DXB' when 'AE-SH' then 'SHJ'
  when 'AE-AJ' then 'AJM' when 'AE-UQ' then 'UAQ' when 'AE-RK' then 'RAK'
  when 'AE-FU' then 'FUJ' else buyer_country_subdivision end
where buyer_country_subdivision like 'AE-%';
