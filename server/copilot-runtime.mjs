/* CopilotKit runtime — lightweight local Express server.
 * Reads provider config from the running Filey client via the
 * X-Filey-AI-Config header (base64 JSON). Keeps API keys in the browser,
 * this server only proxies the request so CopilotKit can stream function
 * calling. */
import express from "express";
import cors from "cors";
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";

const app = express();
app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Filey-AI-Config"] }));
app.use(express.json({ limit: "2mb" }));

const runtime = new CopilotRuntime();

app.post("/copilotkit", async (req, res) => {
  try {
    const cfgHeader = req.headers["x-filey-ai-config"];
    const cfg = cfgHeader ? JSON.parse(Buffer.from(String(cfgHeader), "base64").toString("utf8")) : {};
    const baseUrl = cfg.baseUrl || "https://api.openai.com/v1";
    const apiKey = cfg.apiKey || process.env.OPENAI_API_KEY;
    const model = cfg.model || "gpt-4o-mini";
    if (!apiKey) {
      res.status(400).json({ error: "No AI key provided. Add it in Settings → AI Assistant." });
      return;
    }
    const serviceAdapter = new OpenAIAdapter({ apiKey, baseURL: baseUrl, model });
    const { stream } = await runtime.stream(req.body, serviceAdapter);
    res.setHeader("Content-Type", "application/vnd.openai.functions");
    res.setHeader("Transfer-Encoding", "chunked");
    for await (const chunk of stream) {
      res.write(JSON.stringify(chunk));
    }
    res.end();
  } catch (e) {
    console.error("CopilotKit runtime error:", e);
    res.status(500).json({ error: e instanceof Error ? e.message : "Runtime error" });
  }
});

const PORT = process.env.COPILOTKIT_PORT || 4000;
app.listen(PORT, () => console.log(`[Filey CopilotKit] http://localhost:${PORT}/copilotkit`));
