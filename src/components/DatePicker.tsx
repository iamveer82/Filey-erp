/* ── DatePicker (typeable input + FancyCalendar dropdown) ─────────
 * Editable date field: type a date (dd/mm/yyyy and common variants) OR click
 * the calendar icon to pick from the dropdown. Displays dd/MM/yyyy. Pass
 * `value` (Date) + `onChange`. For string (yyyy-mm-dd) forms use the
 * `DateField` wrapper below — a drop-in for <input type="date">. */
import * as React from "react";
import { addDays, addMonths, addYears, format, parse, isValid, startOfDay } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";
import { Calendar } from "./FancyCalendar";
import { cn } from "../lib/format";
import { Button } from "./Button";

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

type DateInputProps = Pick<React.InputHTMLAttributes<HTMLInputElement>,
  "id" | "required" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid">;

export interface DatePickerProps extends DateInputProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** When true, the calendar popover shows a "Clear date" button. */
  clearable?: boolean;
  /** Min date selectable. */
  minDate?: Date;
  maxDate?: Date;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "dd/mm/yyyy",
  className,
  disabled,
  clearable = true,
  minDate,
  maxDate,
  required,
  ...inputProps
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const formattedValue = value ? format(value, DISPLAY) : "";
  const [text, setText] = React.useState(formattedValue);
  const [notice, setNotice] = React.useState("");
  const noticeId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const calendarRef = React.useRef<HTMLDivElement>(null);
  const inRange = (date: Date) => (!minDate || date >= startOfDay(minDate)) && (!maxDate || date <= startOfDay(maxDate));

  // DateField creates Date objects on every render; only reset for a new day.
  React.useEffect(() => {
    setText(formattedValue);
    setNotice("");
  }, [formattedValue]);

  React.useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Commit a typed value: parse it, or revert to the last valid date.
  const commit = () => {
    if (inputRef.current?.matches(":disabled")) return;
    if (text === formattedValue) return;
    if (text.trim() === "" && !required) {
      if (value) onChange(undefined);
      setText("");
      setNotice("");
      return;
    }
    const d = parseDate(text);
    if (d && inRange(d)) {
      if (format(d, DISPLAY) !== formattedValue) onChange(d);
      setText(format(d, DISPLAY));
      setNotice("");
    } else {
      setText(formattedValue);
      const guidance = !d ? "Enter a valid date as dd/mm/yyyy."
        : minDate && d < startOfDay(minDate) ? `Choose ${format(minDate, DISPLAY)} or later.`
        : `Choose ${format(maxDate!, DISPLAY)} or earlier.`;
      setNotice(`${guidance}${formattedValue ? ` Kept ${formattedValue}.` : ""}`);
    }
  };

  const choose = (date: Date | undefined) => {
    if (inputRef.current?.matches(":disabled")) { setOpen(false); return; }
    if (date && !inRange(date)) return;
    const next = date ? format(date, DISPLAY) : "";
    if (next !== formattedValue) onChange(date);
    setText(next);
    setNotice("");
    setOpen(false);
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative">
      <input
        {...inputProps}
        ref={inputRef}
        type="text"
        className="input pr-12 tabular-nums"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        spellCheck={false}
        aria-keyshortcuts="Alt+ArrowDown"
        aria-invalid={notice ? true : inputProps["aria-invalid"]}
        aria-describedby={[inputProps["aria-describedby"], notice ? noticeId : undefined].filter(Boolean).join(" ") || undefined}
        onChange={(e) => { setText(e.target.value); setNotice(""); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          } else if (e.key === "Escape") {
            if (text !== formattedValue || notice) {
              e.preventDefault();
              e.stopPropagation();
              setText(formattedValue);
              setNotice("");
            }
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (!e.altKey && !e.ctrlKey && !e.metaKey && ["ArrowUp", "ArrowDown"].includes(e.key) && /^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
            const date = parseDate(text);
            if (!date) return;
            e.preventDefault();
            const caret = e.currentTarget.selectionStart ?? 0;
            const start = caret < 3 ? 0 : caret < 6 ? 3 : 6;
            const step = e.key === "ArrowUp" ? 1 : -1;
            const next = (start === 0 ? addDays : start === 3 ? addMonths : addYears)(date, step);
            if (!inRange(next)) return;
            setText(format(next, DISPLAY));
            setNotice("");
            requestAnimationFrame(() => {
              const input = inputRef.current;
              if (input && document.activeElement === input) input.setSelectionRange(start, start === 6 ? 10 : start + 2);
            });
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Open calendar"
            title="Choose a date (Alt + ↓)"
            className="filey-date-trigger absolute right-0.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarIcon size={16} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          ref={calendarRef}
          align="end"
          collisionPadding={12}
          className="filey-date-popover w-[21rem] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain p-0 shadow-md"
          aria-label="Choose a date"
          onOpenAutoFocus={event => {
            const day = calendarRef.current?.querySelector<HTMLElement>('td button[tabindex="0"]');
            if (day) { event.preventDefault(); day.focus({ preventScroll: true }); }
          }}
        >
          <Calendar
            size="lg"
            selected={value}
            onSelect={choose}
            disabled={(date) => !inRange(date)}
          />
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <Button variant="ghost" size="sm" disabled={!inRange(startOfDay(new Date()))} onClick={() => choose(startOfDay(new Date()))}>Today</Button>
            {clearable && !required && value && <Button variant="link" size="sm" onClick={() => choose(undefined)}>Clear date</Button>}
          </div>
        </PopoverContent>
      </Popover>
      </div>
      {notice && <p id={noticeId} role="alert" className="mt-1.5 text-xs leading-relaxed text-danger">{notice}</p>}
    </div>
  );
}

/* ── DateField — string (yyyy-mm-dd) wrapper, drop-in for <input type="date"> ── */
const toDate = (s?: string) => {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00`);
  return isValid(d) && format(d, "yyyy-MM-dd") === s ? d : undefined;
};
const toStr = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : "");

export interface DateFieldProps extends DateInputProps {
  value?: string; // yyyy-mm-dd
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Min date (yyyy-mm-dd). */
  min?: string;
  max?: string;
}

export function DateField({ value, onChange, min, max, ...rest }: DateFieldProps) {
  return (
    <DatePicker
      value={toDate(value)}
      onChange={(d) => onChange(toStr(d))}
      minDate={toDate(min)}
      maxDate={toDate(max)}
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
