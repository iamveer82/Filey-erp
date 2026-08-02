import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Flame, Globe, Sparkles, UserSearch, Users } from "lucide-react";

import { crm, billing, type CrmCustomer, type InvoiceDocSummary } from "../lib/api";
import { buildLeads, leadStats, HOT_SCORE, type Lead } from "../lib/marketing";
import { enrichFromWebsite, type CompanyDetails } from "../lib/scout";
import { reachReady } from "../lib/reach";
import { useUI } from "../lib/ui";
import { aed, errMsg, todayYmd } from "../lib/format";
import {
  PageHeader,
  DataTable,
  Badge,
  Modal,
  ErrorBanner,
  FilterChip,
  SearchInput,
} from "../components/ui";
import StatStrip from "../components/StatStrip";

/* Marketing: who to contact next, ranked from the books. The scoring is
 * deterministic (lib/marketing → lib/scout); the only network call on this page
 * is the optional per-lead enrichment, which reads a company's own website. */

const tone = (score: number) =>
  score >= HOT_SCORE ? "success" : score >= 30 ? "warn" : "info";

export default function Marketing() {
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "hot" | "incomplete">("all");
  const [enrichFor, setEnrichFor] = useState<Lead | null>(null);

  const load = () => {
    setError("");
    return Promise.all([
      crm.customers().then(setCustomers),
      billing.listDocs("sales").then(setInvoices),
    ])
      .catch((e) => setError(`Could not load leads: ${errMsg(e)}`))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  const leads = useMemo(
    () => buildLeads(customers, invoices, todayYmd()),
    [customers, invoices]
  );
  const stats = useMemo(() => leadStats(leads), [leads]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (filter === "hot" && l.score < HOT_SCORE) return false;
      if (filter === "incomplete" && !l.incomplete) return false;
      if (!q) return true;
      return [l.customer.name, l.customer.company, l.customer.email, l.domain]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [leads, search, filter]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Marketing"
        subtitle="Who to contact next, ranked from your own trading history"
        action={
          <Link to="/integrations/lead-enrichment" className="btn-ghost">
            <UserSearch size={15} /> Lead enrichment
          </Link>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {!reachReady() && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <Globe size={16} className="text-brand-400" />
          <span className="text-sm text-foreground">
            Ranking works offline. Turn on web access to also fill in missing contact
            details from a company's own site.
          </span>
          <Link to="/integrations/lead-enrichment" className="btn-secondary ml-auto">
            Connect
          </Link>
        </div>
      )}

      <StatStrip
        className="mb-4"
        items={[
          { label: "Leads", value: String(stats.total), icon: <Users size={14} /> },
          {
            label: `Hot (${HOT_SCORE}+)`,
            value: String(stats.hot),
            icon: <Flame size={14} />,
            tone: "positive",
          },
          {
            label: "Missing contact",
            value: String(stats.incomplete),
            tone: stats.incomplete ? "negative" : "neutral",
          },
          {
            label: "Enrichable",
            value: String(stats.enrichable),
            icon: <Sparkles size={14} />,
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search leads by name, company, email or domain…"
          className="w-full sm:max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={filter === "all"}
            onClick={() => setFilter("all")}
            count={stats.total}
          >
            All
          </FilterChip>
          <FilterChip
            active={filter === "hot"}
            tone="success"
            onClick={() => setFilter(filter === "hot" ? "all" : "hot")}
            count={stats.hot}
          >
            Hot
          </FilterChip>
          <FilterChip
            active={filter === "incomplete"}
            tone="warn"
            onClick={() => setFilter(filter === "incomplete" ? "all" : "incomplete")}
            count={stats.incomplete}
          >
            Missing contact
          </FilterChip>
        </div>
      </div>

      <DataTable<Lead>
        rows={shown}
        loading={loading}
        pageSize={10}
        rowKey={(l) => l.customer.id}
        empty={
          customers.length === 0
            ? "No customers yet — add one and they'll be ranked here"
            : "No leads match your search or filters"
        }
        onRowClick={(l) => nav(`/customers/${l.customer.id}`)}
        columns={[
          {
            key: "name",
            label: "Lead",
            sortValue: (l) => l.customer.name,
            render: (l) => (
              <div>
                <p className="font-medium text-ink">{l.customer.name}</p>
                <p className="text-[11px] text-brand-400">
                  {l.customer.email || l.customer.phone || "No contact on file"}
                </p>
              </div>
            ),
          },
          {
            key: "score",
            label: "Score",
            sortValue: (l) => l.score,
            render: (l) => (
              <span title={l.reasons.join(" · ") || "Nothing on file yet"}>
                <Badge tone={tone(l.score)}>{l.score}</Badge>
              </span>
            ),
          },
          {
            key: "why",
            label: "Why",
            render: (l) => (
              <span className="text-[12.5px] text-brand-500">
                {l.reasons[0] ?? "No trading history yet"}
              </span>
            ),
          },
          {
            key: "revenue",
            label: "Invoiced",
            sortValue: (l) => l.revenue,
            render: (l) => (l.revenue ? aed(l.revenue) : "—"),
          },
          {
            key: "seen",
            label: "Last invoice",
            sortValue: (l) => l.daysSinceActivity ?? 99_999,
            render: (l) =>
              l.daysSinceActivity == null
                ? "Never"
                : l.daysSinceActivity === 0
                  ? "Today"
                  : `${l.daysSinceActivity}d ago`,
          },
          {
            key: "act",
            label: "Actions",
            render: (l) => (
              <button
                className="btn-ghost h-7 px-2 text-[12.5px]"
                disabled={!l.domain || !reachReady()}
                title={
                  !reachReady()
                    ? "Turn on web access in Integrations"
                    : !l.domain
                      ? "No company domain — their email is personal or missing"
                      : `Read ${l.domain}`
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setEnrichFor(l);
                }}
              >
                <Sparkles size={13} /> Enrich
              </button>
            ),
          },
        ]}
      />

      <EnrichModal
        lead={enrichFor}
        onClose={() => setEnrichFor(null)}
        onSaved={() => {
          setEnrichFor(null);
          load();
        }}
        confirm={confirm}
        toast={toast}
      />
    </div>
  );
}

/** Reads the lead's own website and offers to write back only the fields that
 *  are currently empty — enrichment should never quietly overwrite something
 *  the user typed. */
function EnrichModal({
  lead,
  onClose,
  onSaved,
  confirm,
  toast,
}: {
  lead: Lead | null;
  onClose: () => void;
  onSaved: () => void;
  confirm: ReturnType<typeof useUI>["confirm"];
  toast: ReturnType<typeof useUI>["toast"];
}) {
  const [details, setDetails] = useState<CompanyDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    if (!lead?.domain) return;
    let dead = false;
    setDetails(null);
    setFailed("");
    setBusy(true);
    enrichFromWebsite(lead.domain)
      .then((d) => !dead && setDetails(d))
      .catch((e) => !dead && setFailed(errMsg(e)))
      .finally(() => !dead && setBusy(false));
    return () => {
      dead = true;
    };
  }, [lead]);

  if (!lead) return null;

  // Only offer what the record is actually missing.
  const c = lead.customer;
  const patch: Partial<CrmCustomer> = {};
  if (details) {
    if (!c.email?.trim() && details.emails[0]) patch.email = details.emails[0];
    if (!c.phone?.trim() && details.phones[0]) patch.phone = details.phones[0];
    if (!c.trn?.trim() && details.trn) patch.trn = details.trn;
  }
  const fields = Object.keys(patch) as (keyof CrmCustomer)[];

  const apply = async () => {
    const ok = await confirm({
      title: `Update ${c.name}`,
      message: `Save ${fields.join(", ")} from ${details?.source}?`,
      confirmLabel: "Save",
    });
    if (!ok) return;
    try {
      await crm.updateCustomer(c.id, patch);
      toast.success(`Updated ${c.name}.`);
      onSaved();
    } catch (e) {
      toast.error(errMsg(e) || "Could not save");
    }
  };

  return (
    <Modal open onClose={onClose} title={`Enrich ${c.name}`}>
      <p className="text-[12.5px] text-brand-500">
        Reading {lead.domain} — only what the company publishes on its own site.
      </p>

      {busy && <p className="mt-4 text-sm text-brand-500">Reading their website…</p>}
      {failed && <p className="mt-4 text-sm text-danger">{failed}</p>}

      {details && (
        <div className="mt-4 space-y-2 text-sm">
          <Row label="Found on" value={details.source} />
          <Row label="Emails" value={details.emails.join(", ") || "—"} />
          <Row label="Phones" value={details.phones.join(", ") || "—"} />
          <Row label="TRN" value={details.trn || "—"} />
          <Row label="Address" value={details.address || "—"} />
          {fields.length === 0 && (
            <p className="pt-2 text-[12.5px] text-brand-500">
              Nothing to add — this record already has everything the site lists.
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Close
        </button>
        <button className="btn-primary" disabled={fields.length === 0} onClick={apply}>
          Save{" "}
          {fields.length ? `${fields.length} field${fields.length > 1 ? "s" : ""}` : ""}
        </button>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-brand-500">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink">{value}</span>
    </div>
  );
}
