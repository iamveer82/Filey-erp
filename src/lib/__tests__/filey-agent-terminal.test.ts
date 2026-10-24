import { expect, it } from "vitest";
import { FileyAgentClient, FileyAgentRpcError, type AgentTransport } from "../fileyAgent";

// The terminal tab speaks Hermes' own command protocol: slash.exec first, and
// command.dispatch for skills and the commands it hands back (error 4018).
function engine(handle: (method: string, params: Record<string, unknown>) => { result?: unknown; error?: { code: number; message: string } }) {
  const subs = new Set<(line: string) => void>();
  const transport: AgentTransport = {
    send(line) {
      const frame = JSON.parse(line);
      const reply = handle(frame.method, frame.params ?? {});
      subs.forEach(cb => cb(JSON.stringify({ jsonrpc: "2.0", id: frame.id, ...reply })));
    },
    onLine(cb) { subs.add(cb); return () => subs.delete(cb); },
  };
  return new FileyAgentClient(transport);
}

it("carries the engine's error code so a skill command can be dispatched instead", async () => {
  const client = engine(method => method === "slash.exec"
    ? { error: { code: 4018, message: "skill command: use command.dispatch for /invoice-chaser" } }
    : { result: { type: "skill", name: "invoice-chaser", message: "Run the invoice chaser skill" } });
  const failure: unknown = await client.request("slash.exec", { command: "/invoice-chaser" }).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(FileyAgentRpcError);
  expect((failure as FileyAgentRpcError).code).toBe(4018);
  await expect(client.request("command.dispatch", { name: "invoice-chaser" })).resolves.toMatchObject({ type: "skill" });
});
