# Web performance

The September 2026 web update defers the authenticated workspace until sign-in,
loads the AI scheduler runtime only when a task is due, and keeps native WhatsApp
services out of browser startup. Existing authentication, recovery, module access
and desktop behavior remain in place.

Measured with the same Vite production configuration:

| Initial JavaScript | Before | After |
| --- | ---: | ---: |
| Uncompressed | 1,208,141 bytes | 791,002 bytes |
| Gzip | 377,508 bytes | 242,655 bytes |
| Static chunks | 19 | 16 |

This is 35% less initial JavaScript (36% compressed), not a claimed reduction in
page-load time. Routes still load on demand. Content-hashed assets use the existing
Vercel immutable cache plus the browser service-worker cache. HTML checks the
network for deployments; API responses are not cached by the service worker.
Concurrent currency-rate requests share one fetch.

Public tool covers and icons have a one-hour browser cache; they are not marked
immutable because their filenames do not contain a content hash. Missing files
under those directories return 404 instead of the SPA shell. HTML, the install
manifest and service worker continue to revalidate so updates remain discoverable.

## Workspace data and navigation

Redux Toolkit Query owns the shared search/notification snapshot. Two consumers
now share four module reads instead of separately making four reads each. Query
arguments include the workspace identity and allowed modules. This store lives
only inside the authenticated workspace, resets when it unmounts, and never
persists account data in cookies. API reads and writes still enforce permissions.

The existing cloud read layer now coalesces concurrent reads across all its
callers. Successful snapshots are fresh for 15 seconds. Known table changes
invalidate their dependent snapshots and refresh only relevant mounted consumers;
unknown changes, focus and reconnect use a broad invalidation. An in-flight response from before a write
or identity change cannot become the current snapshot. Permissions are checked
separately and restricted staff reads continue through RLS.

Sidebar pointer/focus intent preloads the destination's JavaScript, without
fetching its records. Data-saving and 2G connections skip this prefetch. Hidden
tabs defer live refresh bursts and suspend the optional scrolling animation.
After 60 seconds hidden, the shared Supabase Realtime channel disconnects. Returning
reconnects and refreshes authorized data once to catch up on missed changes.
Returning to a tab rechecks module access without remounting an unfinished form;
switching workspaces never reuses the previous workspace's access permissions.

Desktop automatic saves now reconcile only the collections present in the upload
journal. Startup, reconnect, returning to the app, the visible five-minute check
and **Sync now** still reconcile all collections. A pending full check cannot be
downgraded by a simultaneous save. The scheduler releases its listeners/timers on
hot reload. Other-device changes in local mode still arrive on the next full
check; cloud mode retains its existing Realtime subscription.

All synchronized collections now use small ID/version snapshots: tables without
reliable timestamp triggers use the existing `sync_revision` trigger, including
CRM people, notes, tasks and message histories. Only changed bodies are downloaded;
the full ID list still detects deletions. Table-specific sync events avoid
refreshing unrelated mounted sections. A request-count regression confirms a
single product save scans one collection instead of all 45; this excludes upload,
membership and bookkeeping requests and is not a production billing measurement.

Two small host-only cookies remember theme and accent when local storage is
unavailable. They apply before React paints, use SameSite=Lax and Secure on
HTTPS, and never hold authentication, API keys or business records.

Recent email/call history now limits rows in the database query instead of loading
the entire history and slicing it in the browser. Cache keys include the requested
limit. Regression checks verify that an unrelated notification causes zero extra
product/order reads, a product change causes one product read, and requesting 550
call records uses two bounded pages. These are request-count checks, not a measured
percentage reduction in the production Supabase bill.

## Loading states and phone layouts

`FileySpinner` provides the shared rotating arc for busy controls and inline status.
`FileyLoader` and the pre-React splash pair that arc with the existing Filey mascot.
Animations stop under reduced motion; status containers provide accessible labels.

Phone layouts account for display safe areas, browser chrome and the software
keyboard through `visualViewport`. Pinch zoom remains enabled. Fields use 16px
text, common actions use 44px targets, heading actions wrap, and wide data tables
scroll without pinning the action column over their content. Dialogs fit the visible
viewport. The install manifest supports both orientations and a PNG app icon.

Browser QA covered the main workspace routes at 390×844 and 360×800, invoice
creation/template selection without saving, and production sign-in/recovery at
320×740. No business records were changed. Physical iPhone/Android and Safari
device testing remain release checks; responsive Chromium testing does not certify
those devices. Viewport unit checks cover keyboard resize, offset and pinch zoom.

## Redis catalog cache

The integrations Edge Function caches successful Composio toolkit/tool catalogs
for five minutes. Authentication and workspace permissions are checked before
every request, including cache hits. Entries are separated by a SHA-256 digest of
the provider key and request URL; the provider key itself is never stored in Redis.
Account connections, user records, invoices, execution results and errors are not
cached. Entries over 512 KB bypass caching.

Use an Upstash Redis database close to the Supabase function region. Filey's
`filey-catalog-cache` resource uses the Free plan in Mumbai with eviction enabled.
Add these two **Supabase Edge Function secrets**, not Vite variables:

- `UPSTASH_REDIS_REST_URL` — the database REST endpoint.
- `UPSTASH_REDIS_REST_TOKEN` — the database read/write REST token.

The Vercel integration labels these `KV_REST_API_URL` and `KV_REST_API_TOKEN` in
its connection guide. Deploy the `integrations` function after configuration.
No database migration or customer-record update is needed.

Production configuration was enabled on 19 September 2026. Both secret digests
were verified in Supabase and the Redis endpoint returned PONG. The deployed
integrations function already includes the catalog cache. Keep these credentials
in backend secrets; neither the frontend build nor the repository contains them.
A live check of the shared cache module made two requests with synthetic catalog
data: the provider loader ran once, the second request hit Redis, and the entry
had a 300-second expiry. No customer records were used in this check.

Billable integration actions reuse the workspace profile already checked for
authorization, avoiding a second identical profile query. Membership and plan
checks still run on each request.

Missing credentials, quota exhaustion or a Redis outage fall back to the provider.
Each Redis operation has a 500 ms timeout. Monitor usage before changing plans;
no paid upgrade is required by the application.

## Recheck

```sh
npm run typecheck
npx vite build --manifest
node scripts/web-bundle-report.mjs
node scripts/test-service-worker.mjs
deno test --allow-env --allow-net --lock=deno.lock --frozen supabase/functions/_shared/catalog-cache.test.ts
npx vitest run src/components/__tests__/agent-scheduler-scope.test.tsx src/components/__tests__/password-recovery-route.test.tsx src/lib/__tests__/exchange-rates-cache.test.ts src/lib/__tests__/wa-agent-lifecycle.test.ts
npx vitest run src/lib/__tests__/api-cache-concurrency.test.ts src/lib/__tests__/workspace-queries.test.ts src/lib/__tests__/module-access.test.tsx src/lib/__tests__/appearance-cookie.test.ts src/lib/__tests__/performance-ui.test.ts src/lib/__tests__/data-refresh.test.tsx
npx vitest run src/lib/__tests__/cloud-data-reads.test.ts src/lib/__tests__/realtime-session.test.ts src/lib/__tests__/viewport.test.ts src/components/__tests__/filey-loader.test.tsx src/components/__tests__/workspace-session.test.tsx
```

Check sign-in, recovery and authenticated route navigation in the browser as well.
