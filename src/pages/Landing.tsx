import {
  ArrowRight,
  Boxes,
  Target,
  FileText,
  Wrench,
  Sparkles,
  ShieldCheck,
  ScanText,
  Check,
  Download,
  TrendingUp,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import Logo from "../components/Logo";
import { PLANS } from "../lib/subscription";
import FreedomContactModal from "../components/FreedomContactModal";

/** Latest desktop installer (GitHub Releases — Windows + Linux artifacts). */
const DOWNLOAD_URL = "https://github.com/iamveer82/Filey-erp/releases/latest";
const ENTERPRISE_MAILTO =
  "mailto:sales@filey.co?subject=Filey%20ERP%20Enterprise%20enquiry";

/** Minimal landing page (design.md §0.8). All entrance / CountUp animations
 * removed — content is laid out statically and reads as a calm brochure. */

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Boxes,
    title: "ERP that fits",
    desc: "Inventory, orders, suppliers and purchasing in one connected source of truth.",
  },
  {
    icon: Target,
    title: "CRM & pipeline",
    desc: "Customers, leads and deals with drill-downs and activity history.",
  },
  {
    icon: FileText,
    title: "Invoicing & accounting",
    desc: "FTA tax invoices, quotations, payments and a real chart of accounts.",
  },
  {
    icon: Wrench,
    title: "Document tools",
    desc: "Merge, split, convert, sign and OCR. A full PDF suite, processed in the cloud.",
  },
  {
    icon: Sparkles,
    title: "AI built in",
    desc: "Extract data from scans, draft documents and ask questions about your business.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    desc: "Row-level security, per-team access and your data isolated on Supabase.",
  },
];

/** Sample figures for the hero preview. Not real customer data, and the panel
 *  says so on screen — do not present these as product metrics. */
const PREVIEW_STATS: {
  label: string;
  value: string;
  delta: string;
  dir: "up" | "down";
}[] = [
  { label: "Total items", value: "1,284", delta: "+12%", dir: "up" },
  { label: "Inventory value", value: "AED 482k", delta: "+4%", dir: "up" },
  { label: "Open orders", value: "37", delta: "+8", dir: "up" },
  { label: "Overdue", value: "4", delta: "-1", dir: "down" },
];

const PREVIEW_REVENUE = [35, 48, 52, 62, 58, 44, 70, 65, 78, 85, 72, 90];

/** Counted, not estimated: MODULES in src/modules/registry, PDF_TOOLS and its
 *  `cat` values in src/components/PdfToolbox. Recount before changing these. */
const STATS: { value: string; label: string }[] = [
  { value: "28", label: "modules" },
  { value: "88", label: "document tools" },
  { value: "7", label: "tool categories" },
];

