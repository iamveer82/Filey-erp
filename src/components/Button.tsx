/* ── Button (shared buttonVariants used by Calendar & others) ─────
 * cva-based variants matching the existing Filey iOS minimal tokens. */
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-[0.97]",
  {
    variants: {
      variant: {
        primary:
          "bg-primary-400 text-neutral-900 border border-primary-500/60 hover:bg-primary-300",
        secondary: "bg-foreground text-background border border-foreground hover:opacity-90",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
        outline: "border border-border bg-card text-foreground hover:bg-hover",
        danger: "bg-danger text-white hover:bg-danger/90",
        link: "text-primary-600 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3",
        lg: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
);
Button.displayName = "Button";
