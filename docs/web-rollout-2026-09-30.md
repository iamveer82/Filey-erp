# Complete morning web batch

The first web rollout included the security fixes and avatar choices, but omitted
the uncommitted application refinements from the original workspace. This batch
merges those refinements on top of the deployed security commit, preserving its
MFA enforcement, billing permissions, paid-checkout integrity and storage guards.

Included changes:

- Neutral light/dark controls, cards, chat composer and chronological Teams bubbles.
- Conversation-specific drafts and attachments, retry recovery, stable chat
  scrolling, mobile multiline entry and unread-message boundaries.
- Invoice actions beside Save/PDF; a primary UAE e-invoice review, required
  identity/tax fields, supported XML export, credit-note protections and import checks.
- Minimal SVG tool covers, clearer password-unlock and download workflow,
  cancellation/resource cleanup, empty-output rejection and searchable tool handoff.
- Durable email-template saves, workspace/thread response guards, reachable browser
  navigation and updated business/file-tool guides.

Already-live mobile A4 preview fitting, country-aware bank placement, shadcn date
editing, searchable font selectors and responsive metrics remain intact. The merge
removes duplicate bank props and keeps bank details below notes across templates.

Apply `supabase/2026-09-29-einvoice-identity.sql` and
`supabase/2026-09-30-channel-agent-drafts.sql` before deploying the matching
channel function and web build. Both are additive and tested against synthetic
PostgreSQL records; do not rewrite existing customer data.

Desktop WhatsApp/Telegram runtime improvements are included in source but require
a later desktop build. This web rollout does not publish installers or an updater
tag. Provider delivery and physical iPhone/Safari behavior need separate device
checks. Local e-invoice checks/XML export do not certify tax compliance or submit
documents to an accredited provider.
