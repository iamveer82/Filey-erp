# Filey CRM workspace

See [the sales and follow-up update](crm-sales-update.md) for Today, linked quotations/invoices, contextual AI, PDF sharing, duplicate review, bulk edits and custom fields, including the cloud migration prerequisite.

The `/crm` route has a new workspace built around companies, contacts, leads, deals, tasks, notes, activity, and reports. Connections live in the separate Integrations section. Existing business records remain in their original tables, so customer-linked invoices and quotations retain their relationships.

## September 12 interface update

The workspace now uses horizontal section navigation, compact record lists with avatars, live contact/open-deal counts, and a pipeline board with stage totals and dates. Buttons use Filey's shared pill shapes and appearance tokens. Reports remain in Filey's central Reports section.

Records open in a responsive side drawer with properties, related records, tasks, notes and recent activity. Opening a related record keeps a Back path. The `record` URL parameter restores this path after reload; it accepts only known record types and positive safe integer IDs and resolves them against the current workspace's loaded data. An unavailable record shows an explicit message. New unsaved forms stay in memory. Save failures preserve their fields, and failed workspace refreshes block record mutations until a successful refresh.

Lead conversion uses the existing local/cloud implementation and opens the resulting deal. **Ask Filey AI** opens Filey's existing assistant with an editable record-context prompt. It does not run the prompt or send a message automatically. CRM core workflows need no additional API key; configured AI and messaging providers retain their own setup and costs.

