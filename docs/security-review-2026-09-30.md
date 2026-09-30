# Security rollout — 30 September 2026

Confirmed fixes:

- Prevent service-role tool downloads from escaping the job owner's storage folder.
- Check current workspace membership and owner/admin authority before hosted agent and billing operations.
- Require verified-factor MFA at the database, Storage, RPC and authenticated edge-function boundaries. Keep authenticated offline device access separate.
- Remove table grants that overrode billing-column restrictions; only the actual owner can delete a workspace.
- Fulfil only paid Stripe checkouts, with service-only atomic receipts preventing concurrent duplicate invoice payments.
- Convert invoice charges and settlement amounts using Stripe's currency units; reject balances that cannot be represented in the current ledger before checkout.
- Bind pending file operations, sign-in checks and tool approvals to the original account/workspace and current permissions.
- Reject unsafe OAuth URLs and WhatsApp media hosts/redirects; restrict native outgoing attachments to managed UUID output folders.
- Update affected npm and compatible Rust dependencies. Keep Node worker tests separate from Vitest.

Validation includes frontend regression tests, 123 Deno edge tests, 11 checked
function entrypoints, disposable PostgreSQL permission/concurrency tests, 22 Rust
unit tests, bridge media/delivery tests, web/mobile builds and dependency audits.
Production verification must check applied grants/policies and function deployment
versions before merging the web rollout.

Limits: live WhatsApp pairing/delivery, a packaged desktop sidecar and physical
iPhone testing are not covered by these unit checks. Existing historical payment
duplicates are not modified. Hosted channels retain their configured single-owner
model. The follow-up web batch replaces hosted document draft creation with
an atomic, service-only RPC; apply its migration before deploying the function.
Linux GTK's upstream glib 0.18
advisory requires an upstream-compatible dependency upgrade and does not affect
the Windows or browser build. This review is not a guarantee against undiscovered
vulnerabilities.
