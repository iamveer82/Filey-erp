# Chat and connection continuity

Changing sections previously unmounted Filey AI, cancelled the active response
and opened a new conversation on return. Switching apps could interrupt the
browser connection while paid provider work continued, discarding its result.

The workspace retains one scoped chat outside route/currency remounts. Replies,
generated files, unsent drafts and pending approvals stay in the same conversation.
A background status offers Return to chat and Stop. Hidden controls, dictation,
media polling and scroll effects pause. Integration drafts arriving during a run
remain editable and apply once without automatic submission.

Cloud Filey AI now dispatches a short authenticated request, keeps inference
running with EdgeRuntime.waitUntil, and records its verified response in the same
transaction as its Coin charge. Reconnection polls the original request UUID.
An unknown receipt permits only idempotent resubmission of that exact UUID and
payload; completed/expired receipts never launch another generation. The worker
has a 120-second provider deadline; interrupted workers release uncertain holds.
No prompt is stored in the response cache. Private results expire after 30 minutes
and the hosted cron job clears expired content each minute. JWT/MFA and current
profile/membership checks protect reads. Local mode does not use this cloud cache.

Same-identity transient network rechecks preserve the already verified chat UI;
fresh tool permission checks still fail closed. Explicit Stop, proven access loss,
account/workspace/mode changes cancel safely. Late results cannot execute tools or
populate another account. BYOK inference POSTs no longer blindly retry ambiguous
network/server failures that could consume paid tokens twice.

This supports section navigation and suspended browser connections while the
existing page resumes. A browser process that is killed/reloaded does not replay
unfinished tools automatically; that requires a separate durable agent checkpoint
workflow. Browser-only/desktop-local tools require the client to resume. No desktop
installer or updater is published by this patch; shared source changes apply to
the next desktop build.

Validation: synthetic browser navigation proof; deferred-stream, Stop, approval,
account isolation, session restoration and reconnect transport regressions;
private SQL receipt concurrency, expiry and atomic settlement checks. Tests do
not call a paid model or modify customer documents.
