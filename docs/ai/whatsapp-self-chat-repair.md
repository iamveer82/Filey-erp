# WhatsApp self-chat repair

The installed Filey bridge could generate a pairing QR and the actual desktop app showed Connected, but `tools/wa-bridge/index.mjs` accepted only Baileys `notify` events. Self-chat messages can arrive as `append`, so they never reached the agent even though the phone session was healthy.

Reference: [Hermes bridge at 074349f](https://github.com/NousResearch/hermes-agent/blob/074349fb2744eacafbf80234444541aa736b1689/scripts/whatsapp-bridge/bridge.js), its `messages.upsert` handler explicitly accepts both event types for self-chat. Filey keeps its existing stdin/stdout desktop transport and owner-only permissions. No Hermes source was copied or new runtime added.

The repaired handler accepts append events only for verified self-chat sent by the owner, with a provider timestamp from the current bridge process lifetime. Historical/missing-date entries, strangers and outgoing customer conversations are rejected. Duplicate IDs across notify/append are processed once, and Filey's self-chat reply prefix also prevents feedback loops. Attachments and voice notes use the same filtered path. Messages sent while Filey was closed are intentionally not replayed; send a fresh task after reconnecting.

The connection UI now gives Message yourself instructions when My WhatsApp number equals the paired phone, instead of implying a second phone is necessary. Existing pairing credentials are retained.

Checks: bridge transport/identity, frontend pairing, account binding and agent lifecycle tests; compiled Windows bridge QR handshake using a temporary unpaired session; production frontend build. Live pairing reconnection and an owner-initiated `/status` reply are separate verification steps. `/status` does not invoke a model or edit business records.

## Connection hardening

The native supervisor assigns each running bridge a session ID and stamps inbound messages with it. Replies and outgoing files must match the currently connected session before writing to the sidecar. Re-pairing, stopping or replacing a bridge cannot route an old task's output through the new connection. Account/workspace checks remain independent of this session check. No token or WhatsApp credential is exposed to model prompts.

Duplicate phone-JID/LID deliveries now share the authenticated owner's dedupe key. Malformed provider/stdin payloads are ignored without stopping subsequent valid messages. Native shutdown detaches the supervisor before waiting, so its reader can drain stdout while pairing credentials are saved. Voice work is bounded and canceled on stop; provider failures are summarized without forwarding raw responses to WhatsApp.

Integration settings distinguish pairing from agent readiness, explain self-chat, explicitly save owner-number changes, and hide recent message content until expanded. Pairing stays on the computer; no claim is made that Baileys' auth files are encrypted at rest.

No public release is published by this repair. **Ship the frontend and native application together:** this hardening adds required `sessionId` arguments to outgoing native commands and `bridgeSession` on inbound events. A sidecar-only swap does not deliver these protections. Production rollout still requires the normal signed release workflow.
