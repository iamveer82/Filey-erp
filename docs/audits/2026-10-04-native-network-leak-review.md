# Native, worker and MCP privacy review — 4 October 2026

This is a bounded follow-up to `2026-10-04-native-mcp-audit.md` and
`../audit-gap-closure-2026-10-04.md`. Changes remain local and unpublished at
version 3.0.10. Only synthetic identities/files and mocked or loopback endpoints
were used; no customer database, provider delivery, cloud mutation or release
was performed.

## Confirmed leaks repaired

1. **Worker converter environment.** `execFile` inherited the supervisor's
   environment, including service-role/provider credentials. A real synthetic
   child reproduced that direct exposure. All five converters now use
   `worker/runtime.js`: an environment allowlist preserves PATH/OS/locale
   variables and sets home/cache/temp locations to the job directory. Service,
   provider, proxy-auth and loader-hook variables are absent. Child output is
   bounded to 1 MiB and existing conversion deadlines remain.
2. **Worker error disclosure.** Node converter failures include stderr in their
   error message; that message was persisted to the user's job receipt and
   printed in logs. A failing synthetic child reproduced private document text
   in this raw error. Job receipts now use a generic conversion failure; logs
   contain job/stage metadata without converter/provider exception text.
3. **Authenticated worker redirects.** Its Supabase client used default fetch
   behavior. The worker now refuses redirects and applies a 30-second request
   deadline while retaining caller cancellation. An actual loopback redirect
   test confirms the destination receives no request. Existing owner-path and
   claim-revision guards remain in place.
4. **MCP local private rows.** Its local reader relied on optional query filters
   and returned another author's private row in the selected organization.
   An implicit visibility predicate now runs before query filtering/projection:
   tagged foreign organizations are denied; owned rows and explicit shares are
   readable; ownerless historical rows remain visible in the allowed workspace.
   A foreign author's share must identify the selected organization. Cached
   administrator labels grant no exception. Document children inherit their
   visible parent, preserving targeted-share totals while refusing separately
   owned/shared children of a private parent. The real `get_invoice` handler is
   covered for private denial and targeted-share allowance.

## Reviewed boundaries

- Worker: `index.js`, `paths.js`, `jobs.js`, `Dockerfile`, package/lock metadata,
  Fly configuration and the new runtime/tests.
- MCP: `client.ts`, `localdb.ts`, tool read/draft/report call sites in `tools.ts`,
  `index.ts`, local smoke fixtures, package/lock metadata and README. Cloud
  client requests already refuse redirects; cloud access uses the account JWT
  and database authorization rather than a service-role key.
- Native rechecks: the global trusted-main-window IPC gate in `lib.rs`,
  `credentials.rs`, AI/media URL/DNS/redirect handling in `ai.rs`, Telegram
  attachment/token transport, Composio account projection, browser URL/state
  filtering, and backup path/link handling. Existing fixes were retained;
  this pass made no new native source changes.
- WhatsApp bridge: owner identity, attachment-location restrictions,
  confirmed delivery/error handling, main bridge input/lifecycle and package
  metadata. Existing security regressions were rerun without pairing/sending.

This is manual coverage of the listed paths, not a complete formal proof or
claim that every native/network execution path was exercised.

## Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Worker path, lease and leakage tests | 12 passed | `output/leak-review-worker-tests.log` |
| MCP TypeScript build | passed | `output/leak-review-mcp-build.log` |
| MCP real local smoke, including privacy, atomic drafts and cross-process races | passed | `output/leak-review-mcp-tests.log` |
| WhatsApp bridge Vitest tests | 50 passed in 5 files | `output/leak-review-wa-tests.log` |
| Native Rust library tests, locked/offline MSVC x64 | 31 passed | `output/leak-review-native-tests.log` |
| Full nested npm dependency scans, including development dependencies | 0 advisories in each package | `output/leak-review-{worker,mcp,wa}-dependencies.json` |

`cargo-audit` is not installed; no Rust advisory scan was completed or tooling
installed for this review.

## Runtime limits and remaining work

The worker still runs its supervisor and parsers under one container OS
identity. An environment allowlist removes direct inherited secrets but cannot
protect against arbitrary parser code execution reading another process or
accessible files. Separate converter UID/privileges, no-new-privileges and
filesystem/network containment require validation with the actual Linux image
and converters. Docker CLI exists here, but its Linux daemon is unavailable;
no container/parser integration or privilege-drop claim is made.

Fetch cancellation/deadlines were tested at request dispatch and header
resolution. Full conversion resource isolation and large/slow response-body
stress were not exercised. Native tests do not prove platform credential-store
behavior, mobile device runtime behavior or real provider delivery. MCP local
visibility prevents accidental cross-profile tool reads; it is not OS-level
access control against someone who can directly read the SQLite file.
