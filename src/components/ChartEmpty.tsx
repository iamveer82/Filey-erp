/** Recharts draws a full axis grid for an empty or all-zero series: bars with
 *  no height, a line pinned flat to the baseline, a pie with no slices. On a
 *  fresh workspace that reads as a broken chart rather than an empty one, so
 *  show this in place of the chart instead. */
export default function ChartEmpty({ hint }: { hint: string }) {
  return (
    <div className="grid h-full place-items-center px-4 text-center">
      <div>
        <p className="text-[13px] font-medium text-foreground">Nothing to chart yet</p>
        <p className="mt-1 max-w-[34ch] text-[12px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** True when every row is zero (or the series is empty) across the given keys,
 *  which is the case Recharts renders as an axis grid with nothing in it. */
export function allZero<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  ...keys: (keyof T)[]
): boolean {
  if (!rows || rows.length === 0) return true;
  return !rows.some((r) => keys.some((k) => Number(r[k]) > 0));
}
