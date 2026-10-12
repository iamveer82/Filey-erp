# Filey AI Agent — Professional Architecture (target v4)

## Goal
Reliable personal-finance assistant: conversational + task-executing, working for users across app and WhatsApp, with deterministic accounting flows (invoice, expenses, reconciliation) and recoverable state.

## Layers
1. Channels: Web/WhatsApp app → Channel Adapters → Event Bus.
2. Orchestrator: conversation state machine + task queue + supervisor.
3. Agent Runtime: policy -> planner -> tool executor (sandboxed).
4. Capability Tools: finance domain APIs, DB, file/export, reminders.
5. Data: Postgres/Supabase tables + audit log + per-user context store.
6. Observability: logs/traces, retries, dead-letter.

## Core responsibilities
- Conversation turns never control critical calls directly.
- Tasks = idempotent workflow definitions with explicit states: queued -> running -> done/failed, and retry with backoff.
- Channel messages converted to a normalized `AgentEvent` (user, company, kind, payload, idempotency_key).
- Tool calls use a `ToolRunner` with timeouts, permission gates, input validation, rollback hooks.
- Financial operations are recorded in an immutable `journal_events` with compensating transactions.
- WhatsApp connected via dedicated bridge + webhook/WS; no UI-coupled state.

## Data model additions
- `agent_threads (id, user_id, channel, metadata, created_at)`
- `agent_events (id, thread_id, event_type, payload_json, idempotency_key, processed_at)`
- `agent_tasks (id, thread_id, task_type, status, attempts, next_run_at, result_json)`
- `agent_tool_calls (id, task_id, tool_name, input_json, output_json, status, elapsed_ms)`
- `journal_events (id, user_id, source_type, source_id, payload_json, created_at)`
- `attachments (id, message_id, storage_path, processing_status)`

## Reliability rules
- All inbound messages deduplicated by `idempotency_key`.
- Task runner claims jobs atomically; exponential backoff with max.
- Tool call retries with idempotency checks; ambiguous side effects go through confirmation.
- Failed jobs land in dead-letter after max attempts.
- Heavy/long work (ocr, pdf, imports) offloaded to async runners.

## Security
- Per-user RLS and scoped credentials.
- No direct channels/API from LLM.
- Tool permissions by task/user role.
- Secrets via vault/env; audit for changes.

## Personal finance capabilities
- ingest bank statements, receipts, transactions
- categorize, dedupe, rule learning
- budget and alerts
- report generation/export
- reminders via messaging

## Increment plan
1. foundation: schema + task runner skeleton
2. channel adapter + normalized events
3. toolrunner and audit logging
4. WhatsApp bridge health + queue
5. finance workflows and tests
6. observability/admin

## First increment (implement now)
- Add database migrations and minimal task runner module.
- Leave UI untouched.

## Success checks
- One runnable self-test per module.
- User-facing status for tasks via thread.
