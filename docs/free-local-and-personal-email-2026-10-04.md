# Free local workspaces and personal email

Local Filey is free for all core ERP/CRM modules, unlimited local documents and
invoices, document editing, local files and backups. Local PDFs do not carry the
Filey plan watermark. Hosted cloud quotas and external provider charges remain
separate. This change does not require a paid licence to open a local workspace.

## Account and device identity

An account is verified online once so the same email and account ID can be used
for a later cloud upgrade. Supabase Auth handles the server password; Filey does
not persist the plaintext password. The device stores a random-salt
PBKDF2-HMAC-SHA256 verifier with a 600,000-iteration work factor, following the
[OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Existing 210,000-iteration verifiers remain readable and upgrade after a
successful password check.

Offline password checks cannot adopt a newly typed email address. Online
responses must establish the account identity; OTP login cannot substitute a
remembered user when the server returned no verified identity. Delayed password
hashing and profile reads are fenced against newer sign-ins and sign-out.

This verifier supports offline identity checks. It does not encrypt the local
database or protect its files from someone with filesystem access.

## Local storage privacy

Local business records, files, company profile changes and communication history
stay on the device. Retained background-sync preferences must not upload them.
Cloud transfer requires an explicit choice to move the workspace to cloud
storage. Local mode does not enable automatic telemetry for business errors.
Local settings also cannot save browser integration keys to Filey's cloud;
native personal-provider connections keep their existing device path.

Account registration/sign-in and optional paid-account reconciliation are
account operations. Previously stored cloud records are not automatically
deleted when a user switches to local mode.

Local AI chats, memories, tasks, journals and generated files also use scoped
device storage. Optional online AI sends the selected messages to the configured
provider for processing. The Filey AI gateway retains credit accounting metadata
such as request IDs and usage amounts, not prompts, replies or document content.
This verifies application behavior; it does not establish the external
provider's or hosting infrastructure's retention policy.

## Personal Resend connection

In local mode, **Settings → Email** accepts the user's own Resend API key, a
verified sender email and an optional sender name. Saving and checking setup
send no email and do not claim to verify provider authentication. Resend checks
the credentials and sender on the real sending request.

- Desktop secrets use the existing account-scoped operating-system credential
  vault. The settings metadata does not include the API key.
- Native Android/iOS use the device HTTP transport. The key is kept in memory
  for the session and must be entered again after reload or sign-out.
- Browser local mode can save connection metadata but cannot send directly;
  the installed app is required for personal Resend sending.
- A personal send uses the fixed `https://api.resend.com/emails` endpoint,
  disables redirects and requires a valid provider receipt before reporting
  success. Transport timeouts have an uncertain outcome: check the Resend
  dashboard before manually trying again.
- There is no automatic retry or fallback to Filey's hosted sender. Personal
  sends do not consume Filey's hosted email quota.
- Message content, recipients and selected attachments go to the user's Resend
  account for delivery. Its provider limits, charges and retention policy apply.
  Filey's local attempt log stays on the device.

Cloud mode retains the hosted sender and its server-enforced quota. The shared
email action covers invoices, quotes, packaging lists, campaigns and agent email
tools without changing their document workflows.

Hosted sends and status checks are bound to the originating account and
organization. Session changes stop retries, stale receipts cannot write another
account's history, and hosted usage counters are scoped by account and workspace.
The server checks provided organization intent before quotas or provider access;
clients predating this optional field remain compatible.

Provider contract: [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email).

## Validation and release status

Focused identity, document rendering, PDF save, local privacy and personal email
tests exercise the real local stores with mocked provider transport. No real
email was sent and no customer key was used. Final test and build results are
recorded in `output/free-local-*` logs. The production build (including the
TypeScript check), route bundle checks, all 2,765 frontend tests across 358 files
and all 216 Edge tests passed. Changed production files have zero lint errors;
the existing 50 type/hook warnings remain.

Final results: `output/free-local-frontend-rerun.log`,
`output/free-local-build-rerun.log`,
`output/free-local-route-bundles-rerun.log`,
`output/free-local-typecheck-final.log`,
`output/free-local-edge-final.log` and
`output/free-local-changed-lint-final.log`.

These changes are local source changes. Version remains 3.0.10. This task does
not publish a website deployment, new desktop installer or updater release.
