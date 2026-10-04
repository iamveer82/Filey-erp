# Private file and device workspace review — 4 October 2026

Scope: frontend file bytes, My Files metadata/folders, company images, asset library, workspace switching and device account ownership. Synthetic fixtures only; no customer reads, provider calls, cloud migration or deployment.

## Confirmed defects and repairs

1. **SDK account changes could retarget reviewed bytes.** `saveOutput` without an explicit owner, selected file uploads, company uploads and the asset library trusted `getSession()` without comparing it with the account that owned the visible cache. An SDK session for B could arrive before React adopted B, sending A's selected content into B's storage. `fileOperation` captures cache scope/mode before its first await, requires cloud session identity to match that reviewed account, pins the original bearer independently of the shared client, and stamps new file/asset/folder metadata with the captured organization. Inputs that contain mutable bytes are copied before the await.
2. **Private responses could survive a session change.** Private Storage requests now check the original account and workspace before dispatch and again after the response. Metadata and final byte reads also check before publication; account, organization, mode, cross-tab invalidation and local sign-out reject delayed responses. Same-account token refresh remains supported without changing the captured request identity. No global SDK headers are mutated and no ambiguous write is retried.
3. **Private storage fetches need explicit browser privacy options.** The per-operation Storage client uses `cache: no-store`, `credentials: omit`, `referrerPolicy: no-referrer` and `redirect: error`. This avoids authenticated bytes entering the browser HTTP cache through these application fetches, cookie attachment, private referrers and redirected credential requests.
4. **Company-image diagnostics exposed private values.** Signing failure logged the full object path and provider error message. It now logs a fixed diagnostic without either value. A regression supplies a secret-bearing error and customer-signature path and verifies neither is logged.

## Verification

The final focused run passed **94 tests across 13 files**. It includes the real installed StorageClient with a synthetic fetch implementation, original-JWT header inspection, cached A/session B refusal before dispatch, changed account/workspace/mode/cross-tab responses, signed-link rejection, company image cache isolation, metadata owner/org binding, delayed local sign-out, ordinary offline file/image round trips, expense receipts and workspace copy/switch rollback. There were no network calls to a real service.

TypeScript: `npx tsc --noEmit` passed. Targeted ESLint: zero errors; one existing `useAssets` effect-cleanup warning. Targeted `git diff --check` passed.

## Local authority boundary

`sb()` refuses access to a claimed device workspace after local sign-out; `localAuth` rejects another account claiming that workspace or transferring a different organization into it. Actual application file/image calls are tested against those gates. Genuinely untagged legacy/imported records remain supported.

LocalBuilder and direct `loadColl` intentionally operate on the account-bound device snapshot rather than reproducing live team RLS. An account that explicitly downloaded records while authorized, including records visible to its cloud-admin role, keeps that local copy. Offline team revocation cannot erase copies already supplied to an authorized account. This review does not reclassify that retention as another account's cloud access or impose a cached-admin privilege. The MCP caller boundary receives its own stricter tagged-row filter in the separate native audit.

## Limits

- A request already dispatched with the original authorized identity may complete before sign-out. It cannot be retargeted to the next account, and its delayed result is discarded.
- An explicitly exported/downloaded file or copied sharing URL remains available to its recipient; browser/OS file access is outside the application session boundary. Temporary storage signing and existing share-link expirations remain unchanged.
- Local business storage is protected by the device account gate, not an assertion that JavaScript storage is encrypted against someone with OS/browser-profile access. Native storage and recovery encryption are reviewed separately.
- Cloud RLS/storage policy and infrastructure/provider retention are separate server concerns. This frontend test run does not verify a deployed schema or claim production was updated.

## Manually reviewed sources

Full reads: `src/lib/files.ts`, `assets.ts`, `fileWorkspace.ts`, `localPaths.ts`, `dataMode.ts`, `realtime.ts`, `agentStorage.ts`, `src/components/CompanyAssetImage.tsx`, `PdfCanvas.tsx` and the focused file/image regression fixtures.

Targeted traces: `api.ts` cache identity, list/child helpers and local owner pools; `localdb.ts` LocalBuilder/auth/storage entry points; `supabase.ts` client/owner gate; `cloudSession.ts` authenticated fetch options; `localAuth.ts` owner/org/sign-out contracts; `auth.tsx` cache publication; `App.tsx` workspace remount; `sync.ts` and `migrate.ts` explicit snapshot imports; `MyFiles.tsx` download/preview actions; `settings/BackupPanel.tsx`, `DataModePanel.tsx`; installed StorageClient constructor/fetch contracts.
