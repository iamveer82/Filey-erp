# Filey workflow and interface audit — 7 October 2026

This pass combines browser interaction, focused code review, regression tests and
disposable-database security checks. It is not a security certification or proof
that every possible workflow is free of defects.

## Repairs

| Area | Failure | Repair |
| --- | --- | --- |
| Team files | A transfer finishing during an account/workspace switch could expose stale bytes or use changing credentials. | Reuse the pinned file transport and verify the session again before exposing a download or publishing attachments. |
| AI chat | Preparing business context could hang indefinitely and delay Stop. | Bound preparation to 12 seconds, honour cancellation immediately and reject late cache writes. Unknown data is explicitly reported as unavailable. |
| AI and connections | Connection/setup state was unclear; built-in connections repeated unrelated utilities and obsolete Telegram instructions. | Add setup/working/approval states and a Connections shortcut; show each integration group in its own tab with accurate status. |
| Invoice, PO and receipt editors | Edits made while a save was pending could be overwritten by its response. | Lock the existing editor during save. |
| Receipt save | A successful insert followed by a failed list refresh lost the saved record identity. | Retain the acknowledged ID before refreshing; report refresh failure separately. |
| Receipt dashboard | Draft receipts inflated money-received cards despite being excluded from reports. | Count only confirmed paid receipts in monetary summaries, preserving draft records and per-currency grouping. |
| Purchase orders | Dashboard totals added different currencies together and labelled them as one currency. | Keep each currency total separate; clear errors after a successful reload. |
| Purchase orders | Unnamed priced lines disappeared when saving, changing the displayed total. | Require a description before saving a priced line. |
| Sales orders | Invalid quantities or missing product links were silently filtered out. | Reject the invalid lines with an actionable validation error. |
| Inventory | Absolute quantity edits calculated adjustments from stale stock and could race. | Route existing-stock counts through the established Stocktake conflict/idempotency workflow. Opening quantities on new products remain editable. |
| Delivery documents | A slow company lookup overwrote newly typed document details. | Merge defaults into the latest form and ignore unmounted responses. |
| Signature tools | Older signature/PDF reads could replace a newer selection or reappear after reset. | Cancel superseded signature reads and invalidate obsolete document loads. |
| Letters | Selecting Inter could render a serif fallback; editor and PDF used different font stacks. | Resolve saved font labels through one self-hosted font map, preserving the stored document schema. |

## Browser coverage

- Production: read-only navigation through all 32 sections enabled in the signed-in workspace at 1280px width. Pages rendered without page-level overflow or route error alerts.
- Isolated local workspace: 35 section routes at 390px width, including Cheques, Bank Accounts and Email Templates. All rendered without page-level horizontal overflow.
- All 11 local Settings panels rendered. The Coin warning correctly requests a connected account in this isolated local environment.
- Mobile letter: typed content, manually changed font size/line spacing, saved, reopened after reload, viewed the paginated preview and exported a one-page A4 PDF. Rechecked the corrected Inter font in the actual editor DOM.
- Invoice: selected a synthetic customer, calculated 6 × 40 plus 5% tax as AED 252, saved a draft and checked its dashboard row. The E-invoice checker identified missing required details and prevented XML export.
- Inventory: navigated from a product's stock entry to Stocktake, adjusted a synthetic count from 40 to 42 and verified the result.
- Receipt: created a synthetic AED 252 draft, verified the editor's busy lock and its saved dashboard record. After the fix, received totals stayed at zero for the draft, then changed to AED 252 once it was marked paid.
- Packing list: saved a standalone synthetic shipment without an invoice reference; 6 units at 20 kg correctly produced 120 kg gross weight in the editor and preview.
- AI: checked the phone-sized dark interface, effort slider, reasoning on/off controls, missing-key setup link and the chat-to-Connections path. No paid model requests were made.
- Real browser tool regressions cover eight conversion, password-removal, recovery, HEIC/WASM and Arabic-output checks.

Only fictional records were written. The local fixture blocks external requests
and does not copy production records, login tokens or credentials. Browser
screenshots and detailed route evidence are retained in ignored
`output/enterprise-audit/` on the audit machine.

## Automated validation

- Full unit/regression suite: 387 files, 3,447 tests passed. The final receipt regression file also passed all 31 checks; the font compatibility repair passed all 12 editor checks.
- TypeScript typecheck passed. ESLint reported zero errors and 615 warnings; the existing warning backlog was not rewritten in this patch.
- Main production and development dependency audits, plus the WhatsApp bridge, worker and MCP production dependency audits, reported zero known vulnerabilities at audit time.
- Disposable PostgreSQL RLS checks passed 63 assertion groups. Static schema/privacy checks passed 33 checks; schema bootstrap verification included 101 historical and 14 current upgrades.
- Worker isolation/cancellation checks passed 12 tests. WhatsApp media validation passed without pairing or sending messages.
- Production build and CI results must be checked on the final pull-request head before publishing; the PR records those release gates.

## Limits and follow-up

- Browser viewport checks do not reproduce the physical iOS keyboard or touch-swipe behaviour. These still need a real-device acceptance pass.
- WhatsApp Business pairing and real delivery are not verified in this pass. The installed desktop update is waiting for the user's Windows administrator approval; pairing also needs the chosen account and test recipient.
- Receipt creation still lacks the durable request acknowledgement mechanism used by the invoice/PO workflow. A completely lost insert response remains an ambiguous outcome; do not automatically retry it as a new payment.
- Live payments, email sending, paid AI calls, hardware scanning and third-party provider credentials were not exercised. Database isolation tests use a disposable PostgreSQL instance, not customer records.
- No database migration, permission expansion or new runtime dependency is required for these repairs.
