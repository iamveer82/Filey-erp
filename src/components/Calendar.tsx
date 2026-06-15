/* ── Calendar (adapted for react-day-picker v10 — design.md §0.8) ─
 * v10 changed the classNames + custom-components API. We use:
 * - CustomComponents.Chevron for the nav arrows
 * - New classNames like `month_caption`, `month_grid`, `day`, `day_button`
 * - `autoFocus` is the new way to focus the calendar on open
 * Flat brand-200 surface, primary-500 selected state, no scale
 * hover on day buttons. */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { buttonVariants } from "./Button";
import { cn } from "../lib/format";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function CalendarChevron({
  className,
  orientation,
  ...props
}: React.SVGProps<SVGSVGElement> & { orientation?: "left" | "right" | "up" | "down" }) {
  const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
  return <Icon className={cn("h-4 w-4", className)} {...props} />;
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        root: "rdp-root",
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-3",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium text-ink",
        nav: "space-x-1 flex items-center absolute inset-x-0",
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 text-brand-500 hover:text-ink absolute left-1"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "h-7 w-7 p-0 text-brand-500 hover:text-ink absolute right-1"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "text-brand-400 w-8 font-normal text-[10px] text-center",
        week: "flex w-full mt-1",
        day: "h-8 w-8 text-center text-sm p-0 relative",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-normal aria-selected:opacity-100 text-ink hover:bg-brand-100 rounded-lg"
        ),
        selected:
          "[&>button]:bg-primary-500 [&>button]:text-white [&>button]:hover:bg-primary-600 [&>button]:hover:text-white [&>button]:focus:bg-primary-500 [&>button]:focus:text-white",
        today: "[&>button]:border [&>button]:border-primary-300",
        outside:
          "[&>button]:text-brand-400 [&>button]:opacity-50 aria-selected:bg-brand-100/50",
        disabled: "[&>button]:text-brand-300 [&>button]:opacity-50",
        range_start: "[&>button]:rounded-l-lg",
        range_end: "[&>button]:rounded-r-lg",
        range_middle:
          "[&>button]:bg-brand-100 [&>button]:text-ink [&>button]:rounded-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
