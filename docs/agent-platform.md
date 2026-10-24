# Filey as an agent platform (the OpenDots shape)

Filey is not a chat box with tools bolted on. It is an agent that owns a
business: it reads and writes every section of the app, it can drive the
machine and the browser, and it can be reached from wherever the user is.
This is the map of that platform — what exists, what was added, and what is
next — written so the next change has a place to land.

## The five parts

| OpenDots | Filey | Where |
|---|---|---|
| **Dots** — specialist agents with a role, tools and memory | Filey AI + the persona layer (one brief, many surfaces) | `src/lib/agentPrompt.ts`, `src/lib/agentPersona.ts`, `src/lib/agentCommands.ts` |
| **Spaces / Pages** — work documents the agent writes into | Office work: Word, Sheets, PDF, Slides, Designs, Fig, Vector — all driven by the agent | `src/lib/officeWord.ts`, `src/lib/aiTools.ts` (`word`, `sheet`, `pdf`, `slides`, `design`, `fig`, `vector`) |
| **Dot computers** — a browser + files + shell per agent | The agent computer (a private browser workspace per conversation), the owner's browser bridge, and Windows computer use | `src/lib/agentComputer.ts`, `src/lib/desktopBrowser.ts`, `src/lib/computerUse.ts`, `src-tauri/src/modules/computer_use.rs` |
| **Connections** — MCP servers and connected apps per agent | Composio (Gmail, Slack, Telegram…), plus MCP in the Filey Agent core | `src/lib/composio.ts`, `agent/tools/mcp_tool_*.py` |
| **Channels** — the agent reachable from a chat platform | The channel registry: app, WhatsApp, Telegram, email, Slack, Teams, Discord, webhook | `src/lib/channelRegistry.ts`, `src/lib/agentChannels.ts`, `src/lib/remoteAgentTurn.ts` |

## 1. Every section of the app is connected

The agent could read and write most of Filey, but not all of it. The audit
found the gaps and they were not small:

- **Purchase Orders** had a write and no read — the agent could raise an LPO
  but never see the ones already with suppliers.
- **Follow-ups** wrote to the follow-up board while its own read tool listed a
  different store, so "what do I owe this week?" answered from the wrong list.
- **Bank Accounts** and **Email Templates** could be listed but never changed.
- **Settings, Team and the Comms log** had no tools at all.
- **People** could not hire, correct or pay an employee; **Accounting** could
  not open an account or post a journal entry.
- **Customers, Suppliers, Products, Orders, Cheques and Receipts** were
  create-only: the agent wrote records it could never correct.

Those are closed by ~30 tools (`aiTools.ts`), each placed in its section's
domain, gated by the section's module permission, and classified as a write
so Plan mode still says no.

**The rule is now a test.** `src/lib/__tests__/agent-section-coverage.test.ts`
fails the build when a section loses its read or its write, when the app map
names a tool the model is never offered, or when a write is not gated. The old
tests only checked that tools *exist* — which is why all of the above shipped
green.

## 2. The agent's map is one line per section

`appMap.ts` used to put one prompt line per *area*, and Office work alone held
five (Letters, Word, Sheets, PDF editor, Office apps). The prompt rides on
every request, so it is now one line per *section*, and the domain index in
`use_toolset` is terse enough that two new domains (team, admin) fit inside
the same 15 kB first-round budget.

## 2b. The office apps answer the agent

Word, Sheets, PDF, Slides, Designs, Fig and Vector are driven by command ids
that live in the Craft apps, not in this repo (`file.new`, `file.saveBytes`,
`document.export`, `app.print`, `ui.menu.invoke`). The patch forwards
whatever id it is given, and a wrong id comes back as `{ok:false}` — which
reached the user as "could not save the file" with nothing in the repo to
catch it. **No test drove these paths at all.**

`src/lib/__tests__/office-agent-commands.test.ts` now pins every app's
command id and the field its reply must carry, per format. A wrong id in the
app, or a changed id here, fails the build instead of a user's afternoon.

**Known limit:** the office apps are desktop-only (on the web the tool answers
"coming soon"). The first round still offers them there, because the harness
has no reliable desktop signal in the web build — the web build is the
secondary target and the tool's own message is clear.

## 3. One channel registry, many channels

WhatsApp and Telegram each grew their own agent loop and the rules drifted:
one blocked the owner's computer, the other did not; one understood "YES" as
approval, the other did not. `channelRegistry.ts` is now the single place
that knows what a channel is:

- **app** — the desktop chat. The only surface that may drive the owner's
  screen.
- **whatsapp / telegram** — remote, text only, files on WhatsApp; a phone
  never gets `computer_use`, `browser` or `run_shell`.
- **email** — remote, text only, files yes.
- **slack / teams / discord** — remote, delivered through an incoming-webhook
  URL the user stores; the URL host must match that channel's own hosts, so a
  channel cannot be turned into a mail gun.
- **webhook** — the generic door for anything else.

Every run is now told which channel it is on (`platformHint` in
`agentPrompt.ts`), approval words are per channel ("YES", "نعم"), and the
agent can reach the user anywhere with `send_to_channel` — WhatsApp,
Telegram, email, Slack, Teams, Discord — and find out what is connected with
`list_channels`.

**Next:** inbound Slack/Teams/Discord need a public endpoint, which a desktop
app does not have. Two doors are open: a signed webhook the user exposes
through a tunnel, or the hosted relay CopilotKit's Channels SDK uses. Outbound
needs neither and is already done.

## 4. The computers

Three distinct machines, and they must not be confused:

| Surface | What it is | Who may use it |
|---|---|---|
| `agent_computer` | A private browser workspace per conversation — its own cookies, its own sign-ins | Any conversation; no Docker, no separate OS |
| `browser` | The owner's real browser, with their logins, over the local bridge | The owner, in the app |
| `computer_use` | Windows itself: any installed app, accessibility tree first, vision second | The owner, in the app; never remotely |

A remote channel may use the isolated agent browser when the workspace has
opted in, and never the owner's screen, their browser or a shell.

## 5. What the agent may do is a property of the session

`capabilities.ts` holds the toggle groups; `moduleAccess.ts` holds the
workspace permission; `channelRegistry.ts` holds the channel's own limits;
`agentMode.ts` holds Plan/Manual/Auto. A tool runs only if all four say yes.
That is why the same `send_to_channel` is free in the app, needs approval in
Auto, and is refused in Plan.

## The remaining work, in order

1. **Channel settings** — a real screen for connecting Slack/Teams/Discord
   (paste the webhook URL, test it, see what is connected) instead of asking
   the agent to store a secret.
2. **Inbound webhooks** — one signed endpoint that accepts a message from any
   platform and lands it in the same queue WhatsApp uses
   (`agentChannels.ingestChannelMessage` is already the door).
3. **Dots** — named specialists (an accountant, a sales agent, a warehouse
   agent) with their own brief, their own tools and their own memory. The
   persona layer is already there; it needs a roster and a picker.
4. **Connections** — per-Dot MCP servers with read-only-by-default and an
   approval card for writes, as OpenDots does. The Filey Agent core already
   speaks MCP; the app needs the registry and the UI.
5. **Background work** — "do this every Monday" from a channel, landing the
   result back in the same conversation. The cron surface exists in the agent
   core; the app needs the schedule, the pause and the receipt.
