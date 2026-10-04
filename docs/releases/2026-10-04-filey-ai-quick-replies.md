# Filey AI quick replies

Filey AI previously forced provider reasoning on for every managed request. It now defaults to quick replies with reasoning disabled. A compact Reasoning switch lets users opt in for difficult tasks. The selected mode is fixed throughout the current task and saved separately for each account, workspace and storage mode. Existing effort preferences do not silently enable reasoning; user-supplied provider connections keep their existing effort controls.

The managed request carries a strict `reasoning_enabled` boolean. The backend maps false or missing to `thinking.type = disabled` and omits positive reasoning effort, which could otherwise re-enable thinking. Enabled tool runs retain exact provider reasoning within that run. Prior visible assistant replies become labeled quoted context when starting a reasoning-enabled run; Filey does not fabricate reasoning for old chat history. Wallet reservation, usage verification, completion recovery, tool data checks and approvals remain in force.

Routine clear requests use the required lookup and action directly. For an invoice based on the last invoice, the assistant retrieves the matching record, reuses confirmed details in a new draft with a new document number, and verifies the saved result. It does not mark the invoice sent or paid unless requested.

Deploy the reviewed `ai-credits` handler and shared dependencies first, then the matching web build. No database migration, price change, credit grant, provider credential change or desktop updater release is required. Provider inference and tool calls still take time; this removes forced reasoning, not all request latency.

Validation covers quick chat and tool turns without reasoning, explicit opt-in and opt-out, mode pinning across tool rounds, continuing an existing chat after switching modes, preference isolation, recovery, unchanged user-supplied providers, and frontend/backend type and build checks.
