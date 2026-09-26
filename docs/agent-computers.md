# Filey agent browser workspaces

Agent computers are optional and **off by default**, including for existing
users. Enable **Filey AI → Agent access → Manage action groups → Agent computers
(optional)**, with Computer use enabled. This choice is scoped to the account,
workspace and storage mode on this device. Full access alone does not opt in.
Turning it off closes the agent workspace and revokes its computer access;
saved browser profiles remain available if it is enabled again. WhatsApp and
normal Filey AI tools do not depend on this switch.

Filey uses its existing Windows WebView2 browser. Docker, virtual machines, a
browser server and extra API keys are not required. Model usage still follows
the user's configured provider or Filey credit selection.

Each account, company and conversation receives a separate hashed browser
profile. Switching conversations closes the old views while retaining cookies
for that conversation. Local/cloud modes share the same account profile. This
is a browser workspace, **not a separate operating system or a security sandbox
for arbitrary programs**. No shell or script-evaluation tool is provided by
`agent_computer`.

The agent opens a website, captures the visible tab, performs one input using
that screenshot, then observes again. Native controls reject stale screenshots,
replaced windows, changed panels and canceled sessions. Screenshot coordinates
refer to the browser content, not the full desktop. Native grants remain outside
model prompts and storage. Actions retain Filey's owner, module, capability and
approval checks; website content cannot authorize an action.

The browser opens beside chat. Collapse hides it; Take over revokes input until
Resume agent is selected. Stop ends work and closes tabs, retaining the profile.
Passwords, CAPTCHA, permission prompts, payments and file dialogs require the
user. Filey's separate `computer_use` tool remains available for approved
desktop tasks; it is not represented as browser-only isolation.

Interactive browsing requires Filey's Windows app to be running, with the
browser visible on an unlocked desktop. It cannot run invisibly on an iPhone or
Android browser. Mobile/web users retain business tools and web research. A
paired WhatsApp task can use the desktop browser while Filey is running; a
different active conversation must release its browser first.

WhatsApp conversations retain scoped history across restarts. `/new` starts a
fresh conversation context without deleting memories; `/stop` cancels active
work and pending approvals. `/help` and `/status` need no model request. Only the
configured owner can invoke the agent. Pairing credentials remain in the OS
user's app-data directory, with a single writer per instance. These session
files are sensitive and are not encrypted by Filey; do not share the directory.

## WhatsApp files and actions

Connect in the installed app under Integrations → Built-in connections →
WhatsApp (QR), then scan using WhatsApp → Linked devices. No messaging API key
or Docker is needed. This uses an unofficial linked-device client; availability
depends on WhatsApp and its account restrictions. AI usage follows your provider
or credit settings. Filey must stay open, signed in and online.

Message yourself (or message the paired number from the explicitly configured
owner number). `/status` checks readiness without a model call. Ask “Send me
invoice INV-001 as a PDF” to export the actual invoice template without changing
its status or contacting a customer. Send a PDF/image up to 12 MB with an
instruction to use Filey's file tools. Each request has its own attachment and
output context. Saved outputs up to 50 MB return to that same chat, using the
real file bytes. New outputs live in unique subfolders of the export directory
so a later export cannot replace a file awaiting approval.

The agent uses the existing ERP tools and their module/capability checks. It
retains scoped conversation history and memories. Sensitive actions, including
delivery to another person, require YES against one exact proposal within 15
minutes. A changed recipient or action needs a new approval. Interactive editors,
paid-media approvals, logins and OS dialogs still require the desktop app.

Only the trusted main Filey view can call the WhatsApp native commands or
receive its message events. Other websites cannot read pairing codes, receive
messages or use these commands. Stranger/group messages are rejected before
media download or AI execution. Account/company changes cancel pending work.
Attachment contents cannot grant permissions. `/stop` cancels queued work and
approvals; an action already submitted may have completed.

Filey reports provider acceptance only after WhatsApp returns a message ID;
that is not proof of phone delivery or reading. An uncertain send is not retried
automatically. Check the chat before asking again to avoid duplicate messages.

Checks: `npm exec vitest -- run src/lib/__tests__/desktop-browser.test.ts
src/lib/__tests__/computer-use.test.ts src/lib/__tests__/wa-agent-lifecycle.test.ts`.
Native boundary checks: `cargo test --manifest-path src-tauri/Cargo.toml --lib
modules::` in a Windows MSVC environment. Live login and real outbound delivery
must be checked separately; the automated suite does not send customer messages.
