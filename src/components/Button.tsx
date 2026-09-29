/* ── Button (shared buttonVariants used by Calendar & others) ─────
 * cva-based variants matching the existing Filey iOS minimal tokens. */
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/format";
import { FileySpinner } from "./FileySpinner";

export const buttonVariants = cva(
  "shrink-0 touch-manipulation [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "btn-primary",
        secondary: "btn-secondary",
        ghost: "btn-ghost",
        outline: "btn-ghost",
        danger: "btn-danger",
        link: "btn-link",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", disabled, loading, children, ...props }, ref) => (
    <button
      ref={ref}
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props["aria-busy"]}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {loading && <FileySpinner size={16} />}
      {children}
    </button>
  )
);
Button.displayName = "Button";
