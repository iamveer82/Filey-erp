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

The initial management request failed, but this migration was subsequently applied on September 10 and its columns rechecked on September 12. See [the deployment log](SUPABASE_DEPLOY.md#applied-migration-log). Country settings and records belong to the selected local or cloud workspace; changing storage mode does not automatically merge them.

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

## Capability matrix (September 2026)

The same matrix is available in Filey under Documentation → Business country,
currency and taxes, linked beside country settings. Countries describe document
support, not certification or complete ERP parity.

| Region | Documents and currency | Tax handling | Ledger and payroll | Filing limits |
| --- | --- | --- | --- | --- |
| UAE | Invoices, quotes, POs, receipts; AED or supported foreign currency | Editable VAT/TRN; PINT-AE export | AED ledger; WPS export fields | No verified gateway submission or filing |
| India | Country snapshots; INR and other supported document currencies | GSTIN format, editable tax | AED ledger; no localized statutory payroll | No split GST, place-of-supply engine, IRN, e-way bill or returns |
| EU member countries | Individual country selection; EUR and other document currencies | VAT identifier labels, editable line tax | AED ledger; no national payroll | No VIES, OSS/IOSS or national e-invoice/filing gateways |
| Saudi Arabia | SAR and other supported document currencies | Editable tax and identifiers | AED ledger; no localized statutory payroll | No verified gateway submission or filing |
| Other countries | General documents and supported currencies | Manual tax and identifiers | AED ledger; generic people/pay records | Country validation and filings require separate implementation |

Arabic text fields in document templates use automatic text direction; the form
and table layout remain in the selected application language. The browser fixture
renders an Arabic customer, address, item and note through InvoiceExportSheet and
the real PDF exporter. This is representative layout coverage, not a review of
all 52 templates or every installed system font. English fallback remains on
untranslated screens.

Next depth work should follow confirmed customer needs: one jurisdiction's
reviewed accounting/payroll/filing workflow, then real team assignments, duplicate
merging, warehouse transfers and CRM automation. Those are product work beyond
this defect-remediation release; they are not presented as shipped features.
