# Filey data privacy audit — 4 October 2026

Confirmed leakage and authorization defects were repaired in the active local
checkout. Version remains **3.0.10**. No deployment, release, production database
change, customer-data read or real provider delivery was performed. The deployed
service cannot yet be described as having these new protections.

## Repairs completed in this review

| Boundary | Confirmed problem | Resulting protection |
| --- | --- | --- |
| Private file uploads and downloads | A shared SDK session could change accounts before the UI/cache adopted that identity, retargeting reviewed file bytes or returning a stale private response. | Each operation captures the reviewed account, organization and mode, pins the original bearer token, and checks the scope before dispatch and after awaited results. Storage uses an independent client without mutating global headers. Delayed results are refused after account/workspace changes or sign-out. |
| Company images | A signing failure printed a private object path and provider error text. | Fixed generic diagnostics omit both values. |
| Cloud maintenance | The fresh canonical schema granted ordinary authenticated accounts execution of an unscoped definer cleanup routine. Its service cron also trusted client-written paths that could point at another owner's output. | Ordinary client execution is revoked. Service cleanup verifies that every object path belongs to the run's owner before deleting it. |
| Private Storage buckets | Old bucket configuration could retain `public=true` because creation used `ON CONFLICT DO NOTHING`. | The additive migration resets the four intended private buckets to private, preserving their objects and size/type restrictions. This defect was reproduced locally; production bucket flags were not inspected. |
| Scheduled private deliveries | Workspace authority was checked before private reads, with no final check after the awaited reads and before Telegram/email dispatch. | A service-only SQL helper checks current active workspace and membership together. Every outbound delivery rechecks authority and keeps the original destination/credential configuration. Denial fails closed without sending or returning accumulated private summaries. |
| AI and cloud fetch | Browser requests could follow redirects, attach cookies/referrers, or allow callers to override privacy options. Browser AI endpoints lacked the native transport's endpoint restrictions. | Sensitive fetches refuse redirects and force no-store, omitted cookies and no-referrer. AI requires HTTPS or an exact local loopback connection, with no embedded credentials. Existing native endpoint restrictions remain. |
| Web script execution | Web policy allowed arbitrary inline scripts and JavaScript evaluation. | Production CSP allows trusted boot-script hashes and WebAssembly, blocks arbitrary inline scripts/event handlers and JavaScript evaluation, and adds an HTTP frame-ancestor restriction. Development hashes only its actual trusted Vite inline scripts. |
| Optional cloud monitoring | Raw error messages, request/context data and network breadcrumbs could contain business content or credentials. | Reports allow only generic error categories and safe bundled-code locations. Breadcrumbs, transactions and automatic session integration are disabled; switching to local mode drops reports. Local mode does not initialize monitoring. |
| Converter worker | Parsers inherited service/provider credentials; raw converter stderr appeared in job receipts/logs; authenticated fetch followed redirects. | Converter environments contain only required runtime variables and job-local paths. Public errors are generic, converter output is bounded, authenticated requests refuse redirects and have a dispatch deadline. |
| Local MCP tools | An optional caller filter could expose another author's private row in the selected organization. | Visibility is applied before query projection: matching organization plus ownership or an explicit share is required. Children inherit their visible parent. Cached admin labels cannot grant extra access. Genuinely ownerless legacy rows remain supported. |

## Verification

All automated tests use synthetic identities/files and fake or loopback provider
endpoints. Disposable PostgreSQL tests execute the actual policies, grants,
functions and migrations rather than treating mocked access checks as proof of
database isolation.

The Chrome fixture loads the trusted Vite-transformed HTML with the tested
policy. Its `--production` option additionally validates the built HTML policy
and exact boot-script hashes; it does not exercise a full production app startup,
deployed headers, iOS WebKit or native runtime. A separate read-only review found
no concrete privacy regression in the root-owned transport, monitoring or CSP
changes.

