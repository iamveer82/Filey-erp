import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, Mail, MessageCircle, Globe, Sparkles } from "lucide-react";
import { ErrorBanner } from "./ui";

export default function FreeConnections() {
  const [base, setBase] = useState("AED");
  const [quote, setQuote] = useState("USD");
  const [amount, setAmount] = useState("1000");
  const [result, setResult] = useState<{
    amount: number;
    rate: number;
    date: string;
    base: string;
    quote: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currencies = [
    "AED",
    "USD",
    "EUR",
    "GBP",
    "INR",
    "SAR",
    "PKR",
    "QAR",
    "OMR",
    "BHD",
    "KWD",
    "JPY",
    "CNY",
  ];
  const convert = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value = Number(amount);
      if (!amount.trim() || !Number.isFinite(value) || value < 0)
        throw new Error("Enter a valid positive amount.");
      if (base === quote) {
        setResult({ amount: value, rate: 1, date: "Same currency", base, quote });
        return;
      }
      const response = await fetch(
        `https://api.frankfurter.dev/v2/rate/${base}/${quote}`,
        { signal: AbortSignal.timeout(12000) }
      );
      if (!response.ok)
        throw new Error(
          `Rates are unavailable (HTTP ${response.status}). Try again later.`
        );
      const rate: unknown = await response.json();
      if (
        !rate ||
        typeof rate !== "object" ||
        !("rate" in rate) ||
        typeof rate.rate !== "number" ||
        !Number.isFinite(rate.rate) ||
        rate.rate <= 0 ||
        !("date" in rate) ||
        typeof rate.date !== "string"
      )
        throw new Error("The rate provider returned an invalid response.");
      setResult({
        amount: value * rate.rate,
        rate: rate.rate,
        date: rate.date,
        base,
        quote,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <section className="card">
        <div className="flex items-center gap-2 mb-1"><Sparkles size={17} /><h2 className="text-sm font-semibold">AI on your device</h2></div>
        <p className="text-sm text-muted-foreground mb-4">Use downloaded models through Ollama or LM Studio with no hosted inference fee. Your device runs the model; hardware requirements and model licenses apply. Online tools and cloud-backed models still need their services.</p>
        <div className="flex flex-wrap gap-2">
          <Link className="btn-secondary" to="/settings?section=ai">Set up local AI <ArrowUpRight size={14} /></Link>
          <Link className="btn-ghost" to="/docs?article=ai-setup">Local models & free tiers</Link>
        </div>
      </section>
      <section className="card">
        <div className="flex items-center gap-2 mb-1">
          <Globe size={17} />
          <h2 className="text-sm font-semibold">Exchange rates</h2>
          <span className="ml-auto text-xs text-muted-foreground">No API key</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Daily reference rates from Frankfurter. No customer information is sent. Your
          entered amount is calculated on this device.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void convert();
          }}
          className="flex flex-wrap gap-3 items-end"
        >
          <label className="min-w-36 flex-1">
            <span className="label">Amount</span>
            <input
              className="input"
              disabled={busy}
              type="number"
              min="0"
              step="any"
              required
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <label>
            <span className="label">From</span>
            <select
              className="select"
              disabled={busy}
              value={base}
              onChange={(e) => {
                setBase(e.target.value);
                setResult(null);
              }}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">To</span>
            <select
              className="select"
              disabled={busy}
              value={quote}
              onChange={(e) => {
                setQuote(e.target.value);
                setResult(null);
              }}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="btn-primary" disabled={busy}>
            {busy ? "Fetching…" : "Convert"}
          </button>
        </form>
        {error && (
          <div className="mt-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {result && (
          <div role="status" className="mt-5 border-t border-border pt-4">
            <p className="text-2xl font-semibold tabular-nums">
              {result.amount.toLocaleString("en", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              {result.quote}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              1 {result.base} = {result.rate} {result.quote} · Provider date:{" "}
              {result.date}
            </p>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-4">
          Reference only; invoice exchange rates remain attached to their documents.{" "}
          <a
            className="underline"
            href="https://frankfurter.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Free commercial API; provider terms and rate limits apply.
          </a>
        </p>
      </section>
      <div className="grid md:grid-cols-2 gap-4">
        <section className="card">
          <MessageCircle size={18} className="mb-3" />
          <h2 className="font-semibold text-sm">Telegram</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-4">
            Save a Telegram username on a contact, then use its Telegram action to open
            the conversation in your own account. You review and send the message.
          </p>
          <Link className="btn-secondary" to="/crm?view=contacts">
            Open contacts <ArrowUpRight size={14} />
          </Link>
          <p className="text-xs text-muted-foreground mt-3">
            Direct chats need no API key. Automated Filey AI bots require administrator
            setup, a bot token, and hosting.{" "}
            <a
              className="underline"
              href="https://core.telegram.org/bots/faq"
              target="_blank"
              rel="noopener noreferrer"
            >
              Bot API setup and limits
            </a>
            .
          </p>
        </section>
        <section className="card">
          <Mail size={18} className="mb-3" />
          <h2 className="font-semibold text-sm">Email & phone</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-4">
            Email and call actions open your installed mail and telephone apps. Log the
            outcome against the record to keep the team informed.
          </p>
          <Link className="btn-secondary" to="/crm?view=activities">
            Activity history <ArrowUpRight size={14} />
          </Link>
          <p className="text-xs text-muted-foreground mt-3">
            No Filey API fee. Your email and telephone provider terms apply.
          </p>
        </section>
        <section className="card">
          <CalendarDays size={18} className="mb-3" />
          <h2 className="font-semibold text-sm">Calendar</h2>
          <p className="text-sm text-muted-foreground mt-2 mb-4">
            Export dated open tasks as a calendar file for Google Calendar, Apple
            Calendar, or Outlook. Each due date becomes an all-day event.
          </p>
          <Link className="btn-secondary" to="/crm?view=tasks">
            Tasks & calendar export <ArrowUpRight size={14} />
          </Link>
          <p className="text-xs text-muted-foreground mt-3">
            Free file export. This is a snapshot; later CRM edits do not sync to an
            imported calendar.
          </p>
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        Contacts, companies, leads, deals, tasks, notes, activity history, imports and
        reports use Filey's own storage. No enrichment subscription is needed. Cloud
        hosting, AI providers, and optional paid messaging services have their own limits.
      </p>
    </div>
  );
}
