# Local/cloud connection audit — 23 September 2026

## Fixes in this checkout

- Returning to local storage preserves the user's automatic-sync preference. A new install still does not enable automatic uploads without opting in.
- Storage switching rechecks the originating account and mode after asynchronous destination checks. A sign-out or account change cannot silently sign the old identity back into the device workspace.
- Queued cloud writes stop when storage or account identity changes. A new save waiting behind that queue cannot run against the newly selected store.
- Automatic and explicit local uploads recheck the account between batches, during legacy single-record fallback, and before acknowledging local revisions. An account change leaves unacknowledged records pending.

Switching storage still reloads the app without ending authentication. It does not implicitly merge records. Local-only changes remain on the device until sync is enabled or explicitly requested; conflicts require review.

## Live backend checks

Used the existing GitHub sign-in to restore the Supabase dashboard session. The CLI credential was rejected; the read-only catalog query was run through the dashboard SQL editor instead. No customer rows or backend settings were changed.

`scripts/check-cloud-schema.mjs` compared the exported production catalog with this checkout:

- 84 tables, 1,115 columns, 56 database functions; **zero reported schema issues**.
- Static frontend/edge RPC references and migration-declared columns/tables exist.
- All 45 sync collections have RLS, sync revision columns/triggers and Realtime publication coverage.
- The checker found no unpinned SECURITY DEFINER functions or unexpected anonymous execution on the protected RPCs it checks.
- All 12 function names in `supabase/functions` are deployed. Presence was verified, not byte-for-byte equivalence of every deployed handler.

The organization remains within its current free-tier quotas: 1.739/5 GB egress, 0.165/0.5 GB database size, 0.045/1 GB storage and 300/500,000 function invocations. The dashboard's grace-period warning describes enforcement if a quota is exceeded; it does not show a current overage. Usage figures can lag.

## Verification

- Full Vitest run: **266 files, 1,715 tests passed**.
- Backend Deno suite: **87 tests passed**.
- Disposable PostgreSQL checks passed: record permissions, sync revisions/batches/manifests, team isolation, invoice limits, billing/refunds, wallet reservations and video accounting. No Docker or production data used.
- Production TypeScript/Vite build passed. Existing bundle-size and mixed static/dynamic-import warnings remain.
- Existing fixture tests cover session restoration across local/cloud/local, failed copies preserving local collections, queued writes, conflicting revisions, file-byte upload/download ordering, and account-scoped caches.
- Runtime import scan: 352/354 modules reachable from the app entry. The two candidates are test setup and the spreadsheet vendor module; no files were deleted based on this scan alone.

Evidence is in ignored `output/workspace-audit-*.log` and `output/cloud-audit/runtime-schema-current.json`.

## Release boundary

These client fixes have not been committed, published to the website or packaged into the desktop updater in this audit. The live check read schema metadata and deployment presence; it did not edit a real customer invoice, run a production sync, send messages or make payments. A real two-device customer-data transfer was deliberately not used as a test.
