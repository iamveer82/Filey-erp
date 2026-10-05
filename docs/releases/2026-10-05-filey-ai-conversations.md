# Filey AI conversation refinement

New chats offer four quiet starter actions: draft an invoice, review payments, summarize the workspace, or attach a file. Text suggestions prepare editable wording and never start a request. The composer stays editable while Filey works, so a user can prepare a follow-up without closing the keyboard. That draft survives successful replies, failures and Stop; it is never queued or sent automatically. Files and execution preferences remain locked during the current task.

Conversations can be renamed without losing the manual title on the next reply. History search includes message contents. Transcript export uses the existing private desktop/browser/mobile file handoff. Deleting a conversation asks for confirmation and does not delete business records. Failed clipboard operations show a useful fallback instead of silently doing nothing.

History parsing salvages readable conversations and rejects unsafe persisted output references. A malformed or unreadable source cannot be silently overwritten. Explicit recovery backs up the exact original in the same account/workspace/storage-mode scope before rewriting readable entries. A different existing recovery backup is preserved rather than replaced. Recovery may fail if device storage is blocked or full; the current conversation can still be exported. Browser-generated private output URLs are revoked immediately on account/workspace changes, including leaving and returning to the original workspace.

The agent rechecks cancellation and account identity after final text, final tool results and late transport failures. Stop can no longer declare a cancelled task completed or exhausted at those boundaries. Confirmed actions remain recorded as stopped rather than disappearing. These checks stop further execution; they do not undo completed business operations or promise to cancel an already-running external provider request.

Managed insufficient-Coin failures retain the exact safe recharge guidance. The UI recognizes the real terminal failure, including its known explanatory suffix, offers Add Coin and restores an unexecuted request when no follow-up was typed. It does not prefill a replay after an earlier action. Arbitrary provider diagnostics are not treated as trusted wallet messages.

The quotation RPC now requires a positive safe saved record ID, and updates require the expected ID. Quote and purchase-order tools return their confirmed saved IDs. A missing, malformed or lost acknowledgement is reported as uncertain and unsafe to retry automatically. Existing invoice and purchase-order transaction receipt validation stays in place.

Default Filey AI remains Fast with reasoning off. Model, pricing, schema and desktop updater version are unchanged. Verification uses mocked providers, transports and records; no paid inference, customer writes or outbound messages are required.
