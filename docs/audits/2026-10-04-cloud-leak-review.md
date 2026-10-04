# Cloud privacy and access review — 4 October 2026

Four confirmed failure paths were repaired in the local checkout. No production
database, Storage setting or Edge deployment was changed. These results apply
to the reviewed source and disposable synthetic databases; they do not establish
that the deployed service has the same protections.

## Confirmed findings and repairs

| Finding | Reproduction and impact | Repair |
| --- | --- | --- |
| Client access to cross-owner retention | The actual pre-repair canonical catalog granted `authenticated` execution of the definer `prune_tool_runs(interval)`. An account unable to read another owner's run could supply a negative retention interval and delete both owners' runs and stored outputs. The historical July ACL migration is excluded from fresh bootstrap because it references a managed advisor function; the final generic ACL pass removed PUBLIC/anonymous access but retained the managed authenticated default. | The new upgrade explicitly revokes PUBLIC, anonymous and authenticated execution and preserves service maintenance. Runtime checks inspect effective grants. |
| Forged cleanup paths | An authenticated account can insert an old own run with another owner's path in `storage_paths`. The old service cron followed that list and deleted the other owner's stored output. Revoking the client RPC alone would not repair this service-role confused deputy. | Retention verifies `filey_tool_path_owned(object.name, run.user_id)` before deleting an object. Forged foreign paths survive; legitimate own old files and runs are still cleaned up. Existing data is not backfilled. |
| Public bucket drift | The original `ON CONFLICT DO NOTHING` creation statements preserve `public=true` on existing `files`, `tool-inputs` and `tool-outputs` buckets. Private object policies cannot make an intentionally public download route private. The defect is conditional on an old/public configuration; this review did not initially inspect production flags. | The repeatable upgrade sets all four intended-private Filey buckets, including `team-attachments`, to `public=false`. It preserves stored objects, current file-size/MIME settings and unrelated buckets. The runtime catalog now checks flags as well as object RLS/MFA. |
| Scheduled delivery after access changes | Scheduled agent briefs and overdue reminders checked workspace admin access before awaited private reads, then sent collected workspace data without a final authority check. A changed active workspace, removed membership or demoted role could leave the old snapshot eligible for delivery. | A service-only invoker boolean RPC checks active profile workspace and current owner/admin membership in one SQL statement. Telegram checks after all job reads; reminders check before every email. Denial/unavailable authority stops delivery. Credentials/destination retain the captured config; failure responses omit accumulated private draft summaries. |

Source repairs are additive migrations
`supabase/2026-10-04-cloud-storage-privacy.sql` and
`supabase/2026-10-04-scheduled-agent-privacy.sql`, plus the scheduled Edge helpers.
The canonical generator includes both after existing current authority upgrades.
Apply the SQL before releasing the matching scheduled Edge functions. Dependency
and release notes are in `supabase/MIGRATIONS.md`. No real provider sends were
performed, and release remains on hold.

## Tested privacy boundaries

The new disposable PostgreSQL runner installs the complete canonical schema,
then reproduces the old function/ACL/bucket behavior with synthetic identities.
It applies both upgrades twice and exercises their real grants, policies,
triggers and functions. It verifies:

- An authenticated account cannot read, update, delete or upload another
  account's personal Storage objects. Anonymous clients see no private objects.
- Service retention deletes valid old own outputs while preserving a forged
  foreign path. Client and anonymous retention calls fail with permission denial.
- Bucket repairs preserve existing object metadata and file constraints, and
  leave an unrelated public bucket unchanged. Repeated canonical installation
  preserves the stored objects and the repaired effective grants.
- Integration-key metadata is visible only to its owner. That owner cannot
  select `api_key`, and clients cannot read even their own channel bot credentials.
- Own tool-job status/output metadata is readable; foreign jobs are hidden;
  client output/specification mutation and foreign input paths are denied.
- Verified MFA accounts at AAL1 cannot read Storage or job rows through RLS;
  AAL2 restores their own reads. This tests the row policies used by Storage and
  Realtime, not an actual deployed WebSocket or Storage HTTP gateway.
- A direct-message recipient can read its attachment. Another workspace admin
  cannot read that direct conversation or its file.
- Deliberately shared invoice tokens return the intended document without
  membership/share-authority fields or a malformed foreign-organization child.
  Unknown and revoked tokens return no document. Anonymous raw document reads
  remain denied; explicit public links are intentionally public.
