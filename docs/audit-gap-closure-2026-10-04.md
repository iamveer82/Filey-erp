# Audit gap completion — 4 October 2026

This follow-up implements the remaining numbering, transaction, desktop/MCP,
fresh-install and development-dependency repairs from the
[earlier audit](full-codebase-audit-2026-10-04.md). The working-tree version stays
3.0.10. Changes and database migrations are local and unpublished.

## Numbering

Automatic numbers are reserved atomically for invoices, purchase invoices,
quotes, purchase orders, sales orders, receipts, letters, packaging lists,
delivery challans and declarations. Cloud allocation binds the request to its
account, workspace, module, pattern and year. Device and MCP allocation share
the same durable reservation collection and write lock.

Manual numbers are checked after trimming and case normalization. New duplicate
numbers and cloned record identities are rejected. Unchanged historical
duplicates are preserved for reconciliation. An abandoned reservation can leave
a gap; its number is never recycled. Exhausted or unsafe counters fail clearly
instead of rounding, overflowing or restarting.

## Transactions and retries

Cloud invoice, purchase-order, order, stock, advance and journal workflow RPCs use
operation-specific database transactions. Local equivalents stage all affected
collections and their sync journal together. Posting, reversals, inventory,
payments, credit allocation and account balances either commit together or
leave the prior state intact. Missing cloud migrations fail closed.

Requests retain durable replay identities after an uncertain response. The
reviewed payload and exchange-rate snapshot survive retry; separate intentional
stock adjustments have separate identities. The device pending-request
registry uses compare-and-set storage across renderers. A foreign active request
requires recovery before another matching action can be started. Clients cannot
forge, overwrite or delete cloud workflow receipts or assume the isolated
execution role. That role inherits ordinary application RLS and owns no business
table. Mutating internal helper RPCs are executable only by that role; clients
must enter through the public workflow and cannot call posting or reversal
helpers directly to bypass its receipt. Calculator and permission-scoped
read-only helpers retain their intended access.

Cloud advance spending uses the original invoice author's credit pool, including
when an administrator edits that invoice. Generated lines, payments, accounting,
inventory effects and credit consumption retain their parent author. Shared,
read-only deposits cannot be spent by another author. Incompatible historical
ownership fails for reconciliation rather than silently omitting hidden effects.
Device workflows retain ordinary same-author and untagged legacy records;
editing another author's imported business record requires cloud mode, so an
offline edit cannot introduce conflicting ownership for its generated effects.
Local credit previews and spending exclude other authors' imported deposits.
An overdrawn historical author pool requires reconciliation before another
author's intact-looking deposit can be spent or reduced. Normal note edits and
safe release of an attributable allocation remain supported.

The generic document-save RPC preserves child ownership across administrator
and original-author edits. Ordinary invoice and purchase-order calls through
that endpoint remain draft-to-draft; finalization goes through the business
dispatcher. Failed replacements preserve the existing header and all lines.
Ledger repair requires source identity and preserves legitimate equal manual
entries, ambiguous old payment references and separate payment identities.

Recurring drafts and their next-run dates now commit in one transaction.
Concurrent callers generate one cycle. The cloud caller and server use the same
UTC calendar day, validate the computed next date and reject malformed historical
line ownership even when RLS hides those lines from an ordinary read. Copied
drafts get fresh identity and sharing state; prior advance allocations are not
copied. Inquiry, voucher, coupon and notification setup also commits together,
with stable replay and no repeated email after an acknowledged inquiry.

Legacy already-created Stripe invoice checkouts now determine paid status with
the current line-aware calculator, including manual/formula amounts, per-line
discounts, tax categories, charge rows, round-off and applied advances. Partial
and full payment boundaries, immutable replay, rollback and concurrent delivery
are tested in PostgreSQL. The public invoice checkout remains disabled; historic
accounting reconciliation is not replaced by this settlement-total repair.

## Desktop and MCP

Memoized collections and journals revalidate their stored bytes. Native SQLite
compares the complete captured read set under its write lock; phone IndexedDB
compares and commits within one transaction. Browser local storage serializes
with Web Locks and preserves the previous values on a quota failure.

Independent writers cannot silently replace stale snapshots. Pure deltas and
inserts may retry with fresh data at most three times. Complex workflow callbacks
report a recoverable conflict instead of being replayed. Tombstones, revisions
and concurrent dirty IDs are preserved. Ignored staged read/write errors still
abort the transaction.

Returned records and staged/captured write inputs also have independent mutable
containers. Changing a nested value without saving, mutating an input after a
save or changing a row inside a failed transaction cannot leak into the memo or
a later unrelated save. Parsed and hydrated internal caches remain reusable.

## Fresh database setup

The canonical installer includes the explicitly ordered historical feature
chain and current authority migrations. It runs as one transaction and keeps a
private migration-hash ledger. A repeat preserves saved rows and wallet balances;
changed historical hashes and existing untracked application databases are
refused before mutation. Use dated upgrades for existing databases.

Auth accounts created before the first installation are provisioned once with
their own profile, personal organization and owner membership. Repeating the
installer does not recreate a deliberately removed profile. Final runtime
catalog checks verify RPC signatures, source bodies, private receipt grants,
role privileges, table/column requirements, RLS and Realtime definitions.

