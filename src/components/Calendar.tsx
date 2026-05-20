import { DayPicker, type DayPickerProps } from "react-day-picker";
import "react-day-picker/style.css";
import { cn } from "../lib/format";

/** Thin design.md-themed wrapper around react-day-picker. The CSS
 *  variables map react-day-picker's accent/today colors to Filey's
 *  primary yellow + ink so the calendar inherits the brand without
 *  touching the upstream stylesheet. */
export default function Calendar({
  className,
  ...props
}: DayPickerProps) {
  return (
    <div
      className={cn("filey-rdp", className)}
      style={
        {
          // react-day-picker v10 CSS variables
          "--rdp-accent-color": "#FFD600",
          "--rdp-accent-background-color": "#FFD600",
          "--rdp-background-color": "#FFFBEB",
          "--rdp-today-color": "#222222",
          "--rdp-selected-border": "transparent",
          "--rdp-day-height": "36px",
          "--rdp-day-width": "36px",
          "--rdp-day_button-border-radius": "12px",
          "--rdp-day_button-width": "36px",
          "--rdp-day_button-height": "36px",
          "--rdp-font-family": "inherit",
        } as React.CSSProperties
      }
    >
      <DayPicker {...props} />
    </div>
  );
}
