# International business support

Updated 6 September 2026. This is a country-aware document foundation, not certified country accounting, payroll or filing support.

## Working behavior

Settings → Company Details and each document's Company dialog now share Business country and Default tax rate controls. Choose the business registration country explicitly. The country selector includes India, UAE, all 27 individual EU member states, Saudi Arabia and additional countries using manually configured tax rates. A currency never identifies an EU jurisdiction.

Selecting a country changes the tax label and identifier label; it does not silently replace the existing tax percentage. Use the suggested-rate button only after reviewing the transaction. Enter 0 for a zero default. No tax collection also sets new-document defaults to 0; explicit line rates remain a document choice. The company currency and the device's display currency remain independent of this setting. Currency pickers now include the non-euro EU currencies and several other international currencies.

Invoices, quotations, purchase orders and payment receipts retain a tax-country snapshot. New records created through Filey AI use the same APIs. Changing company country later does not rewrite saved documents. Invoice, quote and PO editors expose Tax country for explicit adjustments. Legacy records without a snapshot retain their historical currency-derived labels until explicitly reviewed. Select a business country to remove that legacy behavior for new documents.

General document templates and receipt vouchers use the snapshot for VAT/GST/Tax and tax ID labels. UAE-specific layouts contain UAE legal text and saves reject them for explicit non-UAE countries. Changing Tax country switches an incompatible UAE layout to Minimal; the preview also falls back to Minimal for imported mismatches. Use a general layout for other countries. PINT-AE XML explicitly rejects non-UAE country snapshots, including direct serializer calls.

Indian GSTINs are no longer rejected by a blanket UAE 15-digit rule. The new customer's country controls quick-add tax-ID format checks. These are format checks, not registration verification. Company settings show State / Province outside UAE and hide UAE WPS fields.

Quote lists now use the same formula, discounts, tax and rounding as the editor. Conversion retains the quote's jurisdiction, document rate, line rates, discount and rounding instead of applying today's company tax default. The shared totals calculation allocates document discounts across explicit line tax rates as well as document-rated lines. Purchase-order totals now include their header discount and tax; API saves recompute the amount from items instead of trusting a stale caller total. Purchase postings recalculate net and tax from saved lines and convert them to AED, preventing VAT from being added twice. New foreign-currency POs freeze an available FX rate; the editor retains it until currency changes. Existing posted transactions require reconciliation before any reposting or release.

## Sources and preset scope

Presets were checked on 6 September 2026. They are editable suggestions; they do not automatically classify products, special territories, reverse charge, exports or exemptions.

- [UAE Federal Tax Authority](https://tax.gov.ae/en/faq.aspx?keyword=What+is+the+standard+rate+of+VAT+in+the+UAE%3F): standard VAT preset 5%.
- [European Commission country rate table](https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm): separate standard-rate suggestions for each of the 27 member states. Reduced and special rates require explicit entry and review; there is no universal EU VAT rate.
- [GST Council September 2025 decisions](https://www.gstcouncil.gov.in/sites/default/files/2025-09/press_release_press_information_bureau_0.pdf) and [December 2025 newsletter](https://gstcouncil.gov.in/sites/default/files/2026-01/monthly_newsletter_december_2025_1_0.pdf): current broad rate suggestions include 5%, 18% and 40%, with special product rules. Old 12%/28% values remain editable for historical records; saved values are never migrated to new rates.
- [GSTN format guidance](https://selfservice.gstsystem.in/FAQDetails.aspx?ID=430): 15-character alphanumeric GSTIN; the app does not verify its checksum or live registration status.
- [ZATCA VAT guidance](https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Amendments-to-the-Implementing-Regulation-of-%28VAT%29.PDF): Saudi standard preset 15%.

## Deployment and data separation

Apply `supabase/2026-09-06-international-business.sql` before enabling country persistence in cloud or transferring country-tagged local documents. The migration adds nullable columns only and leaves organization/owner RLS intact. It does not relabel or backfill historical invoices. Native local rows are schemaless and retain the fields through the existing database backup and explicit transfer paths.

The previous authorized Supabase management request returned HTTP 403 / Cloudflare 1010. This migration has not been applied remotely. Do not publish the update as cloud-ready. Country settings and records belong to the selected local or cloud workspace; changing storage mode does not automatically merge them.

## Remaining release work

- The accounting ledger and FX anchor are still AED. A company/display currency selection does not convert the underlying ledger to a new functional currency. Statutory accounts in INR/EUR or another functional currency require a ledger migration, opening-balance reconciliation and accountant validation.
- India: place-of-supply rules, CGST/SGST/UTGST split, HSN/SAC classification, cess, e-invoice IRN/QR, e-way bills and GST returns are not implemented by this change.
- EU: destination VAT, OSS/IOSS, VIES verification, national e-invoicing formats and gateways, reverse-charge evidence and country returns need separate implementations.
- UAE/Saudi: no certification or successful government-gateway submission is implied by XML generation. Production gateway integration and legal validation remain required.
- Multi-entity consolidation, localized payroll/leave, statutory fiscal calendars and full translations require further work. Existing application languages are independent of the company country.
- New currency documents need valid FX data for consolidated accounting; additional currencies do not create reliable offline exchange rates.

Broader competitor readiness is tracked in [platform-readiness.md](platform-readiness.md).

## Validation

143 test files / 983 tests passed. After the final legacy-PO read correction, the 10 focused country and purchase-accounting tests passed again. TypeScript and the final production build passed. Lint across the changed files reported 0 errors and 125 warnings. Browser review confirmed the shared country selector, India's GSTIN/state fields and removal of UAE-only WPS fields without saving changes to the real company. Cloud writes, national gateway submission and a packaged desktop release were not validated.
