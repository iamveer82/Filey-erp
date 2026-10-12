import { useEffect, useState } from "react";
import { getAgentTaskStatus } from "./agentTaskStatus";

export function useAgentTaskStatus(taskId?: string) {
  const [status, setStatus] = useState<{ status?: string; error?: string | null } | null>(null);
  useEffect(() => {
    if (!taskId) return;
    let alive = true;
    const tick = async () => {
      const row = await getAgentTaskStatus(taskId);
      if (alive) setStatus(row as any);
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [taskId]);
  return status;
}