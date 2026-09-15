# Workspace access

Cloud membership must be verified before opening a workspace. Missing membership,
failed lookups and changes of account fail closed. Restricted staff reads bypass
old local snapshots and reach the database's current row policies.

Module grants now intersect organization, author and sharing permissions on the
underlying records. People covers employees, attendance, advances and payroll;
Accounting covers accounts, expenses and transactions. Sales invoices and supplier
bills have separate grants. Projects and Helpdesk are separated by record kind.
Bank accounts, cheques, declaration letters and delivery challans stored in JSON
settings have the same protection as table records. Sharing and sync RPCs preserve
these gates. Existing private/shared visibility is still required.

The core Overview, Filey AI and Settings pages remain available to verified
members, but do not grant additional business-data permissions. Reports and
Overview contain only records permitted by the member's business modules. Assign
the relevant data modules as well as Reports for complete organization reports.
Interconnected workflows require their related modules: for example, invoice
creation uses Customers and Inventory; posting and payment workflows also use
Accounting. Grants are explicit; Filey does not silently broaden an employee's
access. Separate read/create/post permissions are not yet a supported role model.

Filey AI's authenticated-user context is distinct from organization administration.
The shared tool runner verifies business modules before execution and again after
approval. Shell, raw network and computer-control actions require an administrator
in cloud mode. Browser and computer entry points apply that requirement too.
The on-device workspace remains single-user and uses its existing sign-in gate;
these policies do not sandbox an operating-system account that can directly read
its own SQLite files.

Apply `2026-09-12-shared-record-permissions.sql`,
`2026-09-12-sync-conflict-protection.sql`, then
`2026-09-12-module-access.sql` after the feature migrations, before deploying this
frontend. Deploy the updated integrations function at the same time. None of
these deployment steps has been performed by the disposable fixture tests.

Composio accounts are scoped by account and organization. Old unscoped desktop
credentials are quarantined in the OS secure store; enter your own key and
reconnect legacy integrations. Connection summaries exclude OAuth credential
fields. The list query uses the documented
[user_ids filter](https://docs.composio.dev/reference/v3/api-reference/connected-accounts/getConnectedAccounts).
