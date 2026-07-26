import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allTools } from "./tools.js";

// IMPORTANT: every log line goes to stderr. stdout is reserved for JSON-RPC.
const server = new McpServer({
  name: "filey-erp",
  version: "0.1.0",
});

// Register ALL tools before any env or network access — getCtx() stays lazy and
// only runs when a tool is actually invoked.
for (const tool of allTools) {
  server.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
    const result = await tool.handler(args);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[filey-erp-mcp] filey-erp v0.1.0 running on stdio (${allTools.length} tools registered)`);
}

main().catch((err) => {
  console.error(`[filey-erp-mcp] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
