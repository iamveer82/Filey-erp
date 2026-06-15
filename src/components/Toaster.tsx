/* ── Sonner (toast notifications — adapted from shadcn/sonner) ─────
 * Drop-in replacement for Filey's ad-hoc `useUI().toast`. Mount
 * the <Toaster /> once in App.tsx and the `toast.*` helpers
 * from the `sonner` package work everywhere. Quieter than the
 * shadcn default: brand-200 border, no glow, plain
 * progress bar. */
import { Toaster as SonnerToaster } from "sonner";
import { cn } from "../lib/format";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export function Toaster({ className, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      className={cn("toaster group", className)}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white group-[.toaster]:text-ink group-[.toaster]:border-brand-200 group-[.toaster]:border group-[.toaster]: group-[.toaster]:rounded-xl group-[.toaster]:px-4 group-[.toaster]:py-3 group-[.toaster]:text-sm group-[.toaster]:font-medium",
          description: "group-[.toast]:text-brand-500 group-[.toast]:text-xs",
          actionButton:
            "group-[.toast]:bg-primary-500 group-[.toast]:text-white group-[.toast]:rounded-md group-[.toast]:text-xs group-[.toast]:font-semibold",
          cancelButton:
            "group-[.toast]:bg-brand-100 group-[.toast]:text-ink group-[.toast]:rounded-md group-[.toast]:text-xs group-[.toast]:font-semibold",
          error:
            "group-[.toast]:!bg-danger/10 group-[.toast]:!text-danger group-[.toast]:!border-danger/30",
          success:
            "group-[.toast]:!bg-success/10 group-[.toast]:!text-success group-[.toast]:!border-success/30",
          warning:
            "group-[.toast]:!bg-warning/15 group-[.toast]:!text-warning group-[.toast]:!border-warning/30",
        },
      }}
      {...props}
    />
  );
}

// Re-export the toast helpers for new code; legacy `useUI().toast.*`
// continues to work in the same codebase.
export { toast } from "sonner";
