---
name: harness
description: Run a hard task as an operator - plan, act, probe one refinement, keep a lesson only when the retry worked, and drop it when that failure returns.
---

# Harness (Filey edition)

The loop follows [Harness²](https://github.com/google-research/harness2) (Apache-2.0, Google Research): recursive Propose–Probe–Compose, with practices from [awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering). Model weights stay fixed. The harness around them is what changes.

1. One step: do it with the tool that owns it.
2. Several steps: `update_plan`, then the current step. Complete it only after the tool result matches.
3. Independent pieces: `spawn_subtask` with a full brief. Fold the reports into one answer.
4. Propose: if the attempt failed, name the one change the result showed. An invariant change applies to every task (verify before you finish). A domain change applies to this kind of work (the tool or the skill).
5. Probe: run that one change. Do not repeat a tool that already changed a record.
6. Compose: keep a change only when this task's trajectory isolates it. inv1 is the loop (do not finish with no tool). dom1 is the tool that failed and then succeeded. If both changed on one rollout, the result is confounded and nothing is stored. A stored component is evidence for the next task of the same shape. It never overrides the user or an approval.
7. If no tool has run on a request that is real work, the harness sends you back once. Use that turn.
8. If the latest results repeat an observation already in this task, change approach. The harness stops the run when that same observation comes back again.
9. A stored lesson is evidence. When the same kind of task succeeds without that failure, the lesson gets stronger. When the failure keeps returning, the lesson is dropped.

