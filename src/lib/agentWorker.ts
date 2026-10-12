import { runNextTask } from "./agentRunner";

export async function runWorkerLoop(worker: string, kinds: string[], handler: (task: {
  id: string;
  task_type: string;
  user_id: string;
  input: Record<string, unknown>;
}) => Promise<Record<string, unknown>>, tickMs = 5000, iterations = 0) {
  let count = 0;
  // ponytail: simple polling worker; switch to queue-triggered scheduling if throughput matters.
  while (iterations === 0 || count < iterations) {
    const did = await runNextTask(worker, kinds, handler);
    count += did ? 1 : 0;
    if (!did) await new Promise((r) => setTimeout(r, tickMs));
  }
}