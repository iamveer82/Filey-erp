import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, KeyRound } from "lucide-react";
import CoinMark from "./CoinMark";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import {
  AI_CREDITS_EVENT,
  FILEY_AI_MODEL,
  creditChoice,
  creditCoin,
  getCreditStatus,
  isPaidCreditModel,
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

export default function AiFundingControl({
  disabled = false,
  compact = false,
}: {
  disabled?: boolean;
  compact?: boolean;
}) {
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
  const model = data?.models.find(isPaidCreditModel);
  const paidAvailable = !!data?.configured && !!model;
  const label = choice.funding === "credits"
    ? "Filey AI"
    : choice.funding === "free" ? "Choose AI connection" : "My API key";
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
          className="composer-control max-w-full"
          disabled={disabled}
          aria-label="AI payment method"
          title={label}
        >
          {choice.funding === "credits" ? (
            <CoinMark />
          ) : (
            <KeyRound size={compact ? 18 : 14} />
          )}
          <span className={compact ? "sr-only" : "max-w-52 truncate"}>
            {label}
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 text-[13px]">
          <span className="flex items-center gap-2 font-medium">
            <CoinMark /> Pay with Coin
          </span>
          {data && (
            <span className="tabular-nums">
              {creditCoin(Math.max(0, data.account.available_micros), true)} available
            </span>
          )}
        </div>
        {loading && (
          <p
            role="status"
            className="flex items-center gap-2 p-3 text-xs text-muted-foreground"
          >
            <FileySpinner size={16} />
            Loading your wallet…
          </p>
        )}
        {error && (
          <p role="alert" className="p-2 text-xs text-danger">
            {error}
          </p>
        )}
        {choice.funding === "free" && (
          <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
            Your previous free connection is no longer available. Choose Filey AI
            to pay with Coin, or use your own API key.
          </p>
        )}
        <button
          type="button"
          disabled={!paidAvailable}
          aria-pressed={choice.funding === "credits"}
          onClick={() => choose("credits", FILEY_AI_MODEL)}
          className="flex min-h-11 w-full items-center gap-3 rounded-[8px] p-3 text-left hover:bg-hover disabled:opacity-50"
        >
          <CoinMark />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">Filey AI</span>
            <span className="block text-xs text-muted-foreground">
              Usage is paid from your Coin balance.
            </span>
          </span>
          {choice.funding === "credits" && <Check size={16} />}
        </button>
        {data && !paidAvailable && (
          <p className="p-2 text-xs text-muted-foreground">
            Filey AI is not available yet. You can use your own API key or a local model.
          </p>
        )}
        <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          1 Coin = $1. Available on Basic, Pro and Ultra.
          Changes apply to new tasks; selecting Filey AI
          does not charge you.
        </p>
        <Link
          className="btn-ghost mt-1 w-full"
          to="/settings?section=credits"
          onClick={() => setOpen(false)}
        >
          <CoinMark /> Add Coin / wallet
        </Link>
      </PopoverContent>
    </Popover>
  );
}
