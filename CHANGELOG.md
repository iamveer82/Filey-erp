## v3.0.26 — 2026-10-14

Filey Link and live updates connect, and support has an email address.

### Fixes
- **Filey Link connects.** The app's security settings blocked the live
  connection that phones, browsers and the computer use to find each other,
  so a phone always said "No computer is open". Pairing and running Filey AI
  on the computer now work.
- **Live updates arrive.** Changes made on another device appear without
  waiting for the next check.
- **No more "The operation is insecure."** The web "Filey Agent (beta)"
  switch pointed at a service that was never switched on, so every reply
  fell back with that note. The switch is gone; phones use Filey AI on your
  computer through Filey Link.

### Support
- The Help Center shows support@gofiley.com.

---

## v3.0.25 — 2026-10-14

Sync now sends only what changed, phones can use Filey AI on your computer,
and older device workspaces can create documents again. 3.0.24 was never
built, so this release also carries everything since 3.0.23.

### Sync
- **Only changes travel.** Each device asks the cloud what changed since its
  last check and downloads just those records. A check with nothing new is
  a few hundred bytes. The 5-minute and 30-minute whole-account checks are
  gone; a complete check runs only for a first copy, after 30+ days away,
  after switching workspace, or weekly as a safety net.
- **Uploads follow the save.** Invoices, payments and other key records
  upload about 15 seconds after saving (never more than 20); other edits
  within 2 minutes.
- **Automatic cloud copy (Pro and Ultra).** Work on this device and keep a
  copy in your Filey account, synced in the background.
- **Cloud mode keeps a copy on the computer.** The desktop app saves cloud
  changes on the device as they happen, so turning cloud storage off continues
  from the latest records almost instantly.

### Filey AI
- **Filey Link.** Pair a phone or browser with your computer once in
  Settings → AI Assistant → Linked devices (the same 6-digit code shows on
  both screens). While the computer is open, Filey AI tasks from the phone
  run on it, with its records and WhatsApp; otherwise they run where you are.
- **Three moving dots** show while Filey AI works, instead of "Working…".
- Filey AI still answers when the Filey Agent can't start a turn.
- MCP drafts reuse saved presets and document numbering.

### Fixes
- Older device workspaces can create documents again (they stopped at
  "Select your workspace before creating a document").
- Cloud invoice saves from the web agent no longer time out: logos are
  shrunk on upload and a dropped save is retried safely.

Update through Filey's normal updater; local data is preserved. Self-hosted
cloud deployments apply `supabase/2026-10-12-agent-core.sql`,
`supabase/2026-10-14-device-link.sql` and
`supabase/2026-10-14-sync-change-feed.sql` after earlier migrations; fresh
schema setup includes them.

---

## v3.0.24 — 2026-10-12

Version alignment release for auto-updater and docs.

- Update package, Cargo, Tauri, and latest.json version metadata to 3.0.24.

---

# Changelog

## v2.4.2 — 2026-08-06

Sign-in and settings fixes. Everything here affects existing installs.

### Signing in
- **Turning sync off signed you out.** Switching storage to "this computer
  only" reloaded straight to the login screen: offline mode keeps its own
  signed-in flag and nothing ever set it while you were in cloud mode, so a
  session that was valid a second earlier was simply gone. The account is now
  carried across the switch.
- **A one-time code now claims the device**, in cloud mode too. Anyone who
  signs in by code and never sets a password had no account attached to their
  device at all, so switching that device to offline stranded them.
- **Sign-in errors that pointed at the wrong problem.** "Invalid login
  credentials" and "Signups not allowed for otp" are what Supabase says when
  *no account uses that email* — read as "wrong password" and "signups are
  off", which sends you hunting for the wrong fault. Both now say what is
  actually wrong, and a device that already knows its account fills the address
  in for you.

### One account, both modes
- **The account email is now the same address online and offline.** The offline
  profile kept its own empty `email`, so Settings showed a blank account
  address on a device that knew perfectly well whose it was.
- **Changing your password now updates this device too.** The stored offline
  hash was the password you typed to re-authenticate, not the new one — so an
  offline sign-in went on demanding the old password and refusing the new.
- **Signing in as a different account re-claims the device** instead of
  renaming the previous owner's credential, which would have handed the new
  account the old one's offline password.
- **Your profile is created once, not once per mode.** Offline kept a separate
  name and company, so setting up in the cloud and later switching to offline
  ran first-run setup a second time and greeted you as "You". The profile now
  travels with the account in both directions — and turning sync on never
  overwrites a real cloud profile, only an untouched signup stub.