The drawer composition and URL stack were adapted from the MIT-licensed [requested Comp AI CRM fork](https://github.com/omkshirsagar2914-pixel/trycompai-crm), revision `c6d6b7a9b61a3e19600fe1e2877098f6639e64df`. See [the retained MIT notice](../licenses/comp-ai-crm.txt) and `NOTICE`. This adaptation reuses Filey's existing database, authentication and agent. It does not embed Comp AI's Next.js/Nest/Prisma backend, Eve agent, or promise feature parity. No database migration is required for this interface update.

Verification covers URL navigation, linked-record workflows, conversion, saved-view isolation, relationship counts, duplicate-write protection and failure recovery. Tests use isolated storage with network access blocked. Browser checks inspect existing local QA records and cancel forms without modifying them. Production cloud writes, live AI providers and a packaged native installer require separate release verification.

```sh
npm test -- src/components/crm src/components/__tests__/crm-record-editor.test.tsx src/components/__tests__/crm-record-panel.test.tsx src/lib/__tests__/crmWorkspace.test.ts src/lib/__tests__/agent-crm-tools.test.ts src/lib/crmLinks.test.ts
npm run build
```

## Everyday workflows

- Create or import records in each section; open a record to edit it, add linked tasks/notes/activities, or inspect its relationships. Company and contact details can create a deal with their relationship already selected. Related companies, contacts and task/note targets open directly from record details.
- Convert a lead into a linked company, primary contact, and opportunity. Repeating a cloud conversion returns the original deal; the database transaction rolls back if any step fails.
- Switch deals or tasks between a sortable table and a board. Drag cards or use the accessible stage/status selector. Moving a card patches its status fields without overwriting a title, owner or amount edited by another user. Deal stage changes set the default probability; the editor accepts a custom probability afterward.
- Filter by text, status/category, and owner. Search includes linked company/contact/record names. Save named filters on the current device. Export the filtered records to CSV. Optional unlinked relationships export as empty cells. Imports validate every row before a single batch insert, with a 500-row batch limit; checkbox values accept `true` and `false` (case-insensitive). CSV imports create records and do not replace a full workspace backup.
- The import dialog locks its file, mapping and close controls during a write. Failed file reads and native CSV saves surface an error; choosing a newer CSV ignores an older pending read. Cancelling a native save dialog is not an error.
- Assign and date tasks; export the visible dated open tasks as all-day calendar events. Completed and cancelled tasks are excluded. Calendar imports are snapshots, with no automatic two-way sync.
- CRM overview keeps pipeline value, weighted value, win rate, open tasks, next steps and recent activity. Its Reports shortcut opens the central Reports section for CRM charts. Won deals represent sales value, not received cash.
- Record detail notes and tasks load only the selected record's context, paginate cloud reads, and refresh on local writes or cloud updates. A read error shows Retry instead of claiming there are no records. Changing records clears the previous draft and discards late responses. Pending writes cannot be submitted twice; failures preserve the draft. Completed and cancelled tasks are both closed, with an explicit reopen action.

## Storage and permissions

The workspace uses Filey's existing local or Supabase data mode and existing row-level access policies. Cloud reads paginate beyond PostgREST's default row cap. Writes must be acknowledged: missing or inaccessible records return an error. Cloud mutations require connectivity; local mode works on the device.

Deleting a company/contact/deal/lead in the new workspace first checks loaded CRM relationships and asks the user to reassign linked records. Existing database foreign keys continue to apply. These UI checks are advisory for simultaneous clients; they are not a replacement for database integrity constraints.

Local lead conversion compensates failed writes and coalesces concurrent requests in the current app instance. Its JSON collection storage does not provide crash-atomic transactions across collections. Cloud conversion uses a row lock and one database transaction.

## Free connections

Open **Integrations → Built-in connections** for these tools and the authenticated Resend configuration check. Provider setup and the app directory have separate tabs. See [the reliability update](reliability-update.md) for current setup requirements and verification limits.

- **Frankfurter v2:** public daily currency reference data, no API key, free commercial use subject to underlying provider terms and abuse rate limits. The converter requests only a currency pair and calculates the entered amount locally. The shared Filey rate loader also uses v2, which includes AED; the previous ECB-only endpoint omitted AED and selected fallback approximations. Source: https://frankfurter.dev/
- **WhatsApp:** record actions open click-to-chat for an international phone number. The user sends the message. Automated WhatsApp Business API messages have separate provider pricing. Source: https://faq.whatsapp.com/5913398998672934
- **Telegram:** contact usernames open direct conversations. Hosted Filey AI bots require separate administrator configuration and a bot token; they are not automatically activated by this CRM upgrade. Source: https://core.telegram.org/bots/faq
- **Email, phone, calendar:** native mail/telephone links and ICS export require no CRM API subscription. Provider charges and hosting/AI costs are separate from free core CRM features.

## Charts across Filey

Section Insights live in **Reports → Insights**. Their loaders use actual workspace records for category counts and dated trends, with accessible data tables and CSV export. Operational pages keep their own working lists/forms instead of repeating an Insights panel in every section. The main Overview contains connected financial charts. CRM overview keeps operational counts and next steps; its forecast chart has been removed from that screen.

Count charts do not combine amounts from different currencies. Missing/invalid dates are excluded from time trends and disclosed. Empty data is shown as empty; no sample values are injected into the application.

## Database upgrade and verification

For an existing installation with `2026-07-26-crm-objects.sql`, apply `supabase/2026-09-06-crm-workspace.sql`. It adds Telegram usernames, lead conversion links, supporting indexes, and an authenticated, security-invoker conversion function. The migration is additive and can be rerun.

The migration was applied to the Filey Supabase project on September 6, 2026. The access token was used only for authenticated requests and is not part of the repository.

Run `supabase/tests/crm-workspace.sql` as the database owner to verify linked conversion, repeated calls, missing-record rejection, and denial of anonymous execution. It uses an existing organization owner's identity inside a transaction and rolls all test rows back.

Local checks:

```sh
npm test -- src/lib/__tests__/crmWorkspace.test.ts src/lib/__tests__/csv-download.test.ts src/components/__tests__/crm-record-panel.test.tsx src/components/__tests__/crm-record-editor.test.tsx src/components/__tests__/import-csv-modal.test.tsx
npm run typecheck
```

These checks exercise real local CRUD/conversion/relationship behavior, stale-card updates, CSV round-trips, scoped record context, later-page cloud read failures (mocked), live refresh and response races, native date capture, duplicate-write protection, editor cancellation, import file races and export errors. Test fixtures remain in isolated test storage; the tests cannot contact the network. These source changes do not publish a new desktop installer or apply another cloud migration.

Browser verification used an isolated local component harness: lead creation/conversion, stage changes and probabilities, linked tasks and notes, native date persistence, calendar download, the live currency API, and phone-width layout. Test records were not inserted into the production CRM.
