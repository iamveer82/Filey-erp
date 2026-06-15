/* ── MultiDatePicker (HR / leave tracking) ───────────────────────
 * Calendar with multi-select. Returns an array of dates, plus an
 * onConfirm callback for the parent to commit. Used by People.tsx
 * for marking employee leave. Replaces the deleted v8-era
 * MultiDatePicker. */
import { Button } from "./Button";
import { Calendar } from "./Calendar";
import { format } from "date-fns";

export interface MultiDatePickerProps {
  value: Date[];
  onChange: (dates: Date[]) => void;
  onConfirm: (dates: Date[]) => void;
}

export default function MultiDatePicker({
  value,
  onChange,
  onConfirm,
}: MultiDatePickerProps) {
  return (
    <div className="space-y-3">
      <Calendar
        mode="multiple"
        selected={value}
        onSelect={(dates) => onChange(dates ?? [])}
        className="rounded-3xl border border-brand-200 dark:border-[#2C2C2E]"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-brand-500">
          {value.length === 0 ? (
            <>Select leave dates from the calendar</>
          ) : (
            <>
              {value.length} day{value.length === 1 ? "" : "s"} selected
              {value.length > 0 && (
                <span className="block text-[10px] text-brand-400 mt-0.5">
                  First: {format(value[0], "dd MMM yyyy")}
                  {value.length > 1 &&
                    ` · Last: ${format(value[value.length - 1], "dd MMM yyyy")}`}
                </span>
              )}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onChange([]);
            }}
            disabled={value.length === 0}
          >
            Clear
          </Button>
          <Button
            onClick={() => {
              onConfirm(value);
            }}
            disabled={value.length === 0}
          >
            Save leave
          </Button>
        </div>
      </div>
    </div>
  );
}
