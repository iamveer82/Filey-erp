# Composio BYOK connection review — 4 October 2026

This bounded review used the active `filey-ui-refinement` checkout, synthetic
identities and mocked providers. No real Composio key, customer account, provider
authorization, tool execution, production API request, deployment or commit was
used. Version remains 3.0.10.

## Verified protocol

Composio's retirement concerns direct `POST /api/v3/connected_accounts`
initiation for managed OAuth. Filey already uses the supported hosted `/link`
flow, so that retirement does not establish a failure in Filey's current
implementation. Custom and non-OAuth initiation have different compatibility
rules. [Official ConnectedAccounts SDK reference](https://docs.composio.dev/reference/sdk-reference/typescript/connected-accounts).

The current reference documents Connect Link's required `auth_config_id` and
`user_id`, and a response containing `redirect_url` and
`connected_account_id`. Filey retains those fields and its existing v3 `/link`
protocol. [Official Connect Link API](https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink).

Managed auth-config creation remains supported; lookup is filtered by toolkit
and disabled configs are excluded by default. The repair validates the
requested toolkit against returned configuration metadata before starting a
connection. [Auth-config lookup](https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigs),
[auth-config creation](https://docs.composio.dev/reference/api-reference/auth-configs/postAuthConfigs).

## Concrete repairs

- Toolkit identifiers are bounded ASCII slugs. Invalid values do not reach the
  provider. Forbidden-character validation also rejects trailing newlines,
  which JavaScript's end-of-line regex anchor can otherwise admit.
- A malformed auth-config lookup is distinguished from a genuinely empty
  result. Invalid, disabled or mismatched configurations cannot trigger a new
  config or authorize the wrong toolkit.
- Newly created configurations must identify the requested toolkit and supply
  a valid configuration ID.
- Edge, desktop and frontend accept a connection start only with both a safe
  connection ID and a bounded HTTPS authorization URL. Credentials, whitespace,
  control bytes and custom URL schemes are rejected before opening or polling.
- Only the authorization URL and connection ID leave the connect boundary;
  link tokens, OAuth state and arbitrary extra provider fields are omitted.

Account/workspace entity hashing, own-key lookup, MFA, role gates, quotas,
connection ownership checks and tool approval/dispatch paths retain their
existing behavior. Catalog, execution, listing and status endpoint versions
were not migrated.

## Coverage and evidence

Source review covered the Edge entry authorization/key selection and Composio
connect branch, the full native Composio module, frontend connection routing,
and the new validation helper and focused fixtures. This is not a full review of
Composio's service or every Filey integration.

| Check | Result |
| --- | --- |
| `deno test --allow-env --allow-net --allow-read --lock=deno.lock --frozen supabase/functions/_shared/composio-connect_test.ts supabase/functions/_shared/composio-connect-handler_test.ts supabase/functions/_shared/integrations-proxy_test.ts` | 7 passed, zero failures. Provider fetches were mocked. Actual handler proves own key, derived identity, supported link request, safe projection and malformed-response refusal. |
| `npx vitest run src/lib/__tests__/composio-pagination.test.ts src/lib/__tests__/integrations-scope.test.ts` | 48 passed in 2 files. Includes incomplete links, unsafe redirects, secret projection, invalid toolkit dispatch, trailing-newline identifiers and existing scope/pagination guards. |
| `cargo test --lib modules::composio::tests --locked --offline` under installed MSVC Hostx86-to-x64 development environment | Native library compiled; 2 focused tests passed, 30 unrelated tests filtered. Initial ambient compiler failure was resolved by selecting the installed toolchain; nothing was installed. |
| `deno check --lock=deno.lock --frozen supabase/functions/integrations/index.ts` | Passed. |
| ESLint and `git diff --check` for the owned source/test files | Passed without errors. |

Edited paths: `supabase/functions/integrations/index.ts`, new
`supabase/functions/_shared/composio-connect.ts`, its two new test files,
`src-tauri/src/modules/composio.rs`, `src/lib/composio.ts`, and
`src/lib/__tests__/composio-pagination.test.ts`. Existing dirty changes were
preserved. Root and the UI agent own credential persistence and connection-page
changes separately.

## Live-provider limit

These results prove request construction and rejection behavior with local
fixtures. They do not prove that a particular project API key, toolkit's OAuth
app, selected scopes or customer consent works against live Composio. A real
connection is successful only after the provider reports an owned `ACTIVE`
account; saving or checking a key is not that authorization. No production
backend configuration or real connected-account data was inspected.
