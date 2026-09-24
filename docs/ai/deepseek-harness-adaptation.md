# Filey agent harness: DeepSeek architecture adaptation

Reviewed upstream: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/tree/46a7f68b0922371ce7144b668b90e377d8e799f4), MIT, core `0.1.7-rc.1` (developer preview).
References: [architecture](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/architecture.md), [tool execution pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/tool-execution-pipeline.md).

This is an independent adaptation of those architectural ideas in Filey's existing TypeScript harness, not a bundled DeepSeek/Cordis runtime or a switch to a particular model. No upstream source was copied. The same loop serves desktop chat, web chat and paired-owner WhatsApp; native browser/desktop tools retain their platform restrictions.

## Execution and context

- `search_tools` finds up to six relevant enabled tools and loads their schemas for subsequent rounds. Existing domain discovery remains available.
- Arguments are validated before permission prompts and execution. The small validator supports the types, enums, required properties, additional properties, numeric bounds and collection lengths used in Filey's tool registry. It does not implement every JSON Schema dialect. No coercion of amounts or IDs.
- Fresh tool results in a batch stay intact until a successful model request has consumed them. Older observations get recoverable references in the existing bounded, in-memory headroom store. That store holds up to 40 outputs for one hour, clips originals above 200,000 characters, and is not durable history.
- Plans cannot silently finish while steps remain pending: two bounded completion reminders precede a blocked outcome. The default budget is 32 model requests, shared with delegated work; the action budget remains 128. Extra rounds only incur provider usage when used.
- Unexpected tool exceptions produce an uncertain outcome. The existing duplicate-write guard blocks identical retries within a run; approval, owner, capability, workspace and cancellation checks remain in effect.

## Follow-up recovery

The shared `aiAgentStream` records each owner call before dispatch and records its outcome afterward. It stores only tool names, statuses and allowlisted record references in Filey's existing account/workspace/mode-scoped local storage. No raw arguments, tool output bodies, screenshots or credentials are stored in this ledger. Storage is capped at 20 conversations and 40 actions each; the next request receives the most recent 24 action summaries for that conversation.

Started or uncertain calls require inspection before continuing; the ledger never grants approval or automatically replays actions. Media jobs awaiting approval remain waiting. WhatsApp `/new` clears its conversation's receipts. Browser ownership changes only for relevant capability changes, not for every checkpoint write.

This is bounded follow-up context, not crash-safe exactly-once execution, an automatic restart scheduler or cloud-synchronized agent history. Clearing browser data clears it. Concurrent use on different devices does not share these receipts. Visual browsing still needs a vision-capable model and the supported desktop runtime. Model accuracy cannot be guaranteed by the harness.

## Browser tasks

Owner chat in the Windows desktop app offers `workspace_browser` immediately and supplies the current panel availability to the model. Opening a URL and listing tabs work with text-only models; screenshots and visual input need a vision-capable model. Opening Instagram does not require a social publishing API key. Login and CAPTCHA remain user handoffs. Access settings, conversation ownership and browser takeover still apply. Web-only and remote runs do not acquire native desktop access.

## Verification

```sh
npx vitest run src/lib/__tests__/agent src/lib/__tests__/headroom.test.ts src/lib/__tests__/toolsets.test.ts src/lib/__tests__/wa-agent-lifecycle.test.ts src/lib/__tests__/wa-bridge-binding.test.ts src/pages/__tests__/agent-dialogs.test.tsx
npm run build
```

Tests use local fixtures and simulated model replies, not customer records or live paid providers. Live provider and WhatsApp delivery require a separate configured end-to-end check.

Desktop browser smoke check, 2026-09-24: built the debug desktop executable and sent “Open https://www.instagram.com/ in the built-in browser. Do not sign in or publish anything.” through Filey AI using the existing DeepSeek V4 Pro configuration. The agent executed one browser action and opened the Instagram login page in the embedded panel. No login or publication was attempted. This verifies URL opening, not screenshot-driven interaction or WhatsApp delivery. The local preview is not a published update.
