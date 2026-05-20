import * as React from "react";
import { format, setMonth, setYear } from "date-fns";
import { X } from "lucide-react";
import Calendar from "./Calendar";

/** Multi-date picker with year + month dropdowns, a calendar grid,
 *  pill list of picked days, and a Confirm action. Filey-themed,
 *  no shadcn deps — uses .select / .pill / .btn-* tokens. */
export function MultiDatePicker({
  value,
  onChange,
  onConfirm,
  className = "",
}: {
  value?: Date[];
  onChange?: (dates: Date[]) => void;
  onConfirm?: (dates: Date[]) => void;
  className?: string;
}) {
  const today = new Date();
  const isControlled = value !== undefined;
  const [internal, setInternal] = React.useState<Date[]>(value ?? []);
  const selected = isControlled ? value! : internal;
  const setSelected = (next: Date[]) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  const [month, setMonthState] = React.useState(today.getMonth());
  const [year, setYearState] = React.useState(today.getFullYear());
  const displayMonth = setMonth(setYear(today, year), month);

  const handleRemove = (date: Date) => {
    const k = format(date, "yyyy-MM-dd");
    setSelected(selected.filter((d) => format(d, "yyyy-MM-dd") !== k));
  };

  const years = React.useMemo(
    () => Array.from({ length: 50 }, (_, i) => today.getFullYear() - 25 + i),
    [today]
  );

  return (
    <div className={`card !p-4 w-full max-w-md flex flex-col gap-4 ${className}`}>
      {/* Year + Month dropdowns */}
      <div className="flex gap-2">
        <select
          aria-label="Year"
          className="select flex-1"
          value={year}
          onChange={(e) => setYearState(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          aria-label="Month"
          className="select flex-1"
          value={month}
          onChange={(e) => setMonthState(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i}>
              {format(new Date(2000, i, 1), "MMMM")}
            </option>
          ))}
        </select>
      </div>

      {/* Calendar */}
      <Calendar
        mode="multiple"
        selected={selected}
        onSelect={(dates) => setSelected(dates ?? [])}
        month={displayMonth}
        onMonthChange={(date) => {
          setMonthState(date.getMonth());
          setYearState(date.getFullYear());
        }}
      />

      {/* Selected dates pills */}
      <div className="flex flex-wrap gap-2">
        {selected.length === 0 && (
          <p className="text-xs text-brand-400">No dates selected</p>
        )}
        {selected
          .slice()
          .sort((a, b) => a.getTime() - b.getTime())
          .map((d) => (
            <span
              key={d.toISOString()}
              className="pill bg-brand-100 text-ink inline-flex items-center gap-1.5 pr-1"
            >
              {format(d, "PPP")}
              <button
                aria-label={`Remove ${format(d, "PPP")}`}
                onClick={() => handleRemove(d)}
                className="grid h-4 w-4 place-items-center rounded-full text-brand-400 hover:text-danger hover:bg-danger/10 cursor-pointer transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
      </div>

      {/* Confirm */}
      <div className="flex justify-end">
        <button
          className="btn-primary"
          onClick={() => onConfirm?.(selected)}
          disabled={selected.length === 0}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

export default MultiDatePicker;