### Stamp & signature
- **An expired image link re-signs itself** instead of leaving a broken stamp
  on a customer's invoice.
- **A failed upload now says so.** It used to log to the console and put the
  card back to "Upload" — indistinguishable from never having picked a file,
  so the stamp was quietly never saved.
- **Document-builder uploads store a durable reference.** In the cloud they
  were kept as an inline copy that was never uploaded anywhere.

### Settings
- **Fields that said they saved and didn't.** Every failure was swallowed with
  a note claiming the write had been queued for later; it hadn't — offline, the
  write is refused outright. A failed save now puts the control back and tells
  you why.
- **A logo over 2MB is refused up front.** The card always promised "max 2MB"
  and nothing enforced it, so the whole save failed later with a raw database
  error.
- Desktop bundle version had drifted behind the app version.

### Also arriving with this update
v2.4.0 was built but its release was left as a draft, and v2.4.1 was never
tagged at all — so neither reached a single install. Anyone updating from
v2.3.24 gets all of it at once: the whole v2.4.0 release below, plus three
auth fixes that were sitting on `main` unreleased —

- Changing your account email no longer orphans an offline device: the device
  credential follows the new address instead of being left behind on the old
  one.
- Changing it takes one code, sent to the new address.
- In offline mode, a Supabase rejection falls through to the device's own
  credential rather than locking you out of data that is sitting on your disk.

## v2.4.0 — 2026-08-03

Minor rather than patch: this adds a Marketing module, bulk email, UAE payroll
filing, social publishing and CRM forecasting. Everything below has been sitting
on `main` since v2.3.24 — including two fixes that affect anyone already using
the app.

### Fixes shipping to existing installs
- **Stamp & signature stopped rendering.** Settings persisted the short-lived
  signed URL over the durable storage path; those URLs expire in five minutes,
  so the stamp went permanently blank on the next visit. `data` is now kept as a
  path, `_previewUrl` is dropped on save, and an install that already saved an
  expired URL heals itself by recovering the path back out of it.
- **Fields that wouldn't save, and inputs that lost focus after one keystroke.**
- **A crash now apologises** instead of showing a raw error, with the details
  collapsed behind a toggle.

### Marketing (new module)
- **Lead ranking** from your own books — invoiced value, repeat business,
  recency, reachability and overdue balance, with the reason shown beside every
  score so the ranking is never a black box.
- **Campaigns and bulk email.** Compose with merge fields, pick the audience by
  score, and see exactly who is included *and who was skipped and why* before
  anything sends. An opt-out list gates every send and is re-read at send time;
  the unsubscribe line is appended by the sender, so a campaign cannot go out
  without one; one address is mailed once however many records share it.
- **Stops safely.** When a send halts on the daily cap — or because you are
  offline — recipients stay pending rather than failed and the campaign pauses,
  so Resume continues exactly where it stopped. Nobody retries a failure.
- **Lead enrichment** reads a company's own website for the contact details,
  address and TRN it publishes, and offers back only the fields you are missing.
  **Duplicate detection** across email, TRN and normalised company name.
  **CSV export** of the ranked list.

### Payroll — UAE WPS
- Generate the MOHRE salary file (SIF). IBANs are checked with the mod-97
  algorithm, so a transposed digit is caught here rather than by the bank three
  days later; duplicate labour cards, zero-pay rows and impossible date ranges
  are all refused, with every problem listed at once.
- ⚠️ Column order varies between banks. Confirm one generated file with your
  bank before running a live payroll through it.

### CRM
- **Forecast** — committed, weighted and best case per month, because a single
  pipeline total counts a 10%-probability deal the same as a signed one.
- **Needs attention** — open deals with no next step, no movement, a close date
  already passed, or no value set.
- **Win/loss** — rate over *decided* deals only, average deal size, mean cycle
  length and ranked loss reasons.
- Deals can now hold notes and tasks of their own, which is what makes the
  "no next step" signal mean anything.

### Filey AI
- Reads and searches the public web when the answer isn't in your books, and
  enriches a company from its own site. Off until you switch it on; private and
  non-http addresses are refused before any request; fetched text is treated as
  untrusted quoted material.
- Publishes and schedules to social accounts through Zernio. Posting is gated
  behind the same confirmation as moving money, and captions are checked against
  each platform's limit before sending.
- **Summarise** on the dashboard turns the computed insights into two or three
  plain sentences. On demand, never on load — it spends your own API key.

