/* ── DatePicker (composed: Popover + Calendar + Button) ───────────
 * One-stop date picker using the Popover + Calendar primitives.
 * Pass `value` (Date) + `onChange`. Locale formatting via date-fns.
 * Used in forms for "issue date", "due date", "follow-up date", etc. */
import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./Popover";
import { Calendar } from "./Calendar";
import { Button } from "./Button";
import { cn } from "../lib/format";

export interface DatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** When true, the user can clear the date (shows an X button). */
  clearable?: boolean;
  /** Min date selectable. */
  minDate?: Date;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  disabled,
  clearable = true,
  minDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="md"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-medium",
            !value && "text-brand-400",
            className
          )}
        >
          <CalendarIcon size={14} className="text-brand-400" />
          {value ? format(value, "dd MMM yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
          disabled={minDate ? { before: minDate } : undefined}
        />
        {clearable && value && (
          <div className="border-t border-brand-200 dark:border-[#2C2C2E] p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
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
      <span className="text-brand-400 text-xs">→</span>
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
