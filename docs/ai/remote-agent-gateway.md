# Desktop remote agents

WhatsApp and Telegram use `remoteAgentTurn.ts` to run the same Filey agent,
enabled tools, workspace role, memories, skills and model configuration as the
desktop chat. They require the installed desktop app to stay open. Hosted
`channel-webhook` is a separate, single-owner relay with a smaller cloud toolset;
it cannot run device tools. See `docs/ai-agent.md` for its setup.

## Connect

- WhatsApp: connect the QR bridge in Integrations and pair the owner identity.
  Rebuild both the app and bridge sidecar for protocol changes.
- Telegram: create a dedicated bot with BotFather, enter its token in desktop
  Integrations, and send the displayed `PAIR <code>` in a private chat within
  ten minutes. The first exact, fresh code binds one human Telegram account.
  The token is stored in the existing account-scoped OS credential vault.
  An existing webhook is refused; Filey does not remove another service's setup.
- Configure a model in Settings → AI Assistant. Connection alone does not
  configure an AI provider. Account or workspace changes stop remote work;
  explicitly reconnect in the destination workspace.

## Permissions and delivery

Role restrictions and disabled tools remain enforced remotely. A sensitive
action asks for one exact `YES`, bound to that channel, conversation, workspace
and normalized tool arguments. Approvals expire after fifteen minutes, are
consumed once, and are activated only after the transport confirms the proposal
reply. They do not grant general access to every future action.

`/help`, `/status`, `/stop` and `/new` are handled without the model. Stop aborts
the current turn and cancels queued work and pending approvals; an already
accepted write or provider send cannot be undone. It also stops the optional
isolated browser for that conversation. Remote runs cannot start the owner's
native desktop computer grant. An agent computer is optional and uses a
separate workspace browser; there is no fallback to the user's personal tabs.

Conversations are stored separately per workspace, channel and owner. Telegram
uses private messages, a single-window bot lock, a five-task queue, five-minute
message age limit and a claimed update cursor before execution. Read polling
can retry; an ambiguous outbound send or business write is not blindly retried.
A crash after claiming an update can lose that task: this is at-most-once
execution, not a durable job queue.

Telegram accepts text, photos and documents up to 12 MiB; voice is not supported.
WhatsApp voice uses the configured transcription provider. Generated files are
returned from the current tool turn only. Telegram's native transport restricts
uploads to Filey AI task folders, pins its bot identity and destination, bounds
downloads/responses, disables redirects, and never returns token-bearing errors.
Provider acceptance confirms an upload/reply was accepted; it is not proof of
a recipient read receipt. Unconfirmed delivery preserves local results and asks
the user to check before retrying.

## Verify before release

Run frontend tests/build, the Rust transport checks, WhatsApp bridge lifecycle
tests, and hosted channel tests. Synthetic tests do not prove a real paired phone
or bot works. Manually verify each owner's pairing, stranger rejection, typing,
read-only task, PDF return, exact approval, Stop and workspace change with the
installed candidate build. Do not use customer records for that test.

For hosted deployment, apply `supabase/2026-09-30-channel-agent-drafts.sql`
before deploying the new function. It makes document headers, lines and audits
atomic and verifies current owner/admin membership inside the transaction.
Missing schema or unverified permissions fails closed. It does not migrate
or upload customer records automatically.

## Profile and tool artwork

Profile choices use Blobatar's ten generation-2 silhouettes, the same geometry
and color vocabulary ported by BlobatarSwift. Users choose the shape and one
of ten colours independently. Filey adds subtle motion and a static
reduced-motion mode. The ten existing avatar URLs and uploaded photos are
retained. Apply `supabase/2026-09-30-avatar-choices.sql` before releasing the
new team-member picker; it expands preset validation without changing its
permissions or rewriting profile data. Tool covers are original theme-aware
SVG document drawings rendered by the shared `ToolCover` component; no raster
cover request or extra graphics library is needed.

References: [Hermes Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram),
[Hermes WhatsApp](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp),
[Telegram Bot API](https://core.telegram.org/bots/api),
and [BlobatarSwift](https://github.com/RayZhao1998/BlobatarSwift).
Tool artwork is independently authored. Profile SVGs are generated from the
MIT-licensed upstream Blobatar renderer; Swift code is not embedded in the web app.
See `NOTICE` and `licenses/blobatar*.txt` for attribution.
