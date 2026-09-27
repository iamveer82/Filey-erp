# Mobile navigation and CRM review

Scope: shared desktop/web navigation and the CRM workflow. Production release is
on hold. Existing customer records and services were not used for tests.

| Before | After | Why |
| --- | --- | --- |
| Mobile navigation required reaching the top menu button and looked like a floating popup. | A drawer attached to the left edge, following a rightward edge swipe and a leftward dismiss gesture. The menu button and keyboard controls remain. | Navigation is reachable with one hand. |
| Import, export, custom fields and saving views competed with everyday filters. | Secondary actions share a More actions popover; search, filters and view switching stay visible. | Less scanning before finding a record. |
| Task due dates were hidden in column/view settings. | A due-date filter sits beside status and owner. | Overdue work is one selection away. |
| Empty CRM lists provided instructions without a nearby next step. | Create-record and CSV-import shortcuts accompany the empty state. | New workspaces have a clear starting point. |
| Closing a changed record or pressing Escape discarded edits immediately. | An inline Keep editing / Discard changes choice, plus a browser unload warning while edits are pending. | Accidental closing does not silently lose work. Explicit Cancel still discards edits. |
| Phone toolbar filters and table headings compressed into unreadable fragments. | Filters wrap at a readable width; wide tables scroll horizontally and board columns snap gently on mobile. | Fields and records remain legible on narrow screens. |
| Browser-default checkboxes varied between screens and devices. | Shared rounded checkboxes use the Filey accent, with checked, partial, disabled, keyboard-focus and forced-colour states. | Consistent controls without replacing native form behaviour. |
| Only companies and contacts could store custom fields; values were missing from read-only details. | Every CRM section supports adding, renaming, ordering, requiring and removing custom fields. Saved values appear in record details. Standard table columns remain selectable in View options. | Teams can capture their own information without deleting existing values. |

Reference: [Comp AI CRM](https://github.com/trycompai/crm), particularly its
compact list search and grouped saved-view actions. These improvements use
Filey's existing components and data APIs; no reference application backend,
agent deployment, dependencies or new service credentials were imported.

Verification covers existing saved views, account/workspace isolation, related
record navigation, stage updates, unfinished edits, touch direction/cancellation,
desktop/mobile layouts and reduced-motion styling. Browser fixtures contain only
disposable sample records, with external requests blocked. Chromium touch input
and WebKit layout checks are not a substitute for final physical iPhone testing;
the operating system owns its browser navigation gesture at the extreme edge.

Further review candidates: recovery of drafts after route/history navigation,
optional mobile record cards for very wide tables, and server-paginated CRM
loading for large workspaces. These are separate changes, not claims of completed
work or reasons to introduce another CRM backend.

The CRM custom-field SQL migration is staged for release, not applied to production.
It adds five JSON columns using existing row permissions and sync tracking. Local
storage already supports these record properties. Disposable PostgreSQL checks
verify that the migration is repeatable and preserves values.
