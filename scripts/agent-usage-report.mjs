#!/usr/bin/env node
// Filey Agent token report from the engine's own log, and a gate after real use.
//
//   npm run agent:usage                       report since yesterday
//   npm run agent:usage -- --since 2026-10-30 --max-avg-input 30000 --max-first-input 20000
//
// Exits 1 when a --max-* limit is crossed, so a release check can run it after a few real tasks.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const since = flag("since", yesterday);
const home = flag("home", join(process.env.APPDATA ?? "", "com.iamvi.filey-erp", "filey-agent"));
const log = join(home, "logs", "agent.log");
if (!existsSync(log)) {
  console.error(`No engine log at ${log}. Pass --home <Filey Agent home>.`);
  process.exit(2);
}

const lines = readFileSync(log, "utf8").split(/\r?\n/).filter(line => line.slice(0, 10) >= since);
const calls = [];
const tools = new Map();
const errors = new Map();
for (const line of lines) {
  // The Filey AI (Coins) route reports no cache counts, so `cache=` is optional.
  const call = line.match(/API call #(\d+): .* in=(\d+) out=(\d+) .* latency=([\d.]+)s(?: cache=(\d+)\/\d+)?/);
  if (call) calls.push({ n: +call[1], input: +call[2], output: +call[3], latency: +call[4], cached: +(call[5] ?? 0) });
  const tool = line.match(/tool (\S+) completed \([\d.]+s, (\d+) chars\)/);
  if (tool) {
    const row = tools.get(tool[1]) ?? { count: 0, chars: 0 };
    tools.set(tool[1], { count: row.count + 1, chars: row.chars + +tool[2] });
  }
  const failed = line.match(/Tool (\S+) returned error/);
  if (failed) errors.set(failed[1], (errors.get(failed[1]) ?? 0) + 1);
}

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const avg = (rows, key) => (rows.length ? Math.round(sum(rows, key) / rows.length) : 0);
const first = calls.filter(call => call.n === 1);
const report = {
  since,
  model_calls: calls.length,
  avg_input_tokens: avg(calls, "input"),
  avg_first_call_input_tokens: avg(first, "input"),
  max_input_tokens: calls.reduce((max, call) => Math.max(max, call.input), 0),
  cached_pct: calls.length ? Math.round((100 * sum(calls, "cached")) / Math.max(1, sum(calls, "input"))) : 0,
  avg_output_tokens: avg(calls, "output"),
  avg_latency_s: calls.length ? +(sum(calls, "latency") / calls.length).toFixed(2) : 0,
  largest_tool_outputs: [...tools].sort((a, b) => b[1].chars - a[1].chars).slice(0, 6)
    .map(([name, row]) => `${name}: ${row.count}x, avg ${Math.round(row.chars / row.count)} chars`),
  tool_errors: Object.fromEntries([...errors].sort((a, b) => b[1] - a[1]).slice(0, 6)),
};
console.log(JSON.stringify(report, null, 2));

const limits = [
  ["max-avg-input", report.avg_input_tokens, "average input tokens per call"],
  ["max-first-input", report.avg_first_call_input_tokens, "average first-call input tokens"],
];
let failed = false;
for (const [name, value, label] of limits) {
  const limit = Number(flag(name, ""));
  if (limit && value > limit) {
    console.error(`Over budget: ${label} ${value} > ${limit}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
