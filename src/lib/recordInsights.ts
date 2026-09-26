import { localYmd } from "./format";

/** Count records without mixing currencies or inventing missing dates. */
export function recordInsights<T>(
  rows: readonly T[],
  category: (row: T) => string | null | undefined,
  date: ((row: T) => string | null | undefined) | undefined,
  months = 6,
  now = new Date()
) {
  const counts = new Map<string, number>();
  const trend = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - months + i + 1, 1);
    return {
      name: d.toLocaleDateString("en", { month: "short", year: "2-digit" }),
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      count: 0,
    };
  });
  let undated = 0;
  for (const row of rows) {
    const label = category(row)?.trim() || "Unassigned";
    counts.set(label, (counts.get(label) || 0) + 1);
    if (date) {
      const raw = date(row);
      if (
        !raw ||
        !/^\d{4}-\d{2}-\d{2}/.test(raw) ||
        !Number.isFinite(Date.parse(raw)) ||
        new Date(raw.slice(0, 10) + "T12:00:00Z").toISOString().slice(0, 10) !==
          raw.slice(0, 10)
      ) {
        undated++;
        continue;
      }
      // Preserve business dates; timestamps follow the user's calendar month.
      const key = (raw.length === 10 ? raw : localYmd(new Date(raw))).slice(0, 7);
      const bucket = trend.find((b) => b.key === key);
      if (bucket) bucket.count++;
    }
  }
  const groups = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const distribution =
    groups.length > 8
      ? [
          ...groups.slice(0, 7),
          {
            name: "Remaining categories",
            count: groups.slice(7).reduce((n, g) => n + g.count, 0),
          },
        ]
      : groups;
  return { distribution, trend, undated };
}
