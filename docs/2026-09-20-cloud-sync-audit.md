# Cloud connection and photo-sync audit — 20 September 2026

## Changes

- Saved stamps, signatures and reusable images now use the active `sb()` data client. Local writes and deletions enter the existing durable sync journal; cloud writes surface errors instead of claiming success. The old global `filey.assets.v1` cache is preserved behind an explicit recovery action because it has no trustworthy account owner.
- Local My Files, folders and image-library reads no longer hide imported rows whose `owner` is a real cloud UUID. Local storage has one verified device owner; cloud queries retain the owner filter and server RLS.
- Editable local profile fields, including the avatar, have an account-scoped retry queue. Automatic sync, Sync now and the one-time local-to-cloud transfer send pending edits. Failed requests and edits made during an upload remain pending. Role, organization, authentication email and subscription fields are excluded. Reconnecting cannot replace a pending photo with the old cloud profile.
- New profile-photo uploads are resized to at most 512px before saving, reducing profile response sizes and offline storage use. Decode/storage failures are reported.
- Saved-image/file/folder pulls use the existing `sync_revision` trigger to fetch only changed row bodies. A full ID/revision list still propagates remote deletions. An unchanged image library no longer retransmits every base64 image each sync beat.

## Schema and hosting findings

The frontend's local data client stores JSON collections in SQLite `kv_cache` on desktop and localStorage in the browser. The older typed SQLite tables are not the schema used by normal `sb().from(...)` calls. Adding a cloud field does not require rewriting those collections. The existing SQLite upgrade check passes against a disposable old database, including preservation of existing rows and a second idempotent migration run. No customer database was opened or migrated during this audit.

The changed paths use existing cloud columns (`profiles.avatar`, the other editable profile fields, and `user_assets.data_url`) and the existing September 12 sync-revision migration. No new business-table migration is required for this change. Live catalogue presence still needs authenticated verification.

Vercel hosts the Vite application; this repository does not define a separate Vercel database schema. `vercel.json` already caches content-hashed assets for one year. A live HEAD request to the production entry JavaScript confirmed HTTP 200, JavaScript content type and `public, max-age=31536000, immutable`. HTML, manifest and service-worker requests also returned the expected types. These checks establish routing/cache configuration, not a user-performance benchmark.

Existing company logos and local stamps are inline data URLs in company/settings/document rows and follow those rows through sync. My Files uploads bytes to the private Storage bucket before publishing metadata and downloads bytes before committing a pulled file index. Integration tests cover retries and missing bytes. The new image-library test checks that the exact saved image data reaches `sync_record` after a failed first attempt.

## Live checks still blocked

Both the Supabase project dashboard and Vercel project dashboard redirected to sign-in. The saved Supabase management credential previously returned 401. The public REST catalogue also requires stronger authentication; that response does not establish a failure of authenticated application queries. No production schema, secret, permission or business record was changed.

Before shipping the whole current branch, restore dashboard access and complete the existing backend-first deployment order in [the bug audit](2026-09-20-bug-audit.md) and [team collaboration](team-collaboration.md). Re-check actual table columns, revision triggers, private Storage policies, RPC grants, deployed edge functions and the Vercel production environment. Then exercise a real authenticated two-device upload/reconnect and two-user workspace test with disposable accounts.

The older unscoped image library is not uploaded automatically. Its owner can open a PDF image tool, choose **Recover images saved by an older version**, select their image and save it into the current library. Profile photos saved before this queue existed can be saved again to queue them. Automatic uploads require the matching account to be connected and Cloud sync enabled; Sync now remains available for an explicit one-time upload.

## Verification

- Focused image/file/profile/sync/auth checks: 62 tests passed before the final photo-resize checks.
- Disposable PostgreSQL suite: passed revision conflicts, tenant/module isolation, expense transactions, Basic invoice limits, team workflows and atomic rate limits.
- Desktop SQLite migration check: passed; fixture records preserved.
- TypeScript check: passed before the final photo-resize change.
- Browser QA: a synthetic profile photo saved successfully and remained present after reload in the cloud-disconnected QA workspace.
- Full suite/build/lint: final results recorded below after completion. The initial concurrent run exhausted machine memory; checks were rerun sequentially with one test worker.

### Final results

