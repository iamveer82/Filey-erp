import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allTools } from "./tools.js";
import { getCtx } from "./client.js";
import { pilotFailure, pilotPolicy, pilotToolModules } from "./pilot.js";

// IMPORTANT: every log line goes to stderr. stdout is reserved for JSON-RPC.
const server = new McpServer({
  name: "filey-erp",
  version: "0.1.0",
});

// Standard MCP keeps lazy auth and all existing tools. The explicitly opted-in
// pilot registers only reviewed reads and verifies its binding before connect.
const registeredTools = pilotPolicy ? allTools.filter(tool => Object.hasOwn(pilotToolModules, tool.name)) : allTools;
for (const tool of registeredTools) {
  server.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
    let result: unknown;
    if (pilotPolicy) {
      try {
        const ctx = await getCtx();
        await pilotPolicy.authorize(ctx, tool.name);
        result = await tool.handler(args);
        await pilotPolicy.authorize(ctx, tool.name);
        if (result && typeof result === "object" && "error" in result) result = pilotFailure();
      } catch { result = pilotFailure(); }
    } else result = await tool.handler(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      ...(pilotPolicy && result && typeof result === "object" && "error" in result ? { isError: true } : {}),
    };
  });
}

async function main(): Promise<void> {
  // Refuse a misbound pilot before completing the MCP handshake/list operation.
  if (pilotPolicy) await getCtx();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[filey-erp-mcp] filey-erp v0.1.0 running on stdio (${registeredTools.length} tools registered${pilotPolicy ? ", restricted Hermes pilot" : ""})`);
}

main().catch((err) => {
  console.error(`[filey-erp-mcp] fatal: ${pilotPolicy ? pilotFailure().error : err?.message ?? err}`);
  process.exit(1);
});
