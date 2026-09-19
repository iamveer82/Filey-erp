# Web performance

The September 2026 web update defers the authenticated workspace until sign-in,
loads the AI scheduler runtime only when a task is due, and keeps native WhatsApp
services out of browser startup. Existing authentication, recovery, module access
and desktop behavior remain in place.

Measured with the same Vite production configuration:

| Initial JavaScript | Before | After |
| --- | ---: | ---: |
| Uncompressed | 1,208,141 bytes | 788,526 bytes |
| Gzip | 377,508 bytes | 241,718 bytes |
| Static chunks | 19 | 15 |

This is 35% less initial JavaScript (36% compressed), not a claimed reduction in
page-load time. Routes still load on demand. Content-hashed assets use the existing
Vercel immutable cache plus the browser service-worker cache. HTML checks the
network for deployments; API responses are not cached by the service worker.
Concurrent currency-rate requests share one fetch.

## Workspace data and navigation

Redux Toolkit Query owns the shared search/notification snapshot. Two consumers
now share four module reads instead of separately making four reads each. Query
arguments include the workspace identity and allowed modules. This store lives
only inside the authenticated workspace, resets when it unmounts, and never
persists account data in cookies. API reads and writes still enforce permissions.

The existing cloud read layer now coalesces concurrent reads across all its
callers. Successful snapshots are fresh for 15 seconds; saves, cloud changes,
focus and reconnect invalidate them. An in-flight response from before a write
or identity change cannot become the current snapshot. Permissions are checked
separately and restricted staff reads continue through RLS.

Sidebar pointer/focus intent preloads the destination's JavaScript, without
fetching its records. Data-saving and 2G connections skip this prefetch. Hidden
tabs defer live refresh bursts and suspend the optional scrolling animation.
Returning to a tab rechecks module access without remounting an unfinished form;
switching workspaces never reuses the previous workspace's access permissions.

Two small host-only cookies remember theme and accent when local storage is
unavailable. They apply before React paints, use SameSite=Lax and Secure on
HTTPS, and never hold authentication, API keys or business records.

## Optional Redis cache

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
```

Check sign-in, recovery and authenticated route navigation in the browser as well.
