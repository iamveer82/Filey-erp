# Filey remote agent and artwork validation

This batch changes local source only. It does not deploy, publish an update,
apply a production migration, connect a real phone/bot, send customer messages,
or change customer records. Version remains 1.0.30.

## Changes

- WhatsApp and the new desktop Telegram gateway share Filey's existing tool
  runner, context, memories and skills. Account/channel/conversation histories
  and one-use approvals stay separated. Approval proposals become actionable
  only after a confirmed final reply.
- Telegram has a dedicated OS-vault token, fresh private pairing, bot identity
  fencing, a single-window lock acquired before consuming provider updates,
  bounded input/output, typing pulses, queue/Stop controls and file replies.
  Existing webhooks are refused rather than taken over.
- WhatsApp acknowledges and types before asynchronous media downloads. Downloads,
  voice turns and queued work follow cancellation/session changes; supported
  video attachments reach the same tool runner.
- Provider tool-call IDs and arguments are checked before execution. Nested
  duplicate writes, partial file failures, empty outputs and failed shell exit
  codes no longer become successful results. Permission/access mode changes
  during approval are rechecked. Scope/Stop checks guard subsequent mutations
  in multi-step record tools.
- Remote browsers use only the optional isolated agent computer. They cannot
  fall back to the owner's personal browser or start a native computer grant.
- Hosted drafts use an atomic transaction with role/workspace assertions.
  Replay storage and credential lookup errors fail closed. Approvals bind their
  source conversation; claiming also scrubs parked credentials. Status-only
  hosted “mark paid” was removed.
- Profile characters use the ten actual Blobatar generation-2 silhouettes and
  palette behind BlobatarSwift. Existing saved avatar URLs and uploaded photos
  are retained. They have subtle motion and static reduced-motion styling.
  All tools use one original,
  theme-aware SVG cover component.

## Checks

| Check | Evidence |
| --- | --- |
| Final full frontend run | 2,091 tests passed across 309 files |
| Final Telegram and shell regressions | 17 passed across 2 files |
| Hosted functions, shared helpers and lead handler, network denied | 110 passed |
| Native Windows library | 21 passed |
| Hosted SQL authorization/atomic rollback | Disposable PostgreSQL 18 test passed |
| Final production build and typecheck | Passed |
| Production dependency audit | Zero reported vulnerabilities |
| Whole repository ESLint | Zero errors, 537 warnings |
| Final touched gateway/shell lint | Zero errors, one existing explicit-any warning |
| UI inspection | Light/dark SVG loading, avatar selection and 390-pixel mobile fit verified |

One preliminary full run mixed a changed concurrency test with its earlier
imported gateway source. The new lock regression passed in the focused rerun;
the final full run uses frozen source. Vendored PINT files retain upstream
whitespace; the touched app/agent diff whitespace check passes.

Focused harness checks also covered provider loops, exact approvals, records,
file/media operations, role changes and browser isolation (205 checks), with
57 final shell/record/runtime/guard checks. Gateway lifecycle and transport
checks passed 143 cases. Counts overlap the full frontend suite.

Logs and screenshots are in ignored `output/`, including
`agent-hardening-build.log`, `agent-hardening-edge.log`,
`agent-hardening-desktop.log`, `agent-hardening-final-regressions.log`,
`avatars-tools-light.png`, `avatars-tools-dark.png` and
`avatars-tools-mobile.png`.

## Blobatar profile artwork correction

The ten presets now use the pinned upstream generation-2 SVG renderer behind
BlobatarSwift, with its original geometry, palette and two-eye faces. Existing
eight avatar URLs and uploaded profile photos remain supported; Sunburst and
Triangle are new choices. Each shipped SVG carries the upstream MIT notice.
The generator and reference revisions are documented in
`scripts/generate-profile-avatars.mjs`; no runtime dependency was added.

All seven asset/profile/team checks and the production build pass. Touched
frontend lint has no errors. Browser inspection confirmed all ten assets load,
selection updates the preview, and the picker fits at a 390 px mobile viewport
in light mode; the desktop dark mode was also checked. Screenshots are
`output/blobatar-profile-avatars-light.png`,
`output/blobatar-profile-avatars-dark.png` and
`output/blobatar-profile-avatars-mobile.png`. This correction is local only.

## Release and operational limits

Profile customization now separates ten shapes and ten colours (100 locally
bundled SVG combinations). Changing one choice preserves the other; old
presets and uploaded photos remain unchanged until the user saves a new choice.
All 12 focused asset/picker/profile/team checks pass, alongside typecheck and
production build. The disposable PostgreSQL suite verifies all 100 new URLs,
ten legacy URLs, invalid-path rejection, self/admin access and repeatability.
Apply `supabase/2026-09-30-avatar-choices.sql` before releasing the new team
picker. No runtime graphics dependency or edge update is required.
Desktop/mobile light and dark previews were inspected locally; screenshots are
`output/avatar-choices-dark.png` and `output/avatar-choices-mobile.png`.
Publishing is postponed at the user's request; the selected next desktop
release version is 3.0.10 so existing 3.0.x installations can auto-update.

The new hosted draft migration is
`supabase/2026-09-30-channel-agent-drafts.sql`; apply it before the corresponding
function deployment. See [hosted validation](2026-09-30-hosted-agent-hardening.md)
and [remote gateway workflow](../ai/remote-agent-gateway.md).

Desktop gateways require Filey to remain open. Telegram supports text, photos
and documents up to 12 MiB; it does not handle voice yet. Already accepted
native/provider actions can finish after Stop. Provider acceptance is not a
read receipt. At-most-once input claims prevent replayed writes but do not
provide a durable job queue or guaranteed recovery after a crash.

The hosted relay still serves one configured owner and its smaller cloud
toolset. It does not provide every customer's desktop tools from a hosted
worker. Live WhatsApp/Telegram/Slack delivery, paid media/checkout, production
migration and a physical iPhone were not exercised. Manual paired-owner,
stranger, typing, PDF, approval and Stop tests with the installed candidate are
required before claiming end-to-end channel delivery works.
