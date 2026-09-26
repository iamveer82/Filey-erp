import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { ErrorBanner } from "./ui";
import {
  WORK_SERVICES,
  getCountryMarketData,
  getPublicHolidays,
  listHolidayCountries,
  searchCreativeAssets,
} from "../lib/workServices";

type Kind = "market" | "holidays" | "assets";
type Result =
  | { kind: "market"; data: Awaited<ReturnType<typeof getCountryMarketData>> }
  | { kind: "holidays"; data: Awaited<ReturnType<typeof getPublicHolidays>> }
  | { kind: "assets"; data: Awaited<ReturnType<typeof searchCreativeAssets>> };
const ACCESS = {
  local: "Runs locally",
  keyless: "No API key",
  "free-tier": "Free tier",
  byok: "Your account / key",
};

export default function WorkServices() {
  const [kind, setKind] = useState<Kind>("market");
  const [country, setCountry] = useState("AE");
  const [holidayCountry, setHolidayCountry] = useState("");
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const workbench = useRef<HTMLElement>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const choose = (next: Kind) => {
    pending.current?.abort();
    setKind(next);
    setResult(null);
    setError("");
    setBusy(false);
    if (next === "holidays" && !countries.length) {
      const abort = new AbortController();
      pending.current = abort;
      setBusy(true);
      void listHolidayCountries({ signal: abort.signal })
        .then((rows) => {
          if (!abort.signal.aborted) {
            setCountries(rows);
            setHolidayCountry(
              rows.some((row) => row.code === "DE") ? "DE" : (rows[0]?.code ?? "")
            );
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!abort.signal.aborted) setBusy(false);
        });
    }
  };
  const run = async () => {
    if (busy) return;
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value: Result =
        kind === "market"
          ? { kind, data: await getCountryMarketData(country, { signal: abort.signal }) }
          : kind === "holidays"
            ? {
                kind,
                data: await getPublicHolidays(holidayCountry, Number(year), {
                  signal: abort.signal,
                }),
              }
            : {
                kind,
                data: await searchCreativeAssets(query, {
                  limit: 6,
                  signal: abort.signal,
                }),
              };
      if (!abort.signal.aborted) setResult(value);
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <section
        ref={workbench}
        className="rounded-xl border border-border bg-card p-5"
        aria-label="Free work tools"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Useful data, without an API key</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
              Research a market, check supported public holidays or find reusable images.
              These lookups send only your query, country or year.
            </p>
          </div>
          <Link
            className="btn-ghost"
            to="/agent"
            state={{
              draft:
                "Show me the free work services available in Filey. Help me choose useful tools for my business without changing my records.",
            }}
          >
            Use with Filey AI <ArrowUpRight size={14} />
          </Link>
        </div>
        <div
          role="group"
          aria-label="Choose a work tool"
          className="mb-5 flex flex-wrap gap-2"
        >
          {(
            [
              ["market", "Market facts"],
              ["holidays", "Public holidays"],
              ["assets", "Creative assets"],
            ] as const
          ).map(([id, label]) => (
            <button
              className={`chip ${kind === id ? "chip-active" : ""}`}
              aria-pressed={kind === id}
              key={id}
              onClick={() => choose(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          {kind === "market" && (
            <label className="min-w-48 flex-1">
              <span className="label">Country code</span>
              <input
                className="input uppercase"
                aria-label="Market country code"
                placeholder="AE, IN, DE…"
                maxLength={2}
                value={country}
                disabled={busy}
                onChange={(e) => {
                  setCountry(e.target.value.toUpperCase());
                  setResult(null);
                }}
                required
              />
            </label>
          )}
          {kind === "holidays" && (
            <>
              <label className="min-w-48 flex-1">
                <span className="label">Supported country</span>
                <select
                  className="select"
                  value={holidayCountry}
                  aria-label="Holiday country"
                  disabled={busy || !countries.length}
                  onChange={(e) => {
                    setHolidayCountry(e.target.value);
                    setResult(null);
                  }}
                  required
                >
                  <option value="">Choose a country</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-28">
                <span className="label">Year</span>
                <input
                  className="input"
                  type="number"
                  aria-label="Holiday year"
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setResult(null);
                  }}
                  disabled={busy}
                  required
                />
              </label>
            </>
          )}
          {kind === "assets" && (
            <label className="min-w-52 flex-1">
              <span className="label">Image search</span>
              <input
                className="input"
                placeholder="Coffee beans, solar panels…"
                aria-label="Creative asset search"
                value={query}
                disabled={busy}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setResult(null);
                }}
                maxLength={160}
                required
              />
            </label>
          )}
          <button
            className="btn-primary"
            disabled={busy || (kind === "holidays" && !holidayCountry)}
          >
            <Search size={14} />
            {busy ? "Looking up…" : "Look up"}
          </button>
        </form>
        {kind === "holidays" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Coverage varies by country. Unsupported countries are not estimated; regional
            holidays are labelled in the results.
          </p>
        )}
        {kind === "assets" && (
          <p className="mt-3 text-xs text-muted-foreground">
            Each result includes its source and licence. Review the original file page and
            keep required attribution with your marketing material.
          </p>
        )}
        {error && (
          <div className="mt-4">
            <ErrorBanner message={error} />
          </div>
        )}
        {result && (
          <div className="mt-5 border-t border-border pt-4" aria-live="polite">
            {result.kind === "market" && (
              <>
                <h3 className="mb-3 text-sm font-medium">{result.data.countryName}</h3>
                <dl className="divide-y divide-border">
                  {result.data.rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-[13px]"
                    >
                      <dt>
                        {row.label}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.year || "No recent data"}
                        </span>
                      </dt>
                      <dd className="font-medium tabular-nums">
                        {row.value === null
                          ? "Not available"
                          : row.value.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}{" "}
                        <span className="font-normal text-muted-foreground">
                          {row.value !== null ? row.unit : ""}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {result.kind === "holidays" &&
              (!result.data.rows.length ? (
                <p className="text-sm text-muted-foreground">
                  No holidays returned for this country and year.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {result.data.rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-[13px]"
                    >
                      <div>
                        {row.name}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.nationwide
                            ? "Nationwide"
                            : row.subdivisions.join(", ") || "Regional"}
                        </p>
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {row.startDate}
                        {row.endDate !== row.startDate ? ` – ${row.endDate}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ))}
            {result.kind === "assets" &&
              (!result.data.rows.length ? (
                <p className="text-sm text-muted-foreground">
                  No matching images with a recognised reusable licence. Try a broader
                  search.
                </p>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {result.data.rows.map((row) => (
                    <figure key={row.id} className="min-w-0">
                      <a
                        href={row.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={row.thumbnailUrl}
                          alt={row.title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-40 w-full rounded-lg bg-muted object-contain"
                        />
                      </a>
                      <figcaption className="mt-2 space-y-1 text-xs leading-relaxed">
                        <a
                          className="font-medium underline underline-offset-2"
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.title}
                        </a>
                        <p className="break-words text-muted-foreground">
                          {row.attribution}
                        </p>
                        <a
                          className="underline"
                          href={row.licenseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {row.license}
                        </a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ))}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              {result.data.attribution}{" "}
              <a
                className="underline"
                href={result.data.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Source and terms
              </a>
            </p>
          </div>
        )}
      </section>
      <section aria-label="Service catalogue">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Choose how to connect</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Local tools, public APIs and services that accept your own account.
            </p>
          </div>
          <label className="min-w-48">
            <span className="sr-only">Filter services</span>
            <input
              className="input"
              placeholder="Find a service…"
              aria-label="Filter services"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {WORK_SERVICES.filter((service) =>
            `${service.name} ${service.category} ${service.description}`
              .toLowerCase()
              .includes(filter.toLowerCase())
          ).map((service) => (
            <article key={service.id} className="flex flex-wrap items-start gap-4 py-5">
              <div className="min-w-0 flex-1 basis-72">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold">{service.name}</h3>
                  <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                    {ACCESS[service.access]}
                  </span>
                </div>
                <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">
                  {service.description}
                </p>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  {service.limits}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {service.tool &&
                ["market", "holidays", "assets"].includes(service.tool) ? (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      choose(service.tool as Kind);
                      workbench.current?.scrollIntoView({
                        block: "start",
                        behavior: "auto",
                      });
                    }}
                  >
                    Try it
                  </button>
                ) : service.route ? (
                  <Link className="btn-secondary" to={service.route}>
                    Open setup
                  </Link>
                ) : null}
                {service.docsUrl.startsWith("/") && !service.setupUrl ? (
                  <Link className="btn-ghost" to={service.docsUrl}>
                    Documentation <ArrowUpRight size={14} />
                  </Link>
                ) : (
                  <a
                    className="btn-ghost"
                    href={service.setupUrl || service.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {service.setupUrl ? "Provider setup" : "Documentation"}
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
        {WORK_SERVICES.every(
          (service) =>
            !`${service.name} ${service.category} ${service.description}`
              .toLowerCase()
              .includes(filter.toLowerCase())
        ) && (
          <p className="py-6 text-sm text-muted-foreground">
            No services match this search.
          </p>
        )}
      </section>
    </div>
  );
}