The business-workflow upgrade also passes owner transfer and repeat installation
under a non-superuser installer. A conflicting unsafe executor role is refused;
temporary schema CREATE permission is revoked before commit. Valid administrators
can edit member-owned documents repeatedly while preserving the parent owner and
the original author's access to replacement lines.

Supabase Auth/Storage prerequisites, administrator configuration and the
upgrade procedure are documented in [BOOTSTRAP.md](../supabase/BOOTSTRAP.md)
and [MIGRATIONS.md](../supabase/MIGRATIONS.md). Installation does not configure
provider credentials, Edge deployments or a live payment gateway.

## Dependency audit

The unused development shadcn generator installed the unpatched
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
Removing that generator removes the vulnerable dependency chain. Application
components, registry configuration and the exact licensed CSS remain in the
repository. No audit suppression or incompatible downgrade was used.
See [UI component maintenance](ui-component-maintenance.md).

The full root npm audit, including development dependencies, reports zero
vulnerabilities. A separate clean `npm ci` succeeds from the checked-in lock.

## Verification

Final consolidated results are recorded here after the coordinated source
freeze. Focused suites overlap full suites and are not additive test counts.
The final API, business upgrade and canonical installer SHA-256 hashes are
`80a550581c6e94114e1aedf719c1fefbaf1c70d9c73983472c9d86b26f304103`,
`2e93b6652afa8b0dd28718579e5729ceed4ed44569b73d0f7b19c0e76f466617`
and `e97f8dd64af6de799f2e349ce829ed0636174551933040bd43b85fd13087f345`.
The reviewed source inventory and focused coverage manifests preserve the
other file hashes. Prior failure/baseline logs are retained separately.

| Check | Result | Evidence under `output/` |
| --- | --- | --- |
| Full frontend suite | 350 files / 2,594 tests passed, zero failures | `completion-frontend-final.log` |
| Full Edge suite / frozen entrypoint checks | 216 passed / all checked entrypoints passed | `completion-edge-final.log`, `completion-edge-check-final.log` |
| Entire fresh installer / upgrade / rollback / catalog | Passed; 93 tables, 1,192 columns, 143 named functions, zero issues | `bootstrap-complete-tests.log`, `bootstrap-catalog.json` |
| Numbering / lead / recurrence SQL assertions | 45 / 24 / 44 passed, with concurrent allocation and replay | `bootstrap-complete-tests.log` |
| Business workflow SQL, rollback, authority and eight-way retry | Passed, including FX, costs, original-author reversals after administrator edits, legacy negative-pool recovery, private credit pools, hidden historical stock effects and executor-only helper ACLs | `completion-business-workflows-final.log` |
| Legacy Stripe total/status parity and protections | Passed; four modern total cases, license/replay/currency guards, rollback, malformed history and eight-way delivery | `completion-stripe-totals-final.log` |
| Schema drift checker | 21 tests passed; 32 explicit RPC signatures, including 12 executor-only internal helper signatures | `completion-schema-checks-final.log` |
| Full existing RLS / payroll / subscription-claim suites | Passed, including concurrency | `completion-rls-final.log` |
| Desktop/MCP/phone cache and API compatibility | 131 frontend checks, 31 native checks, real separate-process/four-process MCP checks and 17-tool handshake passed | `local-cas-2026-10-04-frontend-final-tests.log`, `local-cas-2026-10-04-native-tests.log`, `local-cas-2026-10-04-mcp-tests.log`, `local-cas-2026-10-04-mcp-handshake.log` |
| Real Chromium tool/PDF/CSP fixtures | Passed | `completion-browser-tools.log` |
| Production build / TypeScript / route graph / release recovery | Passed | `completion-build-final.log`, `completion-typecheck-final.log`, `completion-route-bundles.log`, `completion-release-recovery.log` |
| ESLint | Zero errors; 601 warnings remain | `completion-lint-final.log` |
| Full npm audit / clean lock installation | Zero vulnerabilities / passed | `completion-dependency-final.json`, `completion-clean-install.log` |

## Rollout and remaining boundaries

Apply the reviewed database upgrades and matching Edge/client/MCP/native changes
as one controlled release. These repairs have not been deployed to the website,
Supabase or desktop updater. No customer data, payment provider or live checkout
was used in verification.

Existing historical duplicates, unidentified old accounting bundles and opening
balances require explicit reconciliation; the repairs do not guess ownership or
rewrite financial history. Existing lint warnings and large-file/type debt remain
separate work. Physical iOS/Android behavior, production gateway configuration
and live deployment parity still need release testing. Passing these checks is
not a claim that every line or every possible defect has been certified.

Direct authenticated table writes used by import, synchronization and some
remaining manual workflows still rely on RLS, module/MFA and data triggers;
they do not exclusively require these business dispatchers. In particular,
own-row invoice/PO headers, lines and payments can still be changed through
raw REST. This pass makes the application workflows and the generic-save
endpoint transactional; enforcing the same business invariants on every raw
write requires a coordinated import/sync authority redesign. A blanket write
revoke would break those existing workflows and has not been applied.
