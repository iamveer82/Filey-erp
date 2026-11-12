const r2 = (n: number) => Math.round(n * 100) / 100;

export const daysInMonth = (month: string) =>
  /^\d{4}-\d{2}$/.test(month) ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 30;

/** Unpaid leave comes off pro rata: basic ÷ days in the month × unpaid days. */
export const leaveDeduction = (basic: number, unpaidDays: number, month: string) =>
  r2(basic / daysInMonth(month) * Math.min(Math.max(0, unpaidDays), daysInMonth(month)));
