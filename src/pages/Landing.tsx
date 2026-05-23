import { motion } from "framer-motion";
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
  type LucideIcon,
} from "lucide-react";
import Logo from "../components/Logo";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.2, 0, 0.2, 1] as const },
};

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Boxes,
    title: "ERP that fits",
    desc: "Inventory, orders, suppliers and purchasing — one connected source of truth.",
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
    desc: "Merge, split, convert, sign and OCR — a full PDF suite, processed in the cloud.",
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

const STATS = [
  ["14", "modules"],
  ["95+", "document tools"],
  ["1", "place for everything"],
];

export default function Landing({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="min-h-full overflow-y-auto bg-canvas text-ink font-sans">
      {/* ───────── Nav ───────── */}
      <header className="sticky top-0 z-40 border-b border-brand-200/70 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="font-display text-lg font-bold tracking-tight">
              Filey
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onGetStarted}
              className="btn-ghost hidden h-9 sm:inline-flex"
            >
              Sign in
            </button>
            <button onClick={onGetStarted} className="btn-primary h-9">
              Get started
            </button>
          </div>
        </div>
      </header>

      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, rgba(255,214,0,0.18) 0%, transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-3xl px-6 pt-20 pb-10 text-center">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-semibold text-brand-600 shadow-sm shadow-black/5"
          >
            <Sparkles size={13} className="text-primary-600" />
            AI-powered business suite
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-ink sm:text-6xl"
          >
            Run your whole business
            <br className="hidden sm:block" />{" "}
            in <span className="text-gradient">one place</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-brand-500 sm:text-lg"
          >
            ERP, CRM, invoicing and a full document-tools suite — with AI built
            in. Filey replaces a stack of tools with one clean, online workspace.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <button
              onClick={onGetStarted}
              className="btn-primary h-11 px-5 text-[15px]"
            >
              Get started free <ArrowRight size={16} />
            </button>
            <button
              onClick={onGetStarted}
              className="btn-ghost h-11 px-5 text-[15px]"
            >
              Sign in
            </button>
          </motion.div>

          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-400">
            <Check size={13} className="text-success" /> No credit card · set up
            in minutes
          </p>
        </div>

        {/* Product preview */}
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="relative mx-auto -mb-10 max-w-5xl px-6"
        >
          <div className="overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-bento-hover">
            <div className="flex items-center gap-1.5 border-b border-brand-100 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-brand-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-brand-200" />
              <span className="ml-3 text-[11px] font-medium text-brand-400">
                app.filey — Overview
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              {[
                ["Total items", "1,284"],
                ["Inventory value", "AED 482k"],
                ["Open orders", "37"],
                ["Overdue", "4"],
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-brand-100 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-400">
                    {l}
                  </p>
                  <p className="mt-1 font-display text-xl font-bold tracking-tight">
                    {v}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2 px-4 pb-5">
              {[40, 64, 52, 78, 60, 88, 72, 96, 70].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-md bg-primary-300"
                  style={{ height: h }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* ───────── Features ───────── */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-16">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Everything your business runs on
          </h2>
          <p className="mt-3 text-brand-500">
            One workspace for operations, finance, customers and documents.
          </p>
        </motion.div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: (i % 3) * 0.06 }}
              className="card card-hover"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-100 text-primary-700">
                <f.icon size={20} />
              </span>
              <h3 className="mt-4 font-display text-lg font-bold tracking-tight">
                {f.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-brand-500">
                {f.desc}
              </p>
            </motion.div>
          ))}
        </div>

        {/* stats */}
        <motion.div
          {...fadeUp}
          className="mt-10 grid grid-cols-3 gap-4 rounded-2xl border border-brand-200 bg-white p-6 text-center shadow-bento"
        >
          {STATS.map(([n, l]) => (
            <div key={l}>
              <p className="font-display text-3xl font-extrabold tracking-tight">
                {n}
              </p>
              <p className="mt-1 text-xs font-medium text-brand-400">{l}</p>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ───────── CTA band ───────── */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-3xl bg-cta px-8 py-14 text-center text-ink shadow-glow-sm"
        >
          <div className="relative mx-auto max-w-xl">
            <ScanText size={28} className="mx-auto" />
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Start running Filey today
            </h2>
            <p className="mx-auto mt-3 max-w-md text-ink/70">
              Bring inventory, sales, finance and documents into one place — free
              to start.
            </p>
            <button
              onClick={onGetStarted}
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-6 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 cursor-pointer"
            >
              Get started free <ArrowRight size={16} />
            </button>
          </div>
        </motion.div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="border-t border-brand-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-brand-400 sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-semibold text-brand-600">Filey</span>
          </div>
          <p>© {new Date().getFullYear()} Filey. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
