# Invoice messaging

Implemented 6 September 2026. Open Invoicing → a row's Send → WhatsApp or SMS. In the editor, WhatsApp and Messages save the invoice before opening the review dialog. Email remains the existing Resend workflow.

## Send with Filey AI — 12 September 2026

The invoice sharing dialog now offers **Send with Filey AI** in the installed Windows app. Review the recipient and message, then click this button once. Its disclosure authorizes a computer session limited to the newly opened Filey Browser WhatsApp window and its owned file picker, for at most five minutes. Computer use and Messaging must be enabled in AI Access; Plan mode remains read-only. The separate QR bridge is not required for this option.

The task saves the existing invoice PDF, opens the requested WhatsApp chat, reads the recipient's full international number, attaches the saved PDF through the file picker, inserts the exact reviewed caption, verifies the preview, clicks Send once and checks the outgoing document bubble. It verifies the full file path before opening the attachment and the filename/caption before sending. Multiline captions use Shift+Enter rather than bare Enter. No invoice or payment status is changed by this UI task.

The existing configured vision model chooses the next observed action. Filey supplies fixed text for the path and caption; the model cannot choose other files, recipients, arbitrary typed text, URLs, browser windows or ERP tools. Screenshots are transient model input, not saved to chat history. A local vision model avoids hosted inference charges; a user-selected hosted model has that provider's costs. Computer control itself needs no API key. Screenshot interpretation and WhatsApp's changing interface can still require user intervention.

Use **Stop** to cancel. Account/workspace changes, grant replacement, expiry, unsupported model output, mismatched observations and unexpected navigation stop the task. Login, QR scanning, CAPTCHA and platform permission prompts remain with the user. WhatsApp's browser login is separate from QR-bridge pairing. After login, the user can choose Send with Filey AI again; no Send click is issued at the login screen.

Once Send is attempted, only observation is permitted. A missing acknowledgment or ambiguous result is shown as unconfirmed and never retried or routed through the paired bridge automatically. The dialog disables another automatic send to that recipient while it remains open. This is per-dialog protection, not a persistent outbox across app restarts. An observed sent bubble is not an independent delivery receipt.

The localhost/web preview shows the feature and its desktop requirement; it cannot control Windows. Validation passed: production build, changed-file lint, 45 focused JavaScript tests and the native computer-session unit test. Automated checks use synthetic PDFs and mocked vision/native responses. They do not prove live WhatsApp compatibility or customer delivery. A real installed-app acceptance test with a user-selected test recipient remains required before release.

## Available without a new API key

| Option | What happens | Requirement |
| --- | --- | --- |
| Send with Filey AI | Uses the visible WhatsApp window to verify the recipient, attach the PDF, enter the reviewed caption and attempt Send once. | Installed Windows app, WhatsApp browser login, and a configured vision-capable local model or provider. |
| Prepare WhatsApp + PDF | Saves the original invoice PDF and opens the reviewed recipient and exact message as an **unsent** draft. Shows the saved file path. | On Windows desktop, opens WhatsApp Web in Filey's browser; elsewhere uses the installed handler or browser. Attach the PDF and review before sending. |
| Open WhatsApp text draft | Opens a recipient-specific draft containing the reviewed message and optional public link. | WhatsApp; this action does not save or attach a PDF. |
| Share PDF | Opens the device share sheet with the prepared PDF and message. Choose an app and recipient there. | Browser/device support for file sharing and a compatible target app. |
| Download PDF | Saves the invoice for attachment in WhatsApp, Telegram, Messages or another app. | No messaging account required to download. |
| Send PDF via paired WhatsApp | Saves the PDF locally, uploads it as one document with the reviewed caption, and waits for WhatsApp's message acceptance. | Desktop app with WhatsApp paired for the current Filey account in Integrations. |
| Open SMS draft | Opens the device's SMS handler with recipient, message and optional link. | An installed SMS handler and mobile service. Carrier charges may apply; SMS does not attach PDFs. |

No public API keys were obtained or embedded. Native sharing and click-to-chat do not need a new provider account. Automatic WhatsApp sending uses either the visible computer workflow or the existing QR bridge; neither uses the official WhatsApp Business Cloud API. Automated provider SMS delivery is not included.

The dialog prioritizes paired PDF sending, native Share PDF, or Prepare WhatsApp + PDF. The separate text-draft action never attaches a file. When pairing is unavailable, the handoff shows the actual saved path and Attach → Document steps. A blocked popup or browser-open failure is reported as a failure to open; a saved PDF remains available. No handoff changes the invoice status.

