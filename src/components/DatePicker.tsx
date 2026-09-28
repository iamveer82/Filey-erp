/* ── DatePicker (typeable input + FancyCalendar dropdown) ─────────
 * Editable date field: type a date (dd/mm/yyyy and common variants) OR click
 * the calendar icon to pick from the dropdown. Displays dd/MM/yyyy. Pass
 * `value` (Date) + `onChange`. For string (yyyy-mm-dd) forms use the
 * `DateField` wrapper below — a drop-in for <input type="date">. */
import * as React from "react";
import { format, parse, isValid, startOfDay } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";
import { Calendar } from "./FancyCalendar";
import { cn } from "../lib/format";

const DISPLAY = "dd/MM/yyyy";
const PARSE_FORMATS = [
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "dd.MM.yyyy",
  "yyyy-MM-dd",
  "dd MMM yyyy",
  "d MMM yyyy",
];

function parseDate(text: string): Date | undefined {
  // Accept compact entry, but only add separators once editing is finished.
  const s = text.trim().replace(/^(\d{2})(\d{2})(\d{4})$/, "$1/$2/$3");
  if (!/\b\d{4}\b/.test(s)) return undefined;
  for (const f of PARSE_FORMATS) {
    const d = parse(s, f, new Date());
    if (isValid(d)) return d;
  }
  return undefined;
}

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** When true, the calendar popover shows a "Clear date" button. */
  clearable?: boolean;
  /** Min date selectable. */
  minDate?: Date;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "dd/mm/yyyy",
  className,
  disabled,
  clearable = true,
  minDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const formattedValue = value ? format(value, DISPLAY) : "";
  const [text, setText] = React.useState(formattedValue);

  // DateField creates Date objects on every render; only reset for a new day.
  React.useEffect(() => {
    setText(formattedValue);
  }, [formattedValue]);

  // Commit a typed value: parse it, or revert to the last valid date.
  const commit = () => {
    if (text.trim() === "") {
      onChange(undefined);
      return;
    }
    const d = parseDate(text);
    if (d && (!minDate || d >= startOfDay(minDate))) {
      onChange(d);
      setText(format(d, DISPLAY));
    } else {
      setText(formattedValue);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <input
        className="input pr-9"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-brand-400 transition-colors hover:bg-brand-100 hover:text-ink disabled:opacity-50 dark:hover:bg-white/10"
          >
            <CalendarIcon size={15} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="!w-auto !border-0 !bg-transparent !p-0 !shadow-none"
        >
          <Calendar
            size="sm"
            selected={value}
            onSelect={(d) => {
              onChange(d);
              setOpen(false);
            }}
            disabled={minDate ? (d) => d < startOfDay(minDate) : undefined}
          />
          {clearable && value && (
            <button
              type="button"
              className="mt-1.5 w-full rounded-full py-1.5 text-center text-xs font-medium text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Clear date
            </button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ── DateField — string (yyyy-mm-dd) wrapper, drop-in for <input type="date"> ── */
const toDate = (s?: string) => {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00`);
  return isValid(d) ? d : undefined;
};
const toStr = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : "");

export interface DateFieldProps {
  value?: string; // yyyy-mm-dd
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Min date (yyyy-mm-dd). */
  min?: string;
}

export function DateField({ value, onChange, min, ...rest }: DateFieldProps) {
  return (
    <DatePicker
      value={toDate(value)}
      onChange={(d) => onChange(toStr(d))}
      minDate={toDate(min)}
      {...rest}
    />
  );
}

/** Date range variant — two single pickers, optional. */
export interface DateRangePickerProps {
  from?: Date;
  to?: Date;
  onFromChange: (d: Date | undefined) => void;
  onToChange: (d: Date | undefined) => void;
  className?: string;
  disabled?: boolean;
}

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  className,
  disabled,
}: DateRangePickerProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <DatePicker
        value={from}
        onChange={onFromChange}
        placeholder="From"
        disabled={disabled}
        clearable={false}
      />
      <span className="text-xs text-brand-400">→</span>
      <DatePicker
        value={to}
        onChange={onToChange}
        placeholder="To"
        disabled={disabled}
        minDate={from}
      />
    </div>
  );
}
