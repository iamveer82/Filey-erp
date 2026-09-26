# Storage and design update — September 6, 2026

This update separates storage selection from data transfer and automatic sync. It also repairs account isolation and improves navigation on desktop and phones. Earlier ERP/CRM, authentication, reporting and Resend changes are covered in [the reliability update](reliability-update.md).

## User-facing behavior

| Action | Result |
| --- | --- |
| Open Cloud | Read and save the signed-in account's cloud records. Saves require an internet connection. Cached records can still be viewed offline where available. |
| Open This device | Resume the device's own records and account profile. Local saves work offline. Entering this mode turns automatic sync off. |
| Switch storage | Review the destination, then Filey checks session, ownership and license before changing mode. A failed check leaves the current workspace open. Switching does not upload records or end the session. |
| First local workspace | An explicit checkbox can copy cloud records into an empty device workspace. Existing records are detected across all synced collections, including a workspace containing only CRM tasks. |
| Transfer existing records | Import and upload remain separate, explicit actions with overwrite confirmation, progress and per-table results. Failed transfers no longer say everything is in sync. |
| Enable automatic sync | Opt in separately for the device workspace's account. Newly entered local mode starts with sync off. A one-time manual sync works without enabling background sync. |
| Switch in another browser tab | Older tabs pause and reject data-layer access until reloaded, preventing an old form from saving into newly selected storage. Reloading discards unsaved form fields, which the message explains. |

The header now identifies Cloud or This device and links directly to storage settings. Settings uses a visible section list on desktop and a selector on smaller screens. CRM also has a phone-sized section selector. Settings links and browser history select the requested panel while visited panels retain their form state.

Integration badges distinguish an available built-in capability from an authenticated external connection. Help Center and Documentation have correct header titles. The desktop network policy now permits the Frankfurter v2 origin used by currency conversion and reports.

## Data protection fixes

- Device workspace ownership is separate from the current cloud login. Signing into another cloud account cannot replace the local owner's remembered credential or silently transfer their records.
- Cloud read caches include the user as well as the organization. Users in the shared `default` organization no longer reuse each other's cached business records.
- Profile reads from an earlier account cannot replace the current account's profile after an asynchronous account change.
- Transfers and synchronization check account ownership. A known local organization mismatch blocks transfer to a different cloud organization. Sync also rechecks the session during a transfer.
- Cloud imports page through the entire source and stage table data before replacement. Source failures leave existing records intact; local write failures attempt restoration of replaced collections. Successful imports retire the superseded local journal and are not re-uploaded as legacy local changes.
- Cloud saves now fail visibly when offline instead of returning a success result for an uncommitted operation. Local saves remain available offline.
- Older queued cloud writes without a verified account scope are retained, not replayed into whichever account signs in next. Storage settings shows when queued changes need review. No queue or business records were deleted during this update.

## Verification and practical limits

Final checks: **137 test files / 961 tests passed**, `npm run lint -- --quiet` passed, and `npm run build` passed. `git diff --check` passed. Browser measurements confirmed no page overflow at 319 pixels and both CRM chart containers rendered at 208 pixels high. A scan found no Supabase management token in changed or untracked files.

Automated regression checks cover storage round trips, the actual AuthProvider surviving local → cloud → local without signing out or repeating setup, missing-session rejection, failed-copy preservation, nonempty-destination rejection, account and organization mismatch, cloud cache isolation, offline cloud-save rejection, cross-tab guards, explicit versus automatic sync, and imports beyond the server row cap.

Browser review verified the phone CRM company selector and existing customer records, the 1280-pixel desktop Settings layout, storage review controls, and the actual local-license preflight. This browser has no Freedom license, so its attempted local switch correctly stayed in Cloud with the same signed-in account. A licensed packaged desktop round trip still needs release validation; the automated round trip uses controlled Auth and license fixtures.

The local store remains one device workspace per application data directory. It is not an encrypted multi-account database. Legacy ownership is recovered from the available profile/session metadata; histories without metadata cannot be proven retrospectively.

Local collection replacement uses compensation, not a crash-atomic SQLite transaction across all collections. A process crash, disk failure that also prevents rollback, or concurrent writes from multiple local app processes still needs backup recovery. Background sync retains its existing row-ID and last-writer-wins model; it is not a conflict-resolution system for simultaneous independent device inserts.

## Preparing the later release

The production frontend build is generated in `dist`. This pass does not publish a release, push a commit, change version numbers, generate a signed installer or modify hosted database schemas/functions.

Before cutting the update:

1. Review and commit the combined workspace changes, including the earlier ERP/CRM work and applied SQL migration sources.
2. Choose the next release version and align `package.json`, the root package entry in `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the application entry in `src-tauri/Cargo.lock`. They currently remain at 2.10.2.
3. Run `npm test`, `npm run lint -- --quiet`, and `npm run build` for the release commit.
4. Validate an existing licensed desktop installation: local records and files survive an upgrade, password/OTP sign-in works, local/cloud switching retains the account, and an offline local edit survives restart. Test an explicit sync using disposable records in the same account.
5. Use the existing `.github/workflows/release.yml` workflow. A version tag creates a draft release and builds the supported desktop packages; updater signing requires the configured signing secrets. Review the generated assets before publishing the draft.

Automatic sync now requires an explicit stored opt-in. Users whose previous installations relied on the old implicit-on default should review Storage settings and enable sync if they want it. Their device records and unsent changes remain on the device.
