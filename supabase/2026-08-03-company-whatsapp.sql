-- The business's own WhatsApp number.
--
-- `phone` is the landline/main line printed on documents; the number customers
-- actually message is often different. Kept separate so a share link or a
-- document footer can point at the right one rather than guessing.
--
-- Safe to re-run.

alter table company_profile add column if not exists whatsapp text;

comment on column company_profile.whatsapp is
  'Business WhatsApp number in E.164 (e.g. +9715XXXXXXXX). Shown on documents and used for customer contact links.';