### Reports
- **VAT 201 boxes 4 and 5** (zero-rated and exempt supplies) now report real net
  turnover. Those lines carry no VAT so they leave no trace in the tax accounts
  every other box is derived from; the figure comes off the invoice lines.
- Fixed the rate caption, which read **"500%"**.

### Tables and people
- Row actions stay reachable on every list — the last column pins itself when a
  table is genuinely too wide, and lists paginate rather than growing forever.
- Employees can be **edited**, not just added.

### Verified
- `tsc --noEmit` clean, `vite build` clean, **456/456** vitest, eslint 0 errors
- Desktop SQLite migration checked against real SQLite (`src-tauri/verify_migration.py`)

### Upgrading
Run these against Supabase before or with the deploy — campaigns and WPS fail at
runtime in cloud mode without them:
`supabase/2026-08-02-campaigns.sql`, `supabase/2026-08-02-wps-payroll-fields.sql`,
`supabase/2026-08-03-company-whatsapp.sql`

---

## v2.2.2 — 2026-07-18

### Fixes
- **Privacy — local mode is now fully offline** (#5): the app no longer fires cloud `org_members` / `profiles` REST requests on launch when running in on-device local mode. Org-membership module restrictions are a team concept and don't apply to single-user local installs. Previously these calls 401'd against the hosted cloud on every start, contradicting local mode's "never leaves the machine" promise.

### Verified
- `tsc --noEmit` clean, `vite build` clean, **208/208** vitest, eslint 0 errors
- Network capture in local mode: **0** outbound requests after the fix (was 4 per launch)

---

## v2.2.0 — 2026-07-17

### Front-end — Filey-DEMO minimal design system
- **DEMO-parity list pages** — search + status filter chips, per-row `RowActions` (quick view, edit, duplicate, send via WhatsApp/email/SMS/copy-link, delete behind confirm) and `QuickViewModal` across Invoicing, Quoting, Orders, Customers, Suppliers, Purchase, Purchase Orders, Inventory, People, Accounting, Bank Accounts, Cheques, Payment Receipts, Declaration Letters, Delivery Challans
- **Dashboard** — real 30-day-vs-prior delta chips on KPIs, CSV export of the KPI snapshot
- **Detail pages** — Customer/Supplier detail rebuilt to the joined-KPI + contact-card + quiet-table pattern with row actions and quick views
- **Settings** — new Appearance section (light/dark + 7-accent picker driving charts), Apps & Modules grid with counts and Enable-all, Backup layout with last-export time, horizontal section tabs
- **New Integrations page** — honest directory: deep-links to real config surfaces, live connection states, "Coming soon" for the rest
- **Public pages** — Landing/Login/Portal token-unified with dark-mode fixes; portal Pay button now shows the VAT-inclusive total
- **Everything else** — Reports/Overview charts on the accent-aware palette, AgentChat restyle, MyFiles search + joined rows, Tools grid, Follow-ups quiet rows with status pills
- `design.md` rewritten for the new system

### Features
- **Recurring follow-ups** — completing a repeating follow-up spawns its next occurrence (daily/weekly/monthly)

### Fixes
- Dead edit flows wired up (Bank Accounts, Cheques, Email Templates)
- Landing demo chart scale, Login brand panel dark mode, mojibake in PDF tools toasts

---

## v0.4.0 — 2026-07-13

### Major Updates
- **E-invoice PINT-AE compliance** — aligned XML with 2025-Q2 UAE spec
- **Emirate code normalization** — auto-remaps legacy AE-xx codes to PINT-AE 3-letter
- **Offline backup & restore** — full local disk file storage with one-click restore
- **Nested folders in My Files** — organize documents in folder hierarchy
- **Apache-2.0 relicensing** — open source friendly license
- **Bank accounts overhaul** — draggable, advances, improved UI
- **Declaration letter improvements** — better formatting and data flow
- **Reports overhaul** — major rework of financial and inventory reports (1700+ lines)
- **Local-mode fixes** — text↔number coercion matching PostgREST behavior

### Removed
- Old licensing system (replaced with simpler model)
- Sync engine (replaced with local-first approach)
- Insights module (integrated into dashboard)
- Tesseract WASM files (moved to cloud processing)
- VYAPAR_ANALYSIS.md (archived)

### Infrastructure
- Stripe function updates for billing
- Supabase schema cleanup
- Test suite restructured

---

## v0.3.0 — Previous release
- CRM credit limits + opening balances
- Receivable/Payable KPI cards
- Round-off + per-line discount %
- Vyapar-parity phase 1: payment terms, dates, words, credit fields
- Low-stock alert fix
