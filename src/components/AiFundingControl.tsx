import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, KeyRound, Sparkles } from "lucide-react";
import PaperMark from "./PaperMark";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import {
  AI_CREDITS_EVENT,
  creditChoice,
  creditPaper,
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
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    const close = () => {
      setOpen(false);
      setData(null);
      setError("");
      setSearch("");
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
  const query = search.trim().toLowerCase();
  const models =
    data?.models.filter(
      (model) =>
        model.id !== "filey-ai" &&
        `${model.name} ${model.id}`.toLowerCase().includes(query)
    ) ?? [];
  const freeModels = models.filter((model) => model.free);
  const paidModels = models.filter((model) => !model.free);
  const selectedPaid = data?.models.find(
    (model) => !model.free && model.id === choice.model
  );
  const needsPaidChoice =
    choice.funding === "credits" &&
    (!choice.model || choice.model === "filey-ai" || (!!data && !selectedPaid));
  const paidLabel = needsPaidChoice
    ? "Choose a paid model"
    : selectedPaid?.name || choice.model;
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
          title={
            choice.funding === "free"
              ? "Free AI"
              : choice.funding === "credits"
                ? paidLabel
                : "My API key"
          }
        >
          {choice.funding === "free" ? (
            <Sparkles size={14} />
          ) : choice.funding === "credits" ? (
            <PaperMark />
          ) : (
            <KeyRound size={14} />
          )}
          <span className={compact ? "sr-only" : "max-w-52 truncate"}>
            {choice.funding === "free"
              ? "Free AI"
              : choice.funding === "credits"
                ? paidLabel
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
        {!!data?.models.some((model) => model.id !== "filey-ai") && (
          <div className="px-2 pb-3">
            <input
              type="search"
              aria-label="Search AI models"
              placeholder="Search paid and free models"
              className="input min-h-11 w-full"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        )}
        {!!data?.models.some((model) => model.free) && (
          <div className="space-y-2 px-2 pb-3">
            <div className="flex items-center gap-2 text-[13px] font-medium">
              <Sparkles size={15} /> Free AI
              {choice.funding === "free" && <Check size={15} className="ml-auto" />}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              No Paper or API key needed. Up to {data.free_requests_per_day ?? 20} model
              requests per 24 hours, subject to shared provider availability. Agent tasks
              can use several requests.
            </p>
            <select
              aria-label="Free AI model"
              className="input w-full text-[13px]"
              value={
                choice.funding === "free" &&
                freeModels.some((model) => model.id === choice.model)
                  ? choice.model
                  : ""
              }
              disabled={!freeModels.length}
              onChange={(event) => choose("free", event.target.value)}
            >
              <option value="" disabled>
                {freeModels.length ? "Choose a free model" : "No matching free models"}
              </option>
              {freeModels.map((model) => (
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 text-[13px]">
          <span className="flex items-center gap-2 font-medium">
            <PaperMark /> Pay with Paper
          </span>
          {data && (
            <span className="tabular-nums">
              {creditPaper(Math.max(0, data.account.available_micros), true)} available
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
        {needsPaidChoice && (
          <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
            Choose a paid model to continue. Filey will use the model you select.
          </p>
        )}
        <div className="max-h-64 overflow-y-auto">
          {paidModels.map((model) => (
            <button
              type="button"
              key={model.id}
              disabled={!data?.configured}
              aria-pressed={choice.funding === "credits" && choice.model === model.id}
              onClick={() => choose("credits", model.id)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[8px] p-3 text-left hover:bg-hover disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[13px] font-medium"
                  title={model.name}
                >
                  {model.name}
                </span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={model.id}
                >
                  {model.id}
                  {model.vision ? " · Vision" : ""}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Up to {creditPaper(model.input * 1e12, true)} input ·{" "}
                  {creditPaper(model.output * 1e12, true)} output / 1M tokens
                </span>
                {!!model.image && model.image > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Up to {creditPaper(Math.ceil(model.image * 1e6), true)} / input image
                  </span>
                )}
              </span>
              {choice.funding === "credits" && choice.model === model.id && (
                <Check size={16} />
              )}
            </button>
          ))}
        </div>
        {data && !data.models.some((model) => !model.free && model.id !== "filey-ai") && (
          <p className="p-2 text-xs text-muted-foreground">
            Paid models are not available yet. You can use an available free model or your
            own key.
          </p>
        )}
        {data && query && !models.length && (
          <p role="status" className="p-2 text-xs text-muted-foreground">
            No matching models. Try a provider or model name.
          </p>
        )}
        <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          Rates vary by provider, context and time. You pay actual usage; these rates are
          spending estimates.
        </p>
        <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
          1 Paper = $1. Available on Basic, Pro and Ultra. Free AI never spends Paper.
          Paid models use their actual provider cost, with no Filey usage markup. Changes
          apply to new tasks; selecting a model does not charge you.
        </p>
        <Link
          className="btn-ghost mt-1 w-full"
          to="/settings?section=credits"
          onClick={() => setOpen(false)}
        >
          <PaperMark /> Add Paper / wallet
        </Link>
      </PopoverContent>
    </Popover>
  );
}