| Check | Result | Evidence |
| --- | --- | --- |
| Complete frontend suite | **2,803 passed across 360 files; 0 failed** | `output/security-leak-frontend-verified.log` |
| Complete frozen Edge suite | **221 passed, 0 failed** | `output/security-leak-edge-final.log` |
| TypeScript and production build | Passed | `output/security-leak-build-final.log` |
| Built CSP/boot-script checks and real Chrome privacy fixture | All 7 behavioral checks passed; redirect receiver received zero requests; no cookies/referrers on sensitive requests | `output/security-leak-build-final.log` |
| Existing real-browser conversion/PDF/WASM regression | Passed | `output/security-browser-tools-regression.log` |
| Disposable cloud privacy matrix | Passed baseline reproductions, fixed access matrix, repeated upgrades and object-preserving installer | `output/cloud-privacy-local.log` |
| Fresh/repeated canonical installer and all 14 current upgrades | Passed; 93 tables, 1,192 columns, 144 functions, zero checked catalog issues | `output/cloud-privacy-bootstrap.log` |
| Schema checker regressions | **27 passed** | `output/cloud-privacy-catalog-tests.log` |
| Worker tests | **12 passed** | `output/leak-review-worker-tests.log` |
| MCP build and actual local smoke | Passed, including private-row denial and cross-process races | `output/leak-review-mcp-build.log`, `output/leak-review-mcp-tests.log` |
| WhatsApp bridge tests without pairing/sending | **50 passed** | `output/leak-review-wa-tests.log` |
| Native locked/offline Rust library tests | **31 passed** | `output/leak-review-native-tests.log` |
| npm advisory scans including development dependencies | **0 reported advisories** in root, worker, MCP and WhatsApp packages | `output/security-leak-npm-audit-2026-10-04.json`, `output/leak-review-{worker,mcp,wa}-dependencies.json` |
| Changed frontend lint | Zero errors; one existing numeric request-counter cleanup warning | `output/security-leak-changed-lint-final.log` |
| Complete repository lint | Zero errors; 609 remaining warnings | `output/security-leak-lint-final.log` |
| Hosted email/invitation security regression | Passed after documenting the intentional control-byte rejection for ESLint; validation behavior unchanged | `output/security-email-workspace-final.log` |
| Working-tree whitespace check | Passed | `git diff --check` |

The initial complete frontend run found one assertion expecting the previous
workspace-change message, while the protected save correctly refused the
operation and wrote no file. Its expected text was updated to the shared guard's
current message. The final complete repeat passed and includes that assertion
and the monitoring type correction used by the successful production build.

The full lint initially flagged the existing workspace-identifier sanitizer's
intentional ASCII control-character range. A local rule annotation explains why
that range must stay; no security validation was removed. The focused hosted
email/invitation regression and complete lint then passed. The remaining lint
warnings are recorded rather than represented as resolved.

An additional source/build scan found no application secret matching the checked
provider/private-key patterns. The only matches were unchanged Tesseract WASM
vendor files, verified against the installed vendor package by SHA-256. This is
a bounded pattern scan, not proof that every possible secret format is absent.
The browser Supabase publishable key is intentionally public; service-role and
provider keys must remain server-side or in the user's selected credential store.

## Production status and release order

The live authenticated catalog and Storage configuration were **not verified**.
No saved management credentials were read and no management API request occurred
in this task. A public HTTPS header check of `app.gofiley.com` found HSTS,
frame denial and nosniff, but no CSP HTTP header; the new header changes have not
been published. Its Last-Modified value was 2 October 2026, before this review.

Before rollout:

1. Inspect deployed schema, effective function grants, bucket flags and relevant
   policies using authorized metadata access. The runtime checker can compare
   that catalog with the reviewed source requirements without customer reads.
2. Apply the existing pending authority/workflow upgrades in their documented
   order, followed by `2026-10-04-cloud-storage-privacy.sql` and
   `2026-10-04-scheduled-agent-privacy.sql`. See `supabase/MIGRATIONS.md`.
   These additive privacy migrations do not delete customer records or objects.
3. Deploy matching scheduled Edge functions after their SQL helper. A missing or
   unavailable helper fails closed. Publish the frontend and HTTP security
   headers from the successfully built checkout.
4. Verify the deployed metadata and actual Storage/Realtime/provider boundaries
   with controlled test accounts. Local SQL tests do not establish live gateway,
   infrastructure, backup or operator behavior.

## Material limits and remaining hardening

- **Converter OS isolation remains unverified.** The worker supervisor and
  parsers still share one container identity. Removing inherited credentials
  closes direct exposure but is not a sandbox against parser code execution.
  Separate converter privileges and filesystem/network containment require a
  tested Linux-image implementation. The Docker Linux daemon was unavailable
  here, so no container integration or privilege-drop claim is made.
- Local device account/workspace gates and MCP filtering prevent application
  cross-account reads. They do not encrypt ordinary browser/SQLite business
  storage against someone with OS or browser-profile access. Native credential
  storage and backup protections remain separate boundaries.
- An authorized offline download/export cannot be erased by later cloud team
  revocation. Explicit public share links intentionally expose their selected
  documents until revoked/expired; exported copies may outlive the link.
- A correctly authorized provider request already dispatched before a subsequent
  access change cannot be recalled. The new final check binds authority at
  dispatch and does not automatically retry an ambiguous delivery.
- `cargo-audit` was unavailable, so no Rust dependency advisory scan was
  completed. Physical iOS/Android runtime, platform credential vault behavior,
  full converter resource stress, backup/operator controls and actual provider
  retention were not established by these tests.

This review establishes concrete repaired boundaries and reproducible tests. It
does not establish a universal guarantee that user data can never leak or a full
fresh manual review of every line in the repository.

## Detailed reviews and references

- [File and device workspace review](audits/2026-10-04-local-data-leak-review.md)
- [Cloud privacy and access review](audits/2026-10-04-cloud-leak-review.md)
- [Native, worker and MCP review](audits/2026-10-04-native-network-leak-review.md)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [CSP script controls](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)
