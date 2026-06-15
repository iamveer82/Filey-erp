/* ── Button (shared buttonVariants used by Calendar & others) ─────
 * cva-based variants matching the existing Filey iOS minimal tokens. */
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-primary-400 text-ink shadow-sm hover:bg-primary-500 hover:shadow-md",
        secondary:
          "bg-brand-50 text-brand-700 shadow-sm hover:bg-brand-100 hover:shadow-md dark:bg-white/12 dark:text-[#DDE0E4] dark:hover:bg-white/15",
        ghost:
          "text-brand-600 hover:bg-brand-50 hover:text-ink dark:text-[#B6BAC1] dark:hover:bg-white/10 dark:hover:text-[#F4F5F6]",
        outline:
          "border border-brand-200 bg-surface text-ink shadow-sm hover:bg-brand-50 hover:shadow-md dark:border-[#2C2C2E] dark:bg-[#1C1C1E] dark:hover:bg-white/5",
        danger: "bg-danger text-white shadow-sm hover:bg-danger/90 hover:shadow-md",
        link: "text-primary-600 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-base",
        icon: "h-10 w-10",
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
