# Filey security and reliability audit — 3 October 2026

This pass fixes confirmed access-control, request-boundary and asynchronous
account-switch defects in the current 3.0.10 source. Existing UI, wallet, video,
letter and packaging-list work is preserved. All changes in this pass are local;
the release hold remains in effect.

## Confirmed defects and repairs

| Boundary | Reproduced gap | Repair |
| --- | --- | --- |
| Former team members | Removing or leaving a team left `profiles.org_id` pointing at the former workspace. Organization, roster, colleague profile, company/bank information and usage reads trusted that stale pointer. Legacy `app_users` writes also trusted it. | Require actual membership independently of the profile pointer. Preserve legitimate personal/current-workspace reads and deny module-restricted invoice usage. Apply a restrictive membership gate to legacy users. |
| Private audit history | Ordinary staff could read audit snapshots containing private invoice or payroll values even when the underlying business module was restricted. A member could also attribute an inserted audit entry to another account. | Limit audit reads to owner/admin, bind member insert attribution to the authenticated current member, and preserve immutable administrator history. |
| Billing account and workspace | A delayed session lookup or SDK dispatch could charge or open billing for a newly selected account/workspace. An unchanged cache could lag a changed session. | Capture the reviewed account and organization before awaiting, compare the returned session owner, pin its bearer token, abort stale dispatch and reject stale results. Workspace billing actions validate optional expected organization on the server before provider work. Account-wide Coin/Ultra operations remain account-wide. |
| Integrations and cloud keys | Default connector calls lacked scope fencing; account changes could retarget calls or deletion of a saved provider key. Same-account cross-tab workspace changes could resolve a different provider entity at the server. | Fence default calls, pin the captured token, validate the session against the reviewed account, and send the original organization for server verification. Cloud-key reads/writes/deletes remain bound to their original user. Do not retry mutations. |
| Payment request size | The public billing endpoint buffered unlimited action and signed-webhook bodies, including streams without truthful length headers. | Count actual streaming bytes; reject actions above 16,384 bytes and webhooks above 1,000,000 bytes. Preserve valid signed UTF-8 bodies and stop oversized streams before authentication, database or provider work. |
| Integration request size | The public integration endpoint also buffered unlimited unauthenticated JSON. | Cap streamed/declared bodies at 1 MiB, cancel oversized streams before any database/provider request, and reject malformed requests or unsupported methods with static errors. |
| Error disclosure | Billing/integration failures and client prefix matching could expose raw SDK, SQL or provider details. | Forward only exact approved first-party billing errors; use static integration provider failures and generic internal errors. Retain clear sign-in, workspace-change and insufficient-credit instructions. |
| Native command authority | The global native command dispatcher relied on the window label; only selected commands checked its current origin. | Require the existing trusted Filey origin check for every native invocation, including correct bundled-origin ports. Keep the supported local development origin. This strengthens the native boundary in addition to Tauri capabilities. |
| Native media downloads | Hostname-only checks let public-looking names resolve to private, loopback, reserved or mixed public/private network addresses. | Resolve and validate every connection address in the actual HTTP resolver; reject mixed/empty answers, non-public IPv4/IPv6 and redirects. Preserve the separate intentional local inference path. |
| Credentialed redirects | Provider redirects could carry custom API-key headers outside their intended origin. | Disable redirects for native Composio, hosted channel and hosted integration calls, including Zernio deletion. Remove raw native provider error payloads. |
| Revoked channel authority | Warm channel isolates cached pairing/enabled state for 30 seconds; approval, awaited model/tool work and final delivery could continue under a disconnected, re-paired or revoked actor. | Read pairing/enablement fresh, verify the original actor/workspace at authority checkpoints, and recheck approvals, awaited work and final output. Validate the exact credential snapshot used for delivery and fence the bridge response after logging. Same-channel reconnect acknowledgements become generic setup guidance when pairing resets; private replies get no exception. |
| Reminder delivery | An HTTP-success response without a provider receipt was reported as a sent email. | Require a nonempty delivery receipt. Mark ambiguous acceptance honestly and avoid an automatic second send. |

Approved outbound customer messages also recheck their original actor and
workspace after destination credentials resolve, immediately before dispatch.
This preserves the explicitly approved customer recipient while preventing a
revoked conversation from executing an earlier approval during that lookup.

## Schema and rollout status

The new membership/audit repair is
[`2026-10-03-workspace-membership-read-integrity.sql`](../supabase/2026-10-03-workspace-membership-read-integrity.sql).
It is included in the baseline schema and the disposable database suite but
**has not been applied to production**. It changes authorization, not customer
business rows. Existing pending wallet/video migration work remains separate.

The web/mobile build, Dodo and integration endpoints, hosted channel handler and
desktop native changes also require their normal deployments/builds before
users receive these repairs. No live database migration, release, secret update,
paid provider call, real payment or customer message was made during this pass.

## Validation

Regression cases cover removed/self-left members, limited modules, staff versus
administrator audit reads, forged audit attribution, repeatable migrations,
account/cache/session races, same-account workspace switches, no-retry mutations,
oversized and deceptive streamed bodies, safe errors, DNS and origin bypasses,
revocation while waiting for a model or approval, and missing delivery receipts.

The PostgreSQL runner uses a disposable database and synthetic rows. Its fixture
first proves the old access leaks, applies the repair twice and then verifies
the denied cases and legitimate owner/admin/member paths. Native tests execute
the Windows Rust library; they do not substitute for a packaged desktop IPC
navigation test. Channel/provider tests use mocks and send no real messages.

The final frontend suite passed **2,496 tests across 343 files**, and the
TypeScript/production build passed. Changed frontend files have no lint errors;
the existing warnings in `api.ts`/`supabase.ts` remain. The Windows Rust library
passed **25 tests**, and the full disposable PostgreSQL suite passed. The final
complete backend suite passed **209 tests**, and frozen type checks passed for
the Dodo, integration and channel endpoints.

Final evidence is recorded in `output/security-audit-final-frontend-tests.log`,
`output/security-audit-final-production-build.log`,
`output/security-audit-final-edge-tests.log`,
`output/team-membership-audit-rls.log`,
`output/native-channel-security-rust-tests.log`, and the focused regression logs.

## Remaining dependency advisory

The production dependency audit reports zero advisories. The development-only
shadcn CLI dependency chain still includes `braces` affected by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The current advisory has no patched release. npm reports six affected nodes
from that single advisory; an unsafe downgrade or an invented fixed version is
not applied. Recheck when the upstream repair is available. Audit JSON evidence
is in `output/security-audit-dependencies-2026-10-03.json` and
`output/security-audit-production-2026-10-03.json`.

These checks cover the confirmed issues above; they are not a certification of
every application path or the currently deployed production source.
