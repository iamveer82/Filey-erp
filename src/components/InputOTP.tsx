/* ── InputOTP (adapted from shadcn/input-otp — design.md §0.8) ─────
 * Six-digit OTP entry with auto-advance, paste support, and
 * primary-500 highlight on the active slot. The `input-otp` lib is
 * already in package.json. Adapted: removed "use client", swapped
 * shadcn `cn` import to Filey's `lib/format`, kept the slot API. */
import * as React from "react";
import { forwardRef, useContext } from "react";
import { Dot } from "lucide-react";
import { OTPInput, OTPInputContext } from "input-otp";
import { cn } from "../lib/format";

export const InputOTP = forwardRef<
  React.ElementRef<typeof OTPInput>,
  React.ComponentPropsWithoutRef<typeof OTPInput>
>(({ className, containerClassName, ...props }, ref) => (
  <OTPInput
    ref={ref}
    containerClassName={cn(
      "flex items-center gap-2 has-[:disabled]:opacity-50",
      containerClassName
    )}
    className={cn("disabled:cursor-not-allowed", className)}
    {...props}
  />
));
InputOTP.displayName = "InputOTP";

export const InputOTPGroup = forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center", className)} {...props} />
));
InputOTPGroup.displayName = "InputOTPGroup";

export const InputOTPSlot = forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div"> & { index: number }
>(({ index, className, ...props }, ref) => {
  const ctx = useContext(OTPInputContext);
  const { char, hasFakeCaret, isActive } = ctx.slots[index];
  return (
    <div
      ref={ref}
      className={cn(
        "relative flex h-11 w-11 items-center justify-center rounded-lg border border-brand-200 bg-white text-base font-medium text-ink transition-colors",
        isActive && "border-primary-500 ring-2 ring-primary-400/40",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px bg-ink dark:bg-white" />
        </div>
      )}
    </div>
  );
});
InputOTPSlot.displayName = "InputOTPSlot";

export const InputOTPSeparator = forwardRef<
  React.ElementRef<"div">,
  React.ComponentPropsWithoutRef<"div">
>(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}>
    <Dot className="text-brand-300" />
  </div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";
