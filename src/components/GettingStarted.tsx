import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, X, ArrowRight } from "lucide-react";
import { aiReady } from "../lib/ai";
import { cn } from "../lib/format";

/* First-run checklist on the dashboard. Auto-hides once every step is done or
 * the user dismisses it (remembered locally). No demo data is written. */

const KEY = "filey.onboarding.dismissed";

export default function GettingStarted({
  hasProducts,
  hasInvoices,
}: {
  hasProducts: boolean;
  hasInvoices: boolean;
}) {
  const nav = useNavigate();
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(KEY));

  const steps = [
    { done: aiReady(), label: "Connect your AI assistant", to: "/settings?section=ai" },
    { done: hasProducts, label: "Add your first product", to: "/inventory" },
    { done: hasInvoices, label: "Create an invoice", to: "/invoicing" },
  ];
  const allDone = steps.every((s) => s.done);
  if (dismissed || allDone) return null;

  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="card mb-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-bold text-ink">Get started with Filey</p>
        <button onClick={dismiss} aria-label="Dismiss" className="cursor-pointer text-brand-400 hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <ul className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.label}>
            <button
              onClick={() => !s.done && nav(s.to)}
              disabled={s.done}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                s.done
                  ? "text-brand-400"
                  : "cursor-pointer text-ink hover:bg-brand-50 dark:hover:bg-white/5"
              )}
            >
              {s.done ? (
                <CheckCircle2 size={17} className="shrink-0 text-success" />
              ) : (
                <Circle size={17} className="shrink-0 text-brand-300" />
              )}
              <span className={cn("flex-1", s.done && "line-through")}>{s.label}</span>
              {!s.done && <ArrowRight size={14} className="text-brand-400" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
