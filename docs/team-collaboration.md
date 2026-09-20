# Team collaboration release

September 20 deployment: the migration is applied and `team-invite` v1 is active.
The existing Resend configuration is present. Structural and disposable-database
checks passed; real two-user email delivery remains a separate acceptance test.

The team upgrade adds verified-email invitations, a workspace selector, synchronized workspace identity, conversation pagination, unread counts, and mention links. Business records are not moved when someone joins or switches a workspace.

## Deployment order

1. Apply `supabase/2026-09-20-team-workspaces.sql` after the existing team-comms, module-access, and shared-record-permissions migrations. It is idempotent and does not rewrite business records.
2. Deploy `team-invite` with JWT gateway verification disabled; the handler validates the actual Supabase session and verified email, and its database RPC checks workspace administrator membership. The edge function needs the existing server-only `RESEND_API_KEY` and `EMAIL_FROM`. `APP_URL` defaults to `https://app.gofiley.com` and can point to a staging deployment.
3. Deploy the frontend after the database and function. The new frontend requires these RPCs; do not deploy it first.

```powershell
supabase functions deploy team-invite --no-verify-jwt --project-ref voyrjqgaypiylwskkwpr
```

Credentials belong in Supabase secrets or the local CLI session, never source control.

## Expected behavior

- Only workspace owners/admins with verified account emails can invite. Profile display emails are not proof of identity.
- Invitations expire after seven days. The sender can resend or revoke them. Joining preserves an existing member's role rather than escalating it through an older invitation.
- An email link opens Settings → Users & Roles. The recipient signs in or registers with the invited address and explicitly accepts. Signing in alone never accepts an invitation.
- Email status distinguishes provider acceptance (shown as **Email queued**), failure, and an unknown response. Queued does not claim inbox delivery. Requests reuse a persistent provider attempt ID; explicit resends have a one-minute cooldown and a workspace daily budget.
- Resend documents a 24-hour idempotency window. Automatic retries reuse an attempt for less than 23 hours; explicit resends start a new attempt. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).
- A workspace switch refreshes the profile, permissions, data providers, device registration, and billing caches. Other tabs pause before further actions until reloaded. Device-local records remain associated with their original workspace.
- Reconnecting a dropped realtime connection or returning after a background pause refreshes missed changes and checks the active workspace again. An unchanged workspace keeps its current screen mounted during that check. Late profile responses, including expired-token errors, cannot replace a newer workspace.
- Team channels are workspace-wide, not private direct messages or SMS. Replies remain with their root conversation. A new reply brings that conversation into the latest page. Mention links open the correct channel/thread.
- Ordinary members can read shared invoices; authors and admins can edit. Private records remain private under the existing database policies.
- Basic's five new invoices per month belong to the workspace, with unlimited edits. Paid subscription states affect the workspace's shared allowance.

## Automated acceptance

```powershell
npm run typecheck
npm test
npm run test:edge
npm run test:rls:local
deno check --lock=deno.lock --frozen supabase/functions/team-invite/index.ts
npm run build
```

The disposable PostgreSQL suite applies the production migrations twice and exercises: owner invitation, verified recipient acceptance, previous-workspace retention, messages/replies/mentions, unread markers, pagination, shared/private invoices, forbidden writes, outsider rejection, expired invites, email retry identity, subscription activation/renewal/grace/cancellation, old-event replay, and unlimited editing after downgrade. It creates and removes only a fresh temporary local cluster. React tests cover onboarding state refresh, truthful email status, and local message rendering.

Local verification on September 20, 2026: 1,609 app tests across 249 files and 70 edge tests passed; the disposable PostgreSQL suite, TypeScript/build, edge typecheck, and route bundle checks passed. Lint reported zero errors with existing warnings. Browser checks on a disconnected QA origin verified posting, threaded replies, channel creation/isolation, and the 390px mobile layout. The browser check exposed a missing local sender identity; the shared message reader now normalizes it and a regression test covers the crash. Reconnect tests cover missed workspace switches and stale profile errors. No customer records or real provider transactions were used.

## Live acceptance still required

These cannot be replaced by unit tests or a successful deployment:

- Use two dedicated test accounts in an isolated cloud workspace: invite from the owner, receive the email, accept as staff, then exchange messages in two browser sessions and verify realtime delivery, unread counts, and the mention destination.
- Share a synthetic invoice and verify staff read-only access; verify another workspace cannot read it. Revoke membership and confirm subsequent requests fail.
- In a separate Dodo **test-mode** environment, complete a checkout and verify signed webhook delivery through to plan activation, renewal, cancellation, and the customer portal. Do not switch production billing into test mode or charge a real card for this check.
- Test reconnect after a dropped connection and workspace switching while another tab is open.

At implementation time the saved Supabase management token returned 401 and the dashboard was signed out. Access is now restored and the backend is deployed. Local checks do not establish production email delivery or Dodo checkout success.
