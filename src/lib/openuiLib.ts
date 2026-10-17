/* Filey AI draws rich answers with OpenUI (github.com/thesysdev/openui, MIT): the model
 * writes OpenUI Lang in show_openui and the chat renders it with OpenUI's own chat
 * component library (OpenUiRender.tsx).
 *
 * The guide teaches a business subset of that library; rendering keeps the whole of
 * it, so a component the model reaches for anyway still draws. The guide is generated
 * from the library and kept as text in openuiGuide.ts, so the agent's prompt never
 * loads React components (openui-guide.test.ts keeps the two in step).
 *
 * OpenUI's own prompt rules tell the model to invent plausible data; Filey's rules
 * replace them: every figure comes from Filey's tools or the user. */
import { createLibrary, createParser } from "@openuidev/react-lang";
// From the main bundle, not "/genui-lib": that entry carries its own theme context, so the
// ThemeProvider in OpenUiRender (palette, dark mode) would never reach its components.
import { openuiChatLibrary } from "@openuidev/react-ui";

export const openuiRenderLibrary = openuiChatLibrary;

/** The components the guide teaches. */
export const OPENUI_TAUGHT = [
  "Card", "CardHeader", "TextContent", "Callout", "Table", "Col",
  "BarChart", "LineChart", "AreaChart", "HorizontalBarChart", "Series", "PieChart", "Slice",
  "Buttons", "Button", "ListBlock", "ListItem", "FollowUpBlock", "FollowUpItem",
  "Steps", "StepsItem", "TagBlock", "Tag", "Tabs", "TabItem",
];

const PREAMBLE = [
  "OPENUI — when an answer reads better drawn (numbers to compare, a trend, shares of a total, exact rows, a plan, options), call show_openui with an OpenUI Lang program in `program`.",
  "Your text reply stays short plain prose beside the card; never write OpenUI Lang in the text itself.",
].join(" ");

const FILEY_RULES = [
  "Use only figures from Filey's tools or the user. Never invent, estimate or pad data to fill a chart or table; if something is missing, say so in a TextContent or Callout.",
  "One Card per call: CardHeader first, then the content, and a FollowUpBlock last with 2-3 next steps the user can ask Filey.",
  "Put the currency or unit in the column label or series name, e.g. \"Revenue (AED)\"; values are plain numbers.",
  "BarChart compares, LineChart or AreaChart shows a trend over time, PieChart shows shares of one total, Table gives exact rows, Steps a process, Tag a status.",
  "Buttons, list items and follow-ups send their text back to Filey (@ToAssistant). Use @OpenUrl only for a link that came from a tool result.",
];

const FILEY_EXAMPLE = [
  'root = Card([header, chart, table, note, next])',
  'header = CardHeader("Sales by month", "Paid invoices, AED")',
  'chart = BarChart(["Jul", "Aug", "Sep"], [s1])',
  's1 = Series("Revenue (AED)", [41200, 38950, 52300])',
  'table = Table([c1, c2, c3])',
  'c1 = Col("Month", ["Jul", "Aug", "Sep"])',
  'c2 = Col("Invoices", [18, 16, 22], "number")',
  'c3 = Col("Revenue (AED)", [41200, 38950, 52300], "number")',
  'note = Callout("info", "September is up 34%", "Two large orders from Rennox Lubricants.")',
  'next = FollowUpBlock([f1, f2])',
  'f1 = FollowUpItem("Show September\'s invoices")',
  'f2 = FollowUpItem("Compare with last year")',
].join("\n");

/** The OPENUI guide text for the agent's prompt (stored in openuiGuide.ts). */
export function buildOpenUiGuide(): string {
  const all = openuiChatLibrary.components as Record<string, unknown>;
  const taught = createLibrary({
    components: OPENUI_TAUGHT.map((name) => all[name]) as Parameters<typeof createLibrary>[0]["components"],
    root: "Card",
  });
  const raw = taught.prompt({ preamble: PREAMBLE, additionalRules: FILEY_RULES, examples: [FILEY_EXAMPLE] });
  // Card and TabItem list every chat component as children; name only the taught ones.
  return raw.replace(/\((?:[A-Z]\w* \| )+[A-Z]\w*\)/g, (union) => {
    const kept = union.slice(1, -1).split(" | ").filter((type) => OPENUI_TAUGHT.includes(type));
    return kept.length ? `(${kept.join(" | ")})` : union;
  });
}

let parser: ReturnType<typeof createParser> | null = null;

/** What would stop a program from rendering as written, for the model to fix; [] when it is fine. */
export function openUiProblems(program: string): string[] {
  parser ??= createParser(openuiChatLibrary.toJSONSchema(), "Card");
  const result = parser.parse(program);
  const problems: string[] = [];
  if (!result.root) problems.push("No root = Card([...]) statement was found.");
  if (result.meta.incomplete) problems.push("The program looks cut off; send it complete.");
  if (result.meta.unresolved.length) problems.push(`Used but never defined: ${result.meta.unresolved.join(", ")}.`);
  if (result.meta.orphaned.length) problems.push(`Defined but not reachable from root, so not shown: ${result.meta.orphaned.join(", ")}.`);
  for (const error of result.meta.errors.slice(0, 10))
    problems.push(`${error.statementId ? `${error.statementId} (${error.component})` : error.component}: ${error.message}`);
  return problems;
}