## One-step Filey AI sending

In the installed desktop app, pair WhatsApp once from Integrations → WhatsApp
(QR). The bridge starts automatically with the app. Then ask Filey AI to “send
invoice INV-001 to the customer on WhatsApp”. The `send_invoice_whatsapp` action
finds the invoice and the matching CRM phone, renders the current invoice
template, saves the PDF in the configured export folder (or Desktop), and sends one WhatsApp
document with the AI-written caption. A number supplied in the request overrides
the CRM number. The action marks an unpaid invoice sent only after WhatsApp
accepts the document (a paid invoice stays paid) and keeps the
existing approval prompt for outbound sends.

WhatsApp still requires the normal QR pairing step; an installed app cannot
silently take over a phone account. The bridge waits for a WhatsApp message ID
before reporting acceptance. This is not a delivered/read receipt; check WhatsApp
for the final state. An uncertain timeout is not retried automatically because
the provider may have accepted the first upload.

The recipient must include the international country code. Filey prepares the PDF before enabling file actions so native sharing can run directly from the user's click. Cancelled shares are not reported as sent. The dialog prevents repeating an accepted PDF send to the same normalized recipient while it remains open, including after changing number formatting.

### Filey AI browser handoff

`prepare_invoice_whatsapp` prepares the PDF and opens the draft through the same
`prepareWhatsAppDocument` helper as the invoice dialog. Its result explicitly
contains `status: "draft"`, `sent: false`, `attachmentRequired: true`, the original
filename, saved path, normalized recipient and exact message. On Windows it also
returns the Filey browser tab/window identifiers. The browser's WhatsApp login is
separate from the QR bridge pairing; the user signs in normally when needed.

Opening the draft does not attach the PDF. The user can select Attach → Document
and choose the saved path, or explicitly authorize Filey AI's computer access to
operate the visible file picker. The agent must inspect the recipient, attached
filename and caption before any separately authorized final Send. Never infer a
successful send merely because the draft opened or a file was selected.

PDF preparation, saving, browser opening and paired sending are guarded by the
captured account, organization and storage mode. Switching workspace invalidates
the open dialog and stops later steps. Invalid recipients, non-PDF exports,
cancelled saves and cancelled runs never continue into a browser handoff. A failed
replacement export clears the previous PDF so it cannot be attached accidentally.

## Public invoice links

Set `VITE_PUBLIC_APP_URL` at build time when the sender uses desktop or localhost. It must be the publicly reachable HTTPS Filey app, including any subdirectory, using the **same Supabase project** as the sender. This is an address, not a secret. Hosted web builds can use their current public HTTPS origin/path without this variable.

Local mode always uses PDF sharing. Device-only addresses, IP addresses, non-HTTPS URLs and URLs containing credentials are rejected before creating a share token. Domain validation cannot prove that a deployment is reachable: the operator must check the configured public app in a signed-out browser before release.

Adding a link explicitly enables public access to the invoice; anyone holding the link can view it. The dialog displays this before creating the link. Invoice list, editor, email reminders and Filey AI invoice links use the same address guard, avoiding links that point to the sender's localhost.

## Verification and release checks

Automated checks cover international number validation, URL encoding, iOS/other SMS formats, local/cloud link guards, valid PDF bytes, exact draft/filename handoff, cancelled saves, blocked browser opening, cross-workspace cancellation, replacement-export failures, reconnect checks, native-share cancellation and provider-acceptance behavior. No customer messages are sent by these tests.

Document workflow tests mock the filesystem, browser, share sheet and WhatsApp transport. They verify ordering and safeguards without writing real exports, opening WhatsApp sessions or sending customer messages. They do not establish live provider delivery or compatibility with every installed messaging application.

Before shipping a desktop installer, verify a paired WhatsApp PDF send and delivery to a test recipient, the operating system's SMS handler, and the added `sms:*` opener permission. Check native file sharing on the intended Android/iOS devices. These device-dependent delivery checks have not been performed in the browser preview.

References: [WhatsApp click to chat](https://faq.whatsapp.com/5913398998672934/) documents recipient and prefilled text; it has no PDF-attachment parameter. The official API models a document separately with a media ID or hosted link ([Meta document media reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/types/DocumentMediaObject/)). [Native share API and file support](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).
