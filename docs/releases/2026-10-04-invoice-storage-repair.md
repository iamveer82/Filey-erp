# Invoice save storage repair

Invoice saves kept entire document JSON, including embedded letterhead images, in durable retry identities. Browser storage could fill even when the workspace had unlimited invoice access. A storage failure was then presented to the agent as a generic quota error, and recovery instructions encouraged trying another document type.

Retry identities now use bounded SHA-256 fingerprints. Existing pending actions and local receipts retain their original request identities and reviewed payloads when converted. A lost acknowledgement must still recover its original receipt; it must never create a second invoice, payment or stock adjustment.

Browser quota recovery moves Filey's managed record storage into on-device IndexedDB atomically. It preserves existing records, pending requests, files and transaction comparisons without uploading local data. The original device-books owner is retained and restored before sign-in so another account cannot adopt retained books after browser preferences are cleared. Cloud workflow caches continue to use their separate account and workspace scope. Unrelated preferences, chat settings and authentication storage remain in place. A failed migration preserves the original records.

The agent distinguishes browser storage failures from explicit subscription limits. After an invoice failure it cannot create an unrequested quotation, sales order, purchase order or supplier invoice as a substitute or diagnostic write. Read-only diagnosis and a corrected invoice request remain available.

This release changes the shared web frontend only. It does not alter invoice plan allowances, grant AI Coin, publish desktop installers or modify customer documents during verification.

Validation: the full frontend suite passed 2,940 tests across 365 files. Final storage and ownership regressions passed 33 tests across five files, and invoice/agent recovery regressions, typecheck, focused lint and the production build passed. An isolated real-browser check preserved 29 generated invoices and a 6 MB save through quota recovery and a full reload. Independent reviews covered retry identity, transaction rollback, cross-tab locking and account isolation.
