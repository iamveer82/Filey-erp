/* ── Command (adapted from shadcn/command — design.md §0.8) ──────
 * cmdk-based command palette. The Filey `CommandPalette.tsx`
 * already exists (keyboard ⌘K shortcut) — wire this primitive
 * into it for the visual layer. Quieter than shadcn default:
 * no ring, no rounded-md shadow — flat border, brand-200 surface. */
import * as React from "react";
import { forwardRef } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "./Dialog";
import { cn } from "../lib/format";

export const Command = forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-lg bg-white text-ink",
      className
    )}
    {...props}
  />
));
Command.displayName = "Command";

export interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  /** When true, render a full-screen modal command palette (the
   * ⌘K overlay). Default: true. */
  fullscreen?: boolean;
}

export function CommandDialog({
  children,
  fullscreen = true,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", fullscreen ? "max-w-2xl" : "max-w-md")}
      >
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-brand-400 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4 [&_[cmdk-input]]:h-12">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export const CommandInput = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b border-brand-200 px-3">
    <Search className="mr-2 h-4 w-4 shrink-0 text-brand-400" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-11 w-full rounded-md bg-transparent py-3 text-sm text-ink outline-none placeholder:text-brand-400 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = "CommandInput";

export const CommandList = forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[420px] overflow-y-auto overflow-x-hidden p-1", className)}
    {...props}
  />
));
CommandList.displayName = "CommandList";

export const CommandEmpty = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-8 text-center text-sm text-brand-400"
    {...props}
  />
));
CommandEmpty.displayName = "CommandEmpty";

export const CommandGroup = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn("overflow-hidden p-1 text-ink", className)}
    {...props}
  />
));
CommandGroup.displayName = "CommandGroup";

export const CommandItem = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium outline-none data-[selected=true]:bg-brand-100 data-[selected=true]:text-ink aria-selected:bg-brand-100 aria-selected:text-ink dark:data-[selected=true]:bg-white/10 dark:aria-selected:bg-white/10",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";

export const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("ml-auto text-[10px] text-brand-400", className)} {...props} />
);

export const CommandSeparator = forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-brand-100 dark:bg-white/12", className)}
    {...props}
  />
));
CommandSeparator.displayName = "CommandSeparator";
