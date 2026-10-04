# Native, bridge, MCP and mobile wrapper audit — 2026-10-04

This pass manually read 82 source/configuration/documentation files, 9,682 lines
at the recorded snapshot. The exact paths and reviewed ranges are in
`output/native-audit-reviewed-2026-10-04.json`. The bridge lockfile and generated
iOS web asset manifest were inventoried but excluded from manual source counts.
Counts include tests and wrapper build configuration; they are not a claim that
every possible execution path has been exercised or every defect eliminated.

## Confirmed defects repaired

- Native file reads, writes, deletes, workspace validation and backups could
  traverse an existing junction/symlink inside the configured files directory.
  Directory/root checks now reject linked paths and verify canonical containment.
  Document exports use the existing atomic write implementation.
- Native shell commands retained unlimited stdout/stderr until process exit.
  Both streams now keep at most 1 MiB each while continuously draining their
  pipes, preserving exit/timeout handling without deadlocking noisy children.
- Windows shortcut generation embedded paths directly inside PowerShell single
  quotes. An apostrophe broke the command or became executable syntax. All paths
  now use escaped PowerShell literals; the helper process is hidden.
- MCP local collection corruption previously became an empty collection, allowing
  a later insert to overwrite damaged data. Invalid collection/journal data now
  fails with the original bytes preserved; a journal failure rolls back the write.
- MCP read/allocate/write occurred outside its SQLite write transaction, losing
  concurrent inserts. Row allocation, collection persistence and journal updates
  now share a transaction. Tagged local records respect the selected workspace;
  forged insert ownership is replaced and ambiguous cached profiles require an
  explicit `FILEY_LOCAL_USER_ID`.
- MCP draft headers and items could commit separately; quotation items also used
  column names unsupported by the cloud schema. All three document draft types
  use atomic `filey_save_document`, correct quotation `product`/`rate` columns,
  bounded item counts and an actual save receipt. Local mode implements the
  create-only equivalent in one SQLite transaction. Cloud mode requires the
  pending `2026-10-04-atomic-document-save.sql` migration and does not fall back
  to a partial save.
- MCP money reports overstated partial receivables, VAT after document discounts,
  cancelled sales and credit-note income, and combined different currencies.
  Payments are scoped to the workspace; cent-based tax allocations, posted
  status/credit-note rules and separate currency groups now match the business
  workflow. Flat report totals exist only for zero/one currency.
- MCP generated messaging approval codes without a paired actor binding, so the
  hardened channel executor could never safely accept them. The tool now returns
  explicit guidance to propose and approve the reminder in the paired chat and
  creates no unusable pending action. Cloud fetch redirects are rejected to avoid
  forwarding authentication through an endpoint redirect.

## Verification

- Native Rust: 28 tests passed using the Visual Studio x86-host/x64-target
  environment and `cargo test --lib --locked --offline`. Includes a real Windows
  junction fixture, noisy PowerShell output and process-tree timeout regression.
  Log: `output/native-audit-2026-10-04-rust-tests.log`. The final run includes
  the existing sync collection/journal batch rollback regression.
- WhatsApp bridge: 50 tests passed in 5 files via
  `node node_modules/vitest/vitest.mjs run tools/wa-bridge`.
  Log: `output/wa-bridge-audit-2026-10-04-tests.log`.
- MCP: TypeScript build, offline local smoke and stdio handshake passed.
  The throwaway SQLite smoke covers collection/journal corruption and rollback,
  ownership filters, ambiguous profiles, 100 simultaneous inserts from two worker
  threads, draft header/item rollback, correct schema columns, VAT, credit notes,
  cancelled invoices and mixed-currency reports. The handshake exposes 17 tools.
  Log: `output/mcp-audit-2026-10-04-tests.log`.
- Android/iOS wrapper manifests, source, plugin bindings and build configuration
  were reviewed statically. No new confirmed wrapper defect was repaired here.

## Remaining verification boundaries

No live provider/chat/payment requests, customer database operations, deployment,
packaging or reinstall occurred. The cloud RPC remains unpublished; its SQL
transaction/RLS tests are owned by the data isolation audit. Android/iOS runtime
builds and physical-device verification were not performed on this Windows host.
Version 3.0.10 and the release hold were preserved.

The subsequent cross-process repair below closes the desktop/MCP stale-cache
and lost-update gap in the current sources. Previously installed desktop
binaries still require this native/frontend update before simultaneous edits.
Legacy untagged offline rows remain visible because their workspace cannot be
reconstructed safely. Local filesystem checks do not claim protection against a
hostile process with the same OS account racing directory replacements.

