# Fresh database installer

`schema.sql` is the canonical installer for an empty **Supabase** project. It
includes the core schema, the reviewed historical feature chain and current
authority migrations. Run the entire file once as the database owner. It uses
one transaction; an error must roll the whole application installation back.
Do not execute selected fragments or continue after an error.
Finish this first installation before enabling application or signup traffic.

Supabase supplies the `auth` and `storage` schemas, `auth.users`, Auth helpers,
API roles and managed default privileges. They must already exist. This file
does not provision a generic PostgreSQL server as a Supabase replacement, nor
does it configure API keys, secrets, OAuth, Edge functions or payment providers.
Existing Auth accounts are provisioned once during this fresh installation,
using the same personal workspace, profile and owner membership as a new signup.
That step reads trusted Auth rows and has its own installation receipt. A repeat
does not recreate a deliberately deleted profile or change existing memberships.
Configure `platform_config.owner_uid` to the actual platform administrator's
Auth UUID as the database owner before receiving sales inquiries. Historical
founder configuration is not proof of a valid owner in a new installation.

## Existing databases

Do **not** install this file over an existing untracked Filey database. The
installer refuses it before changing application objects. Use the reviewed
dated upgrades in [MIGRATIONS.md](MIGRATIONS.md), after checking the actual
catalog and deployed release. Historical migrations may contain old policies,
backfills and function bodies, so blindly replaying the complete chain on
customer data is not an upgrade procedure.

A database created by this installer has a private
`filey_bootstrap_migrations` ledger. Historical sources execute once, with a
SHA-256 receipt. Repeating the same installer preserves stored business rows,
workspace ownership and wallet balances. A changed installed source hash fails
and rolls back; add a new reviewed migration rather than rewriting installed
history. Current authority definitions remain repeatable and follow the
historical chain.

## Maintaining the canonical file

Core and current non-generated sections are editable. Sections marked
`BEGIN GENERATED FRESH BOOTSTRAP` are rebuilt by
`scripts/build-schema-bootstrap.mjs`; edit their source migration or the
generator's explicit current-upgrade allowlist instead of hand-editing generated
SQL. Historical inputs are named in the generated sections. The managed advisor
helper migration `2026-07-11-function-grants-hardening.sql` is excluded: the
installer applies the app's final definer ACLs itself. The current storage
privacy upgrade separately removes managed authenticated default execution
from the service-only retention routine. Realtime includes every
table in the actual sync manifest.

Run from the repository root:

```sh
node scripts/build-schema-bootstrap.mjs --write
node scripts/build-schema-bootstrap.mjs
node scripts/test-schema-bootstrap-local.mjs
node --test scripts/test-runtime-schema-checks.mjs scripts/test-workflow-schema-checks.mjs scripts/test-cloud-privacy-checks.mjs
node scripts/test-cloud-privacy-local.mjs
```

The generator check is deterministic and makes no database connection. The
integration suite starts its own temporary local PostgreSQL cluster. It uses
only synthetic Supabase Auth/Storage prerequisites and synthetic customers; it
does not read deployment credentials, contact live services or alter an
existing cluster. PostgreSQL binaries are required; set `PGBIN` if they are not
at the standard Windows PostgreSQL 18 location or available via `pg_config`.

The suite runs the **entire** installer from an empty public schema, exercises
real signup, workspace switching, verified invitation acceptance and team
channel read RPCs, then compares every public row across repeated installation
and repeated current upgrades. It tests changed migration receipts, final-stage
rollback and refusal of a legacy installation. Actual document numbering tests
include concurrent distinct requests, concurrent identical replay, historical
seeding, unused reservations, normalized manual collisions, module restrictions
and unchanged historical duplicates. Its final catalog must pass the current
application's table, column, RPC, RLS and Realtime checker with zero issues.
Inquiry fixtures also prove rollback after coupon failure, immutable retries,
service-only grants and eight-way concurrent lead/voucher/coupon setup.
Recurring-invoice fixtures prove eight-way concurrent generation creates one
cycle, retries preserve its result, and item or schedule failures roll back the
new document and number reservation. They reject hidden malformed legacy lines,
foreign workspaces and incorrect actor, module, author and schedule inputs.
Generic document fixtures use the installed policies to let an ordinary staff
author replace invoice, quote and PO lines after an administrator's edit,
without retaining stale lines. They prove invalid replacements roll back,
hidden/creator-incompatible historical lines fail closed, the privileged helper
enforces scope and module access, and direct generic invoice/PO posting is denied.

The exported catalog is `output/bootstrap-catalog.json`. Keep a successful full
suite log with release evidence. Passing this disposable suite proves local
installation compatibility; it does not establish the state or configuration
of the live Supabase project.

Final cloud-privacy continuation on 4 October: the entire installer and all 14
repeated current upgrades passed, with 93 tables, 1,192 columns, 144 named
functions and zero checked issues. The runtime checker has 27 passing
regressions, including six private-bucket/service-grant regressions, and the
existing workflow contracts include both safe advance overloads and the
privileged boolean receipt-cost guard. Its 12 internal helper signatures require
executor-only execution; direct client and service calls are denied. Canonical
SHA-256:
`1aae7371b473b0fe031c358b47c4d13df753cafbb13bf6ccf12b076b8927ac8a`.
The private Storage/retention matrix also proves client cleanup denial,
cross-owner forged-path preservation, private flags, direct attachment sharing,
secret column denial, MFA and revoked share behavior in a disposable cluster.
Scheduled output requires the service-only current-workspace/admin helper.
These checks do not confirm the configuration of the deployed project.
