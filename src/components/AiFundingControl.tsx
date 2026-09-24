import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, KeyRound, Sparkles, Wallet } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import {
  AI_CREDITS_EVENT,
  creditChoice,
  creditMoney,
  getCreditStatus,
  setCreditChoice,
  type AiFunding,
  type CreditStatus,
} from "../lib/aiCredits";
import { FileySpinner } from "./FileySpinner";
import "./AgentComposerControls.css";
import { supabase } from "../lib/supabase";

export function useAiFunding() {
  const [choice, setChoice] = useState(creditChoice);
  useEffect(() => {
    const update = () => setChoice(creditChoice());
    window.addEventListener(AI_CREDITS_EVENT, update);
    window.addEventListener("filey:agent-storage", update);
    return () => {
      window.removeEventListener(AI_CREDITS_EVENT, update);
      window.removeEventListener("filey:agent-storage", update);
    };
  }, []);
  return choice;
}

export default function AiFundingControl({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const choice = useAiFunding();
  const [open, setOpen] = useState(false),
    [data, setData] = useState<CreditStatus | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const close = () => {
      setOpen(false);
      setData(null);
      setError("");
    };
    window.addEventListener("filey:agent-storage", close);
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN") close();
    });
    return () => {
      window.removeEventListener("filey:agent-storage", close);
      subscription?.data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setError("");
    setData(null);
    void getCreditStatus()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);
  function choose(funding: AiFunding, model?: string) {
    try {
      setCreditChoice(funding, model);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="composer-control"
          disabled={disabled}
          aria-label="AI payment method"
          title={choice.funding === "free" ? "Free AI" : choice.funding === "credits" ? "Filey Credits" : "My API key"}
        >
          {choice.funding === "free" ? (
            <Sparkles size={14} />
          ) : choice.funding === "credits" ? (
            <Wallet size={14} />
          ) : (
            <KeyRound size={14} />
          )}
          <span className={compact ? "sr-only" : undefined}>
            {choice.funding === "free"
              ? "Free AI"
              : choice.funding === "credits"
                ? "Filey Credits"
                : "My API key"}
          </span>
          {!compact && <ChevronDown size={12} />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        collisionPadding={12}
        className="max-h-[min(650px,70dvh,var(--radix-popover-content-available-height))] w-[min(360px,calc(100vw-32px))] overflow-y-auto p-3"
        data-browser-overlay
      >
        <p className="px-2 pb-2 text-sm font-semibold">How to use Filey AI</p>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-[8px] p-3 text-left hover:bg-hover"
          onClick={() => choose("byok")}
        >
          <KeyRound size={18} />
          <span className="flex-1">
            <span className="block text-[13px] font-medium">
              My API key or local model
            </span>
            <span className="block text-xs text-muted-foreground">
              No Filey usage fee. Provider charges may apply.
            </span>
          </span>
          {choice.funding === "byok" && <Check size={16} />}
        </button>
        <div className="my-2 border-t border-border" />
        {!!data?.models.some((model) => model.free) && (
          <div className="space-y-2 px-2 pb-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Sparkles size={15} /> Free AI
              {choice.funding === "free" && <Check size={15} className="ml-auto" />}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              No credits or API key needed. Up to {data.free_requests_per_day ?? 20} model
              requests per 24 hours, subject to shared provider availability. Agent tasks
              can use several requests.
            </p>
            <select
              aria-label="Free AI model"
              className="input w-full text-[13px]"
              value={choice.funding === "free" ? choice.model : ""}
              onChange={(event) => choose("free", event.target.value)}
            >
              <option value="" disabled>
                Choose a free model
              </option>
              {data.models
                .filter((model) => model.free)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id === "openrouter/free"
                      ? "Auto · available free model"
                      : model.name}
                    {model.vision ? " · Vision" : ""}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="flex items-center justify-between px-2 py-1 text-[13px]">
          <span className="font-medium">Filey Credits</span>
          {data && (
            <span className="tabular-nums">
              {creditMoney(Math.max(0, data.account.available_micros))} available
            </span>
          )}
        </div>
        {loading && (
          <p
            role="status"
            className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
          >
            <FileySpinner size={16} />
            Loading models…
          </p>
        )}
        {error && (
          <p role="alert" className="p-2 text-xs text-danger">
            {error}
          </p>
        )}
        {data?.notice && (
          <p className="p-2 text-xs text-muted-foreground">{data.notice}</p>
        )}
        <div className="max-h-64 overflow-y-auto">
          {data?.models
            .filter((model) => !model.free)
            .map((model) => (
              <button
                type="button"
                key={model.id}
                onClick={() => choose("credits", model.id)}
                className="flex min-h-11 w-full items-center gap-3 rounded-[8px] p-2 text-left hover:bg-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {model.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {model.vision ? "Vision · can read images and browser screenshots" : "Text only"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {creditMoney(model.input * 1e12 * (1 + data.markup_bps / 10000))} in ·{" "}
                    {creditMoney(model.output * 1e12 * (1 + data.markup_bps / 10000))} out
                    / 1M tokens
                  </span>
                </span>
                {choice.funding === "credits" && choice.model === model.id && (
                  <Check size={16} />
                )}
              </button>
            ))}
        </div>
        <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          All options work on Basic, Pro and Ultra. Free AI never spends your credits.
          Changes apply to new tasks; selecting a model does not charge you.
        </p>
        <Link
          className="btn-ghost mt-1 w-full"
          to="/settings?section=credits"
          onClick={() => setOpen(false)}
        >
          <Wallet size={16} /> Add money / AI wallet
        </Link>
      </PopoverContent>
    </Popover>
  );
}
