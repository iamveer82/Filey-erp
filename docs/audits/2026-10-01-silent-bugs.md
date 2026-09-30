# Silent bug audit — 1 October 2026

This audit fixes reproduced failures in the existing financial, storage, sync,
account, sharing and agent workflows. It adds no dependencies or release tags.
The desktop update remains on hold at the user's request.

## Confirmed defects and fixes

- Account/workspace changes could reuse an old AI context or continue a transfer
  after sign-out. Context caches are scoped and asynchronous transfers recheck
  the active account before proceeding.
- Concurrent journal updates could lose pending sync changes. Collection writes
  and journal marks now share the existing serialization queue. Local emirate
  repair uses the transaction path and journals its changes instead of silently
  bypassing sync or skipping damaged data.
- Deleting bytes before deleting metadata could leave a broken file record.
  Deletion now requires the returned deleted record ID before byte cleanup.
  New synced object paths include the file ID; shared legacy objects are retained
  because client RLS cannot prove they are unused. Native deletion errors are
  propagated and legacy byte copies cannot resurrect a removed file.
- Payment, receipt and advance read errors could become empty arrays and overstate
  a party's debt. Required reads fail visibly with retry, incomplete exports are
  blocked, and delayed responses cannot replace a different party's data.
- Customer/supplier statements mixed currencies, estimated tax from a flat rate,
  and the Sales Journal button exported the ordinary ledger. Statements now keep
  one document currency, reuse exact saved-line tax/net totals, retain signed
  credit notes and export the selected view. Legacy entries without an exact tax
  breakdown retain their gross ledger but do not assert a fabricated VAT total.
- The sales journal omitted invoice payments and could silently skip failed
  document reads. Both are now required. Its item, discount, tax and rounding
  arithmetic reuses the invoice helpers.
- Advance cards showed zero while loading, accepted non-finite amounts and could
  be overwritten by stale reads or mutations. Loading/error/retry and route
  generation checks preserve the current party. The duplicate, inaccurate net
  formula was removed; the verified statement owns the account balance.
- Clipboard shares reported success before writing, including after denial.
  All callers now await the shared promise and surface failure before claiming
  success.
- Browser-generated agent output URLs expired after four seconds; failed or
  partial transformations also replaced working input files. Live output URLs
  are retained in scoped memory while their chat references remain, and working
  files advance only after a successful transformation.
- Messaging providers could report a successful HTTP response without a usable
  message/file receipt. Email, Telegram and Slack delivery now require confirmed
  provider IDs. Scheduled report failures do not invent zero balances; paginated
  queries avoid silently truncated totals. Overdue reminders exclude purchase
  bills, credit notes and canceled/draft documents and reuse provider idempotency.
- Concurrent license claims could oversubscribe or reject valid device slots.
  A service-only transaction locks and claims the existing legacy license slots.
  Failed reads/writes no longer produce a license or false deactivation success.
  The separate twenty-device account login limit is unchanged.
- Scheduled low-stock jobs could leave empty purchase orders or create duplicates.
  The workspace-authorized transaction commits header, lines and audit together,
  rolls back failures and serializes the existing daily deduplication check.
- Administrators could demote/remove the actual workspace owner or manufacture
  another owner membership. A database trigger guards owner membership and member
  identity; existing owner-column ACLs continue to deny direct reassignment.
- Stripe subscription snapshots could arrive late and overwrite current access.
  The verified webhook now retrieves current provider state and applies it with
  a service-only, ordered transaction bound to the customer/workspace. Older or
  replaced subscriptions cannot revoke newer access or separate Dodo/Ultra
  entitlements. A second checkout for existing paid access is rejected.
- The unused public Stripe invoice-checkout action directed seller invoices to
  Filey's billing account without a configured seller destination. It now returns
  HTTP 410 with contact-seller guidance. Authenticated plan/license checkout and
  verified historical invoice settlement remain supported.

## Verification and deployment

The full frontend run passed 2,187 tests before the final tax/storage/advance
regressions were added. Focused financial, account, file and sharing checks
reproduce the old failures and verify the fixes. Typecheck, lint and the production
build are required again at the final commit; GitHub CI also runs full frontend,
real browser tool, bridge, Deno and disposable PostgreSQL checks.

Backend verification passed 149 Deno tests, seven function entry typechecks,
repeatable SQL migrations, denial/rollback checks and concurrent license, draft,
owner and subscription tests. All provider tests use fixtures; no paid provider
call, real customer message or customer-record reconciliation was performed.

The three new integrity migrations are applied to `voyrjqgaypiylwskkwpr`.
Catalog read-back confirmed service-only execution, owner trigger enablement and
denied client writes to ownership/billing columns. Exact rollout order is in
[MIGRATIONS.md](../../supabase/MIGRATIONS.md). Web/functions rollout follows
required CI success. No desktop installer or auto-updater is published here.

Computer use verified left-edge sidebar opening/closing on Invoice, CRM and AI
in Comet's iPhone 16 touch emulation (393 × 852). Physical iPhone Safari remains
unverified. Native filesystem tests use mocked IPC; live cross-device concurrent
editing and actual provider delivery were not exercised. Multi-table cloud
snapshots are not a server-wide transaction; later reconciliation is still
required when another device edits during a transfer.