- The service-only scheduled helper allows a stable owner/admin, denies a
  changed active workspace, demotion or removed membership, and is not callable
  by anonymous/authenticated clients.

Fake-provider Deno regressions additionally prove no Telegram/email call or
message log after denied authority, config capture across the awaited guard,
and a fresh guard before each reminder. A provider request already dispatched
cannot be recalled if access changes afterward; the check binds authorization
at dispatch. Unknown delivery outcomes are not automatically retried.

## Verification evidence

| Command | Local result and log |
| --- | --- |
| `node scripts/test-rls-local.mjs` | Passed initial baseline suite; `output/cloud-leak-rls-baseline.log`. Existing repaired RLS/child/payment/claim fixtures remained green before the fresh repairs. |
| `node scripts/test-cloud-privacy-local.mjs` | Passed all three legacy SQL reproductions and repaired account/privacy matrix, repeated migrations/installer, actual catalog check; `output/cloud-privacy-local.log`. |
| `node scripts/test-schema-bootstrap-local.mjs` | Passed fresh installer, populated repeat, all 14 repeated current upgrades, rollback/refusal and existing document/numbering/team/lead/recurrence workflows; `output/cloud-privacy-bootstrap.log`. |
| `node --test scripts/test-cloud-privacy-checks.mjs scripts/test-runtime-schema-checks.mjs scripts/test-workflow-schema-checks.mjs` | 27 tests passed; `output/cloud-privacy-catalog-tests.log`. |
| `deno test --frozen --allow-env --allow-read supabase/functions/_shared/agent-jobs_test.ts supabase/functions/_shared/admin-workspace_test.ts supabase/functions/_shared/overdue-reminders_test.ts` | 15 tests passed; `output/cloud-privacy-scheduled-tests.log`. No provider calls or secrets used. |
| `deno check --frozen supabase/functions/agent-jobs/index.ts supabase/functions/overdue-reminders/index.ts` | Both entrypoints typecheck; `output/cloud-privacy-edge-check.log`. |

The actual local full-bootstrap catalog contains 93 public tables, 1,192 columns
and 144 named functions with zero checked issues. All public tables have RLS
enabled. The anonymous definer allowlist is limited to the intentional public
share gates and MFA/pre-request helpers. The definer/effective-grant inventory
was reviewed for maintenance paths: `prune_tool_runs` was the unscoped client
retention defect; `sync_bump_sequences` only advances trusted sequences to
existing safe-range maxima and returns no customer rows. The reviewed scheduled
PO, device claim, rate-limit and billing mutators already retain service-only
or explicitly scoped dispatcher boundaries. This is not a claim that every
function body in the entire repository received a fresh full manual review.

CI now runs the additional privacy catalog regressions and the actual disposable
privacy runner alongside the existing installer/security checks.

Frozen SQL SHA-256:

- Storage/retention upgrade: `3d85f79d3596aa391bc73521e391b5ef59766513463a7546f448a7885099eac3`.
- Scheduled authority upgrade: `4e6813e69063a8060963ce1c70a1fcde3815c58f2c242dc33d6065beaaf4e3b9`.
- Canonical installer: `1aae7371b473b0fe031c358b47c4d13df753cafbb13bf6ccf12b076b8927ac8a`.

## Review coverage and limits

`2026-10-04-cloud-leak-review-coverage.json` records exact reviewed files, read
depth, changed artifacts and automated metadata coverage. The large canonical
schema received targeted policy/function inspection and full execution/catalog
validation; it was not manually reread in its entirety. The earlier cloud-data,
billing/workflow and native/MCP audit reports remain separate evidence snapshots.

The fresh manual Edge review focused on `run-tool`, `integrations`, scheduled
jobs/reminders and their authorization helpers. The earlier audit addressed
other payment, invitation, email and public-share failures; their entire code
was not represented as newly audited here. Preserved obsolete SMS/OTP/custom
tables have no active callers and use a transaction-GUC organization helper
that returns no scope by default; no default read bypass was proven, so this
pass did not rewrite those historical rows or policies.

Production configuration access was not independently verified in this task.
The proposed read-only management attempt was cancelled before any saved
credential read or API request. No customer table rows, real files, secrets,
provider credentials or live deliveries are part of validation.
There is no universal "no leaks" guarantee: actual deployed migrations, Storage
gateway configuration, Realtime behavior, backups, operator access and public
links outside this reviewed checkout need their own controlled verification.