## Follow-up: desktop/MCP cross-process writes and number allocation

Collection reads now validate stored bytes before reusing parsed/hydrated rows;
the sync journal uses the same refresh rule. Saves compare the entire captured
read set (including read-only dependencies and the journal) under SQLite
`BEGIN IMMEDIATE`, then publish all collections/journal entries atomically.
Native-phone IndexedDB compares and commits within one read/write transaction.
Hosted-browser local storage uses the existing Web Lock and quota-failure
rollback. Content-addressed blobs are still persisted before their references.

Conflicting document saves, edits, deletes, workspace copies and reviewed sync
choices produce a recoverable conflict without overwriting another writer.
Pure inserts, stock/balance deltas and dirty-ID unions may retry at most three
times using fresh records. Other workflow callbacks are never replayed. Any
staged builder read/write error aborts the whole workflow, even when ignored by
its callback. Sync revision updates and their deletion revisions now commit
together; stale journal clears retain new dirty IDs.

Three additional repros showed nested objects leaking through the private read
memo: an unsaved edit could be persisted by an unrelated save, an aborted
transaction could publish a nested edit, and later changes to an insertion
input could corrupt the committed memo. Public reads/query results and captured
write/sync inputs now own their mutable JSON containers. The bounded copy keeps
primitive logo strings shared, while the internal parse/blob hydration cache is
retained. Repeated reads are checked to parse/hydrate once and return independent
records. Before-fix evidence: `output/completion-local-memo-mutation-repro.log`.

Deal-contact mutations use staged row operations instead of replacing an array
computed before entering the write queue. MCP and desktop automatic numbering
share the device-private reservation collection. MCP reservations use SQLite's
write lock, bind idempotency to actor/workspace/pattern/year, and do not enter
the sync journal. Cloud MCP uses the authoritative number-reservation RPC and
fails safely when its migration is missing. Manual MCP document inserts reject
new case/whitespace duplicate numbers and unsafe numeric IDs.

The focused native suite passes 31 tests. The offline MCP smoke drives a real
second OS process against a disposable SQLite file: stale multi-collection
writes and deletes are refused, refreshed saves retain IDs, and later inserts
retain deletion tombstones/revisions. Four independent MCP processes also
reserve unique numbers before saving drafts. Frontend regressions validate
the IPC command/read set, retry bounds, cache invalidation, read dependencies,
atomic rollback, sync preservation, blob round trips and phone ownership/CAS.
Logs: `output/local-cas-2026-10-04-native-tests.log`,
`output/local-cas-2026-10-04-mcp-tests.log`, and
`output/local-cas-2026-10-04-frontend-independent-tests.log`.
MCP compilation and the 17-tool stdio handshake are separately recorded in
`output/local-cas-2026-10-04-mcp-build.log` and
`output/local-cas-2026-10-04-mcp-handshake.log`.
The final focused frontend run passes 131 tests in 11 suites, including these
three memo regressions, blank-array/prototype-shaped JSON preservation, and the
unchanged twenty concurrent stock adjustments.
Log: `output/local-cas-2026-10-04-frontend-final-tests.log`.

## Follow-up: finite in-app agent boundary review

Reviewed approval, session, cancellation and result handling in the named ranges
of `output/agent-boundaries-reviewed-2026-10-04.json`. Large chat/tool/harness files
were reviewed at these boundaries, not claimed fully audited.

The raw `http_fetch` tool awaited saved-key resolution and then dispatched
without checking whether Stop, workspace, access role or agent mode changed
during that await. A hermetic regression showed an HTTP POST still occurred
after cancellation; the result was rejected only afterward. The tool now checks
the captured task and fresh module/mode permission immediately before dispatch
and forwards the task abort signal. Response bodies arriving after Stop are
discarded. Raw request redirects are rejected.

The same raw transport inherited chat retries, repeating an uncertain approved
POST four times after simulated network failures. Raw HTTP now uses zero retries;
ordinary model/research retry policy is unchanged.

Eight regression/compatibility test files passed 95 tests, including five new
last-dispatch cases and three raw-transport cases. The suite also exercises
approval overrides, agent runtime completion, credential isolation, chat dialog
behavior and public channel parsing. Logs:
`output/agent-boundaries-audit-2026-10-04-tests.log`;
the failure reproductions are `output/agent-http-dispatch-before-2026-10-04.log`
and `output/agent-http-no-retry-before-2026-10-04.log`.

Native/mobile cancellation cannot prove a dispatched provider request was
cancelled remotely. Uncertain actions require inspection; the raw transport
does not repeat them. No live requests or provider sends were used to verify
these changes.
