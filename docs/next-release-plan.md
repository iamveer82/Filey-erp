**Filey next release plan — 12 September 2026**

Planning only. This review read the current messaging implementation and existing release notes. It did not send messages, change business records, test live WhatsApp delivery, or verify the current hosted database. Prior release-note gaps below need rechecking before being treated as current production failures.

The next update should make the existing business workflows dependable and finish invoice delivery. Keep local core features free, preserve existing paid-license benefits, and let customers connect their own services. External messaging, hosting, carrier and AI costs must be shown separately from Filey's price.

**What is already present**

| Area | Evidence in the repository | Remaining work |
| --- | --- | --- |
| Invoice sharing | `DocumentMessageDialog.tsx` prepares a PDF, offers native sharing and drafts, and sends the PDF with its caption through the paired desktop WhatsApp connection. | Simplify the choices, verify a packaged installer and record persistent delivery history. |
| Desktop WhatsApp | `waBridge.ts`, the Rust supervisor and `tools/wa-bridge` provide QR pairing, account binding, reconnection and document upload. | Return the provider message ID to the app, persist jobs and consume available status updates. |
| Acceptance handling | `delivery.mjs` requires a WhatsApp message ID before reporting success. | The ID is currently remembered in the sidecar but not returned with the success event. Acceptance is not a delivered/read receipt. |
| Filey AI | Existing `send_invoice_whatsapp` and `prepare_invoice_whatsapp` actions already cover direct sending and draft preparation. | Reuse them with the same outbox and status model as the invoice UI. |
| SMS | `documentMessage.ts` opens an SMS draft with text and an optional link. | There is no automatic carrier-SMS invoice sender in this path. |
| Public links | Cloud invoice links use the hosted app and its Supabase project. Local mode deliberately rejects public-link generation. | Offer explicit publication of one PDF for local users who choose SMS delivery. |
| Hosted channels | The inspected channel-webhook delivery helper sends WhatsApp text. Email already has a Resend workflow. | Add official WhatsApp document/template sending if customers need the provider-backed option; reuse email. |

**What “free sending” can mean**

| Option | Customer receives | Cost boundary | Role in Filey |
| --- | --- | --- | --- |
| Share through the installed WhatsApp app | PDF and message, reviewed in WhatsApp | No messaging API fee; the user's device, connectivity and account are required. | Default fallback. Supported share targets vary by device. |
| Existing QR-paired desktop connection | PDF attachment and caption directly | No purchased API key; uses the existing unofficial Baileys connection. | Optional direct sending for users who accept its support limitations. |
| Android phone and SIM | Ordinary SMS containing an invoice link | Gateway software can be free; SIM charges, allowances, international rates and carrier restrictions still apply. | New local SMS option. |
| Official WhatsApp API / SMS provider | WhatsApp documents or SMS links | The customer supplies credentials and pays any provider charges. | Optional business automation. |

