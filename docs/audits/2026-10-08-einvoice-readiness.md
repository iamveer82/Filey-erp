# UAE invoice readiness and workflow audit — 8 October 2026

## Fixed

- New manual, scanned and agent invoice drafts read a fresh company snapshot, including saved location, legal registration and electronic identity. Existing drafts have an explicit fill-missing action; manual values and issued document snapshots are preserved.
- Quotation conversion carries matched seller and customer-ID presets, rejects conflicting tax entities, and stops when the workspace changes, including an A → B → A switch.
- Company, customer and supplier forms retain nested identity details, preserve E.164-only phone numbers and persist deliberately cleared optional fields.
- Delayed New, Edit, Duplicate and Credit Note responses cannot replace newer edits or reopen a closed invoice editor.
- XML export rejects malformed imported values and forbidden XML characters, includes party contacts and places GTIN/service classification elements in the required UBL order.
- Hosted agent replies after a failed tool action use verified receipts instead of unsupported completion claims. Uncertain writes remain protected from automatic repetition.
- Schema verification checks identity JSON columns and the exact UUID preservation function/trigger, including its namespace and execution conditions.

## UUID and submission boundary

The [MoF June 2026 guidelines, section 5.2](https://mof.gov.ae/wp-content/uploads/2026/06/UAE-Electronic-Invoicing-Guidelines_V-1.1-01June2026.pdf) assign UUID generation to the Accredited Service Provider (ASP). Filey's existing identifier is labelled **Preparation UUID**. It must not be represented as an FTA-issued or ASP-confirmed identifier. An ASP integration must retain the final submission identity and acknowledgement separately without rewriting the original preparation identity.

The [PINT-AE UUID semantic rule](https://docs.peppol.eu/poac/ae/pint-ae/trn-invoice/semantic-model/btae-07/) requires a globally unique invoice identifier. Filey's UUID shape check is an integrity constraint, not a claim that the official Schematron imposes that regular expression.

Preparation, validation, preview and XML generation are distinct from accredited submission. No ASP sandbox or production delivery was exercised in this audit.

## Verification

- Production TypeScript/Vite build passed.
- Targeted preset, conversion, customer/supplier, local upgrade, XML and invoice-editor regressions passed; the final document-action suite passed 58 tests.
- 136 invoice display/template checks passed, including all built-in formats.
- 23 synthetic XML documents passed UBL 2.1 XSD and both official PINT-AE 1.0.4 Schematron stages. Vendored validation stylesheets matched the official resources.
- 45 hosted-agent/tool tests passed with Deno typechecking.
- 35 schema verifier tests passed. Fresh PostgreSQL bootstrap, atomicity, legacy-installation protection and resulting catalog checks passed.
- Read-only live Supabase catalog verification passed: 93 tables, 1,208 columns and 129 inspected functions, with no required-schema issues. Current fixes use existing columns; no production DDL was needed.
- Browser checks verified seller preset filling, preservation of a manual address, and no horizontal overflow at a 393-pixel mobile viewport in dark mode.
- The first full unit run overlapped source edits and reported five stale-module failures; all three affected files passed after the tree was frozen. Clean pull-request CI remains the final full-suite gate.

No real invoices, payments, customer messages or local database files were modified during testing. This is a scoped audit, not a certification that every possible defect or security issue has been eliminated.