export default function Landing({ onGetStarted }: { onGetStarted: () => void }) {
  // Freedom has no checkout to open while Stripe is out of the loop — the CTA
  // takes a name and a number and emails us instead.
  const [leadOpen, setLeadOpen] = useState(false);
  return (
    <div className="min-h-full overflow-y-auto bg-canvas text-ink font-sans">
      {/* ───────── Nav ───────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="text-lg font-semibold tracking-tight leading-none">Filey</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Sign in"
              onClick={onGetStarted}
              className="btn-ghost hidden sm:inline-flex"
            >
              Sign in
            </button>
            {/* One label per intent: the hero, the pricing card and the closing
                band all say "Get started free", so the nav says it too. */}
            <button
              aria-label="Get started free"
              onClick={onGetStarted}
              className="btn-primary"
            >
              Get started free
            </button>
          </div>
        </div>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden">
        <div className="relative mx-auto max-w-3xl px-6 pt-20 pb-10 text-center">
          <h1 className="text-4xl font-medium leading-[1.08] text-ink sm:text-6xl">
            Run your whole business
            <br className="hidden sm:block" /> in{" "}
            <span className="text-primary-700 dark:text-primary-300">one place</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-brand-500 sm:text-lg">
            ERP, CRM, invoicing and a full document-tools suite, with AI built in. One
            workspace instead of a stack of tools.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onGetStarted} className="btn-primary px-4">
              Get started free <ArrowRight size={15} />
            </button>
            <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer" className="btn-ghost px-4">
              <Download size={15} /> Download for Windows
            </a>
          </div>

          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-400">
            <Check size={13} className="text-success" /> No credit card · set up in
            minutes
          </p>
        </div>

        {/* Product preview. This is the app's own dashboard components rendered with
            sample figures, labelled as such - not a mock-up of a browser window.
            TODO: replace with a real screenshot of the running app once one exists. */}
        <div className="relative mx-auto -mb-10 max-w-5xl px-6">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-baseline justify-between border-b border-border px-5 py-3">
              <h3 className="text-base font-medium">Al Reem Trading</h3>
              <span className="text-[11px] font-medium text-brand-400">Sample data</span>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PREVIEW_STATS.map(({ label, value, delta, dir }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-border bg-card p-3"
                  >
                    <p className="text-[10px] font-medium text-brand-400">{label}</p>
                    <p className="mt-1 text-lg tabular-nums">{value}</p>
                    <span
                      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
                        dir === "up" ? "text-success" : "text-danger"
                      }`}
                    >
                      {dir === "up" ? (
                        <TrendingUp size={12} />
                      ) : (
                        <TrendingDown size={12} />
                      )}{" "}
                      {delta}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-muted p-4">
                <p className="text-[10px] font-medium text-brand-400 mb-3">
                  Monthly revenue
                </p>
                <div className="flex items-end gap-1.5 h-20">
                  {PREVIEW_REVENUE.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-full bg-primary-400"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-16">
        {/* Left-aligned on purpose. The hero, pricing and closing band are all
            centred, and a fourth centred header made the page read as one
            templated rhythm rather than a sequence of distinct sections. */}
        <div className="max-w-2xl">
          <h2 className="text-3xl font-medium sm:text-4xl">
            Everything your business runs on
          </h2>
          <p className="mt-3 text-brand-500">
            One workspace for operations, finance, customers and documents.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-400/15 text-primary-600 dark:text-primary-400">
                <f.icon size={20} />
              </span>
              <h3 className="mt-4 text-lg font-medium">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-500">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* stats */}
        <div className="mt-10 grid grid-cols-3 gap-4 rounded-xl border border-border bg-card p-6 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-3xl font-medium tabular-nums">{s.value}</p>
              <p className="mt-1 text-xs font-medium text-brand-400">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Pricing ───────── */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-medium sm:text-4xl">Simple, honest pricing</h2>
          <p className="mt-3 text-brand-500">
            Start free, or own it outright: one payment, yours for good.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2 items-stretch">
          {PLANS.map((p) => (
            <div
              key={p.id}
              className={`card flex flex-col !p-5 ${
                p.recommended ? "border-ink/25 dark:border-white/25" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-400">
                  {p.name}
                </p>
                {p.recommended && (
                  <span className="pill bg-primary-100 text-ink text-[11px]">
                    Recommended
                  </span>
                )}
              </div>
              <p className="mt-2 text-2xl font-bold tabular-nums text-ink">
                {p.price}
                {p.period && (
                  <span className="text-sm font-medium text-brand-400">{p.period}</span>
                )}
              </p>
              <p className="mt-1 text-sm text-brand-500">{p.blurb}</p>
              <ul className="mt-4 flex-1 space-y-2 border-t border-brand-100 pt-4 text-sm text-brand-500 dark:border-white/10">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check size={14} className="mt-0.5 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-5">
                {p.kind === "contact" ? (
                  <a href={ENTERPRISE_MAILTO} className="btn-ghost w-full">
                    Contact sales
                  </a>
                ) : (
                  <button
                    onClick={() => (p.kind === "license" ? setLeadOpen(true) : onGetStarted())}
                    className={p.recommended ? "btn-primary w-full" : "btn-ghost w-full"}
                  >
                    {p.id === "free" ? "Get started free" : `Get ${p.name}`}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-brand-400">
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink hover:underline"
          >
            Download the desktop app
          </a>
          . Every plan starts with the free download.
        </p>
      </section>

      {/* ───────── CTA band ───────── */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="relative overflow-hidden rounded-xl bg-cta px-8 py-14 text-center text-ink">
          <div className="relative mx-auto max-w-xl">
            <ScanText size={28} className="mx-auto" />
            <h2 className="mt-3 text-3xl font-medium sm:text-4xl">
              Start running Filey today
            </h2>
            <p className="mx-auto mt-3 max-w-md opacity-70">
              Bring inventory, sales, finance and documents into one place. Free to
              start.
            </p>
            <button
              onClick={onGetStarted}
              className="btn-secondary mt-6 px-4"
            >
              Get started free <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-brand-400 sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-medium text-brand-500">Filey</span>
          </div>
          <p>© {new Date().getFullYear()} Filey. All rights reserved.</p>
        </div>
      </footer>

      <FreedomContactModal open={leadOpen} onClose={() => setLeadOpen(false)} />
    </div>
  );
}