Baileys states that it is unaffiliated with WhatsApp and discourages bulk/automated messaging. Its availability and account compatibility cannot be a Filey guarantee. Keep a manual sharing fallback and describe the connection honestly in Integrations. Do not use a browser-clicking robot as the primary delivery system. [Baileys project disclaimer](https://github.com/WhiskeySockets/Baileys).

Meta publishes WhatsApp Platform pricing by recipient market and message category, with eligible free cases. A token does not make all invoice notifications free. Rates and allowances need checking at implementation and release; this plan does not depend on a permanent free API allowance. [Meta pricing](https://whatsappbusiness.com/products/platform-pricing/).

For SMS, integrate an existing Android gateway instead of building another phone app. SMSGate's local server is free software and exposes an authenticated API on the local network. The phone still needs working cellular SMS service. Its free software removes a gateway subscription, not the carrier bill. [SMSGate pricing](https://docs.sms-gate.app/pricing/), [local setup](https://docs.sms-gate.app/getting-started/local-server/).

Ordinary SMS cannot attach an invoice PDF. Use a secure HTTPS link; do not label it an attachment. The proposed gateway does not send MMS or RCS. A branded SMS sender name also requires a carrier/provider arrangement; a SIM normally sends from its number. [SMSGate capabilities](https://docs.sms-gate.app/faq/general/).

**Build order and completion criteria**

| Order | Work | Complete when |
| --- | --- | --- |
| 1 | Finish one shared invoice-send flow | Customer number, channel, PDF preview and editable message appear together. One primary action describes what actually happens. Pairing and keys stay under Integrations. Native drafts remain clearly unsent. |
| 2 | Harden the current WhatsApp connection | A fresh installer can pair, send a sample PDF, reconnect and upgrade. The app retains the provider message ID. Tests cover cancelled saves, disconnected sessions and account changes. |
| 3 | Add persistent delivery history | Jobs survive restart and distinguish queued, sending, accepted, delivered, read, failed and unknown where the channel supports them. Users can cancel unsent jobs. Reopening a dialog cannot silently duplicate a previous send. |
| 4 | Add optional PDF publication | A local user explicitly shares only the selected PDF snapshot. An unguessable HTTPS link opens on another device, expires and can be revoked. Cloud users retain the existing portal. |
| 5 | Connect Android SMS | Integrations accepts the phone's endpoint and credentials, checks connectivity and selects the SIM. Filey sends the reviewed text/link and records the gateway ID and available delivery report. |
| 6 | Connect Filey AI and CRM activity | Existing AI sending actions create the same reviewed jobs as the UI. The correct invoice/customer activity shows the outcome. A draft, accepted message or delivery failure never changes payment status. |
| 7 | Add optional official providers | Start with direct Meta document sending, required templates and status webhooks. Add a carrier SMS provider when a customer needs it. Store credentials securely, show provider costs and require explicit selection before any paid fallback. |
| 8 | Close release blockers and package | Pass the native, cloud and workflow checks below with disposable data, then produce the installer and release notes. |

Steps 4 and 5 are both required for automatic SMS delivery of local invoices. A localhost URL cannot be opened by a customer. Public PDF hosting consumes storage and bandwidth: use the existing storage stack with an explicit small quota or customer-owned hosting. Set the quota after measuring PDF sizes and provider costs. Free hosting tiers are bounded, and perpetual free hosting for every Filey customer is not assumed.

Use the existing persistence and PDF renderer. Store a frozen document snapshot, recipient, workspace, channel, attempt ID and provider message ID with each job. Separate message status from invoice accounting status. A user-requested resend is a new recorded attempt. If a timeout leaves acceptance uncertain, show “Check delivery” and reconcile when possible instead of automatically sending another copy. Retry only failures known to have occurred before acceptance, unless the provider supports reliable deduplication.

The local scheduler runs while Filey is open; SMS also requires the connected phone. Show pending jobs clearly after restart. Always-on delivery requires a running device or an optional hosted worker. Keep access bound to the active account and organization, pause on sign-out, and require an explicit choice about pending work when switching stores.

For the first SMS version, call the phone from the desktop backend and poll status only for outstanding messages. Reuse existing secure credential storage. Local mode must stay on a trusted network; Basic Authentication over plain HTTP is not encryption. A protected connection is required for remote use. Do not expose the phone gateway through a public unauthenticated port. [Gateway local authentication](https://docs.sms-gate.app/getting-started/local-server/).

Include an SMS segment estimate, because longer or non-Latin messages may occupy multiple billable messages. Report delivery only when supported, and never invent an SMS read receipt. [Messaging segments and status semantics](https://www.twilio.com/docs/messaging/api/message-resource).

**The rest of the next-update work**

| Area | Priority work |
| --- | --- |
| Local/cloud identity and records | Recheck sign-in persistence, account/organization binding, explicit transfers and conflict handling. Keep stores visibly distinct and prevent silent overwrites. |
| Cloud backend | Recheck whether the pending work-items and international-business migrations recorded in `platform-readiness.md` were subsequently deployed. Verify actual row-level isolation and frontend saves before advertising cloud readiness. |
| Authentication and recovery | Exercise password typing, sign-in, Resend recovery, expired links, desktop return links and offline remembered access. |
| Connected sales and CRM | Verify lead → contact/company → deal → quote → invoice → payment. Add duplicate detection/merge and usable owner/task workflows where missing. Preserve customer references through conversion. |
| Purchasing and inventory | Verify purchase order → receiving → stock → supplier payment, including cancellation, returns and reporting effects. Prioritize correctness before additional warehouse features. |
| Reporting | Keep overview charts connected to actual records and detailed insights in Reports. Check date filters, currencies and empty/error states. |
| Filey AI | Show the proposed actions, progress, results and recoverable failures. Reuse existing permissions and tools; strengthen evaluation on invoice, stock and CRM tasks. Keep local-model and user-key choices. |
| Consistent interface | Check each editor, dialog, tool upload and settings tab against shared pill buttons, spacing, accents and terminology. Finish the Tools changes already in the working tree. |
| Regional behavior | Test country settings, document currency, tax labels, dates, phone codes and language layouts. The recorded AED-ledger limitation and statutory accounting/payroll gaps require separate work; country labels alone do not establish compliance. |
| Installation and data protection | Fresh install, upgrade, offline restart, backup/restore with PDFs, signed packaging, rollback and helpful setup documentation. |

Deeper accounting localization, multi-warehouse reservations, subscription billing, territory rules, custom CRM objects, local team hosting, manufacturing and POS belong in later releases with their own acceptance criteria. They are not prerequisites for a reliable invoice-delivery update. The current broader gap inventory remains in `platform-readiness.md`.

**Release evidence required**

- Use a disposable workspace and an explicitly chosen test recipient. No customer records or unsolicited customer messages are needed for QA.
- Open the received WhatsApp PDF and confirm its invoice, customer, currency and selected template.
- Open the SMS link on a separate phone while Filey is closed; verify expiry and revocation.
- Interrupt connectivity during sending, restart the app and prove there is no silent duplicate or false delivered state.
- Switch local/cloud mode and accounts while a send is pending; prove no document or credentials cross workspaces.
- Validate the installed bridge and phone permissions on actual devices. Browser tests alone do not prove native delivery.
- Verify the full sales/purchase workflows and a restore drill, with test results recorded separately from implementation claims.

Recommended first milestone: the existing WhatsApp PDF flow with reliable history, followed by secure local invoice links and Android SMS. No new shared API keys are required for those device-based options.