- Full application suite: **1,621 tests / 253 files passed** with one worker.
- Final photo-resize/profile/auth regression pass: **18 tests / 3 files passed**, including two additional avatar tests added after the full run.
- Production build (including TypeScript) and route-bundle checks passed. Initial static JavaScript remains approximately 792 KB; unrelated converters remain lazy.
- ESLint: **0 errors, 512 warnings** (existing warnings plus four in the new test/hook code).
- Browser QA also confirmed a public Filey image saved into the reusable local stamp library. A 1,085,549-byte PNG chosen as a QA avatar became a 512 × 512 WebP with 10,787 data-URL characters (roughly 8 KB image payload), then saved successfully. This is one fixture result, not a general compression guarantee.

Changes are local to the development branch. No production deployment was attempted because the branch's previously documented backend migrations/functions still need deployment and authenticated verification.

## Follow-up: free-tier usage and connection checks

- Local save-triggered sync now reconciles only uploaded collections. Startup,
  reconnect, foreground catch-up, the visible five-minute interval and manual
  sync retain full reconciliation. A product-only save makes one collection
  metadata scan instead of 45. Uploads, membership and bookkeeping still run.
- Message histories and the remaining CRM/work collections now use their existing
  sync revisions instead of repeatedly fetching unchanged row bodies. No new
  migration, dependency, Redis instance or paid service was added.
- Completed pulls identify changed tables so unrelated mounted consumers do not
  refresh. Automatic-sync timers/listeners are removed on development hot reload.
- The live project Auth settings endpoint returned HTTP 200 using the application's
  publishable key. A one-time schema-presence check used `select=...&limit=0` for
  all 45 synchronized collections plus the profile fields. **42/46 checks returned
  HTTP 200**. `company_profile`, `app_settings`, `org_messages` and `profiles`
  returned 401 (`permission denied for function current_org`) to this anonymous
  request. These require an authenticated check; the result is not evidence that
  signed-in users are denied access. No business rows were retrieved or changed.
- Both dashboards still require sign-in in the available browser. Vercel is waiting
  for email verification; Supabase needs sign-in. Column-presence checks do not
  verify production triggers, policies, indexes, Storage rules or deployed function
  versions. The previously shared management tokens both returned 401.
- GitHub still reports production deployment `6548612696` at commit `04ee646b`.
  Neither the earlier local-photo fixes nor this follow-up is deployed.

Follow-up verification: **60 tests across 8 sync/cache/refresh test files passed**,
TypeScript passed, and the disposable PostgreSQL suite passed sync conflicts,
tenant/module permissions, expense transactions, invoice quotas, billing, team
workflows and rate-limit checks. The production build, route-bundle checks,
ESLint error check for changed files and the desktop SQLite migration check all
passed. Initial static JavaScript is 792,370 bytes; the build retains existing
converter chunk/import warnings. These checks use disposable fixtures, not
customer data.

### Authenticated Vercel check

Vercel email and authenticator verification completed on September 20. Dashboard
inspection confirmed:

- `app.gofiley.com` and `filey-erp.vercel.app` both show **Valid Configuration**
  and target Production. Production is Ready at `04ee646b`, built from `main`.
- The project uses Vite and Node 24. The production build overrides are
  `npm run build` and `dist`, matching `vercel.json`; the dashboard's override
  notice does not indicate a mismatch in those commands.
- There are no project environment variables or linked shared variables. The
  frontend therefore uses its checked-in public Supabase configuration. Backend
  provider secrets belong to Supabase Edge Functions, not this static deployment.
- The six-hour overview showed 394 edge requests, zero Vercel function invocations
  and a 0% error rate. The twelve-hour CDN view showed 665 requests, 0% HTTP 5xx,
  3ms p90 TTFB, a 29.2% hit rate, 471 misses and zero bypasses. These are dashboard
  snapshots for those periods, not end-user load-time or Supabase health metrics.
- The `filey-catalog-cache` database is available at team level but is not linked
  to this Vercel project. This is compatible with the existing design: Supabase's
  integrations function accesses Redis using its own backend secrets.

No Vercel configuration, service plan, database connection or production deployment
was changed. Supabase still shows its separate sign-in page; production database
policies/triggers, Storage configuration and backend deployment prerequisites
remain unverified. The reduced-read/photo-sync changes are still on the development
branch and have not been promoted to production.
