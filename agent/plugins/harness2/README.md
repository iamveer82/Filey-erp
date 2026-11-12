# Harness² for Filey

Adapted from [google-research/harness2](https://github.com/google-research/harness2)
(Apache-2.0), the recursive agent-harnessing framework. This is an independent
implementation of the two ideas that matter for a personal agent:

- **Task-level recursion** — one turn is a small Propose–Probe–Compose step. The
  agent proposes a correction (the retry), probes it on the real task, and the
  trajectory shows whether it worked. Only a **single isolated change** counts:
  one corrected argument, or one different tool after a failure. Two changes are
  confounded and produce no lesson.
- **Harnessing-level recursion** — a persistent improvement harness. Lessons are
  domain-scoped, carry their evidence, and gain or lose confidence as later tasks
  succeed or hit the same failure again. Low-confidence lessons that keep failing
  are deleted.

The model weights never change. The harness does.

## What the agent sees

At the start of a turn the plugin appends up to three matching lessons to the
**current user message** (the same cache-safe channel as memory prefetch). It never
rewrites the system prompt or the past conversation, so the prompt cache stays
warm. After a failing tool call it appends one short probe to that tool result:
change one thing before retrying.

The blocks are explicitly labelled as data from earlier tasks, not instructions,
and never override an approval, a later user instruction, or a safety rule.

## Storage

`~/.filey-agent/harness/library.json` for the active profile. Profile-scoped by
construction, so one profile's lessons cannot steer another.

## Commands

- `/harness` or `/harness status` — summary
- `/harness list [domain]` — lessons with their evidence
- `/harness forget <id>` — delete one
- `/harness clear yes` — delete all
- `/harness export` — JSON
- `filey harness …` — the same from a terminal

## Safety

- A lesson containing a credential, a URL/email, or an approval-bypass phrase is
  rejected.
- Guardrails are not an editable component.
- Writes happen only after the turn, never mid-turn.
- A clean task with no contrast writes nothing (NO_ENTRY).
