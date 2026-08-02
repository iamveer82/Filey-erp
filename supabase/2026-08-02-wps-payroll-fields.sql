-- WPS (Wage Protection System) fields for UAE payroll SIF export.
--
-- The salary file MOHRE requires carries identifiers that live nowhere else in
-- the schema: each employee's labour card number and salary IBAN, and the
-- employer's MOHRE establishment ID plus the bank routing code that identifies
-- who is paying. Nullable throughout — a business that does not file WPS should
-- never see a validation error about it.
--
-- Safe to re-run.

alter table employees add column if not exists labour_card_no text;
alter table employees add column if not exists iban text;
alter table employees add column if not exists bank_routing_code text;

alter table company_profile add column if not exists mol_establishment_id text;
alter table company_profile add column if not exists wps_bank_code text;

comment on column employees.labour_card_no is
  'MOHRE labour card / personal number, 14 digits. Employee identity in a WPS SIF.';
comment on column employees.iban is
  'Salary account IBAN (UAE: AE + 21 digits). Where WPS pays this employee.';
comment on column employees.bank_routing_code is
  'Employee bank/exchange routing code, 9 digits, from the receiving bank.';
comment on column company_profile.mol_establishment_id is
  'MOHRE establishment ID, 13 digits. The employer identity in a WPS SIF.';
comment on column company_profile.wps_bank_code is
  'Employer bank/exchange routing code, 9 digits, issued by the paying bank.';
