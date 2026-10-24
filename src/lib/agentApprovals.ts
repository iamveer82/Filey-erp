/* Review queue for background agent work.
 *
 * A scheduled automation or a watch runs with nobody at the screen. Its
 * sensitive actions (money, sending to customers) used to be refused outright,
 * so an always-on agent could notice an overdue invoice but never finish the
 * job. Now the exact action is saved here and the run carries on. Nothing in
 * the queue runs until a person presses Approve, and then it runs once, with
 * the saved arguments, through the same runTool checks as any chat action
 * (module access, capability switches, agent mode).
 *
 * Requests expire after three days: an old payment or message is more likely
 * wrong than useful. Account data, stored with the agent's other state. */
import type { ConfirmFn } from "./aiTools";
import { agentStorageScope, readAgentStorage, requireAgentStorageScope, writeAgentStorage } from "./agentStorage";
import { notifyOwner } from "./alwaysOn";

const KEY = "filey.agent.approvals";
const KEEP = 60;
const EXPIRES_MS = 3 * 24 * 60 * 60 * 1000;
/** A request still "running" this long after approval was cut off (Filey closed). */
const STUCK_MS = 5 * 60 * 1000;

export type ApprovalStatus = "pending" | "running" | "done" | "failed" | "rejected" | "expired";
export interface ApprovalRequest {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** The automation that asked. */
  source: { id: string; name: string };
  at: number;
  status: ApprovalStatus;
  decidedAt?: number;
  /** What happened when it ran, or why it did not. */
  result?: string;
}

/** Arguments the current runTool call parked in the queue (same object identity). */
const parked = new WeakSet<object>();
export const wasParked = (args: object): boolean => parked.has(args);

function load(): ApprovalRequest[] {
  try {
    const rows: unknown = JSON.parse(readAgentStorage(KEY) ?? "[]");
    return Array.isArray(rows)
      ? rows.filter((row): row is ApprovalRequest => !!row && typeof row.id === "string" && typeof row.tool === "string" &&
          !!row.args && typeof row.args === "object" && !!row.source && typeof row.status === "string")
      : [];
  } catch {
    return [];
  }
}

function save(rows: ApprovalRequest[], scope: string): void {
  writeAgentStorage(KEY, JSON.stringify(rows.slice(-KEEP)), scope);
}

const signature = (tool: string, args: Record<string, unknown>) => `${tool}:${JSON.stringify(args)}`;

/** One line a person can check before approving: tool and its arguments. */
export function describeRequest(tool: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  const text = `${tool.replace(/_/g, " ")}${parts.length ? ` - ${parts.join(", ")}` : ""}`;
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

/** Settle requests that can no longer be acted on, and return the list. */
export function approvalRequests(now = Date.now()): ApprovalRequest[] {
  const rows = load();
  let changed = false;
  const settled = rows.map(row => {
    if (row.status === "pending" && now - row.at > EXPIRES_MS) {
      changed = true;
      return { ...row, status: "expired" as const, decidedAt: now, result: "Not approved within three days." };
    }
    if (row.status === "running" && now - (row.decidedAt ?? row.at) > STUCK_MS) {
      changed = true;
      return { ...row, status: "failed" as const, result: "Filey closed while this was running. Check whether it happened before doing it again." };
    }
    return row;
  });
  const scope = agentStorageScope();
  if (changed && scope) save(settled, scope);
  return settled;
}

export const pendingApprovals = (): ApprovalRequest[] => approvalRequests().filter(row => row.status === "pending");

/** Pending requests, oldest first, read-only (safe during render: never writes). */
export const pendingApprovalSnapshot = (now = Date.now()): ApprovalRequest[] =>
  load().filter(row => row.status === "pending" && now - row.at <= EXPIRES_MS);

/** Read-only count for badges. */
export const pendingApprovalCount = (now = Date.now()): number => pendingApprovalSnapshot(now).length;

/** When a queued request lapses. */
export const approvalExpiresAt = (request: ApprovalRequest): number => request.at + EXPIRES_MS;

/** The approval policy for an unattended run: park sensitive actions for a person. */
export function parkForApproval(source: { id: string; name: string }): ConfirmFn {
  return (tool, args) => {
    const scope = agentStorageScope();
    if (!scope) return false;
    const rows = approvalRequests();
    const sig = signature(tool, args);
    // The same action proposed again (next heartbeat, a retry) is one request.
    if (!rows.some(row => row.status === "pending" && signature(row.tool, row.args) === sig)) {
      const request: ApprovalRequest = {
        id: `ok_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        tool, args: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
        source, at: Date.now(), status: "pending",
      };
      save([...rows, request], scope);
      void notifyOwner("Filey needs your OK", `${source.name}: ${describeRequest(tool, args)}`);
    }
    parked.add(args);
    return false;
  };
}

/** Approve (runs the saved action once) or reject a pending request. */
export async function decideApproval(id: string, approve: boolean): Promise<ApprovalRequest> {
  const scope = requireAgentStorageScope();
  const rows = approvalRequests();
  const request = rows.find(row => row.id === id);
  if (!request) throw new Error("That request is no longer in the queue.");
  if (request.status !== "pending") throw new Error(`That request was already ${request.status}.`);
  let current = request;
  const update = (patch: Partial<ApprovalRequest>) => {
    current = { ...current, ...patch };
    save(approvalRequests().map(row => (row.id === id ? current : row)), scope);
    return current;
  };
  if (!approve) return update({ status: "rejected", decidedAt: Date.now() });
  // Claimed before running: a second click or another window finds it taken.
  update({ status: "running", decidedAt: Date.now() });
  try {
    const { runTool } = await import("./aiTools");
    // Approval covers this tool with these arguments, nothing else.
    const out = await runTool(request.tool, request.args, name => name === request.tool, false, undefined, undefined, undefined, `automation:${request.source.id}`);
    const error = out && typeof out === "object" && "error" in out ? String((out as { error: unknown }).error) : "";
    const text = error || (typeof out === "string" ? out : JSON.stringify(out ?? "Done."));
    requireAgentStorageScope(scope);
    return update({ status: error ? "failed" : "done", result: text.length > 300 ? `${text.slice(0, 297)}...` : text });
  } catch (error) {
    if (agentStorageScope() === scope)
      update({ status: "failed", result: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
