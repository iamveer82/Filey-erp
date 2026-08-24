import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { EMIRATES, normalizeEmirate } from "../lib/einvoice";
import {
  Plus,
  AlarmClock,
  Download,
  Sliders,
  Activity,
  FileText,
  Info,
  Search,
  ArrowUpDown,
} from "lucide-react";
import { crm, type CrmCustomer } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import { num, cn } from "../lib/format";
import { CustomFieldsManager } from "../components/CustomFieldsManager";
import { inputTypeFor, validateCustomValue, type CustomFieldDef } from "../lib/customFields";
import { SelectMenu } from "../components/ui-menu";
import {
  PageHeader,
  Modal,
  EmptyState,
  Badge,
  Field,
  ErrorBanner,
  InfoCard,
  MetricCard,
  keyActivate,
} from "../components/ui";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/Tabs";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type QuickViewData,
} from "../components/RowActions";
import { Users } from "lucide-react";

// Local re-export so the form doesn't need a separate import.
const toE164Local = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("971")) return "+" + digits;
  if (digits.startsWith("0") && digits.length === 10) return "+971" + digits.slice(1);
  return null;
};

type SortKey = "company" | "trn" | "email" | "phone" | "segment";

export default function Customers() {
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const [rows, setRows] = useState<CrmCustomer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<CrmCustomer | null>(null);
  const [detail, setDetail] = useState<CrmCustomer | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [sortBy, setSortBy] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "company",
    dir: "asc",
  });
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (params.get("new") === "1") {
      setEdit(null);
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const load = () => {
    setError("");
    return crm
      .customers()
      .then(setRows)
      .catch((e) =>
        setError(`Could not load customers: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  // Persisted "saved view": the active filter set survives reloads.
  const [vw, setVw] = useState<{ email: boolean; trn: boolean }>(() => {
    try {
      return {
        email: false,
        trn: false,
        ...JSON.parse(localStorage.getItem("crm.customers.view") || "{}"),
      };
    } catch (e) {
      console.warn("Failed to load saved customer view", e);
      return { email: false, trn: false };
    }
  });
  useEffect(() => {
    localStorage.setItem("crm.customers.view", JSON.stringify(vw));
  }, [vw]);
  const segments = useMemo(
    () => [...new Set(rows.map((c) => c.segment).filter(Boolean))] as string[],
    [rows]
  );
  const hasFilter = vw.email || vw.trn;

  const filtered = useMemo(() => {
    const list = rows.filter((c) => {
      const text = [c.name, c.company, c.email, c.trn].some((v) =>
        (v || "").toLowerCase().includes(q.toLowerCase())
      );
      if (!text) return false;
      if (vw.email && !c.email) return false;
      if (vw.trn && !c.trn) return false;
      return true;
    });
    const { key, dir } = sortBy;
    const val = (c: CrmCustomer) =>
      (key === "company" ? c.company || c.name || "" : (c[key] ?? "") as string).toLowerCase();
    return [...list].sort((a, b) => {
      const cmp = val(a).localeCompare(val(b));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [rows, q, vw, sortBy]);

  const toggleSort = (key: SortKey) =>
    setSortBy((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  const withTrn = rows.filter((c) => c.trn).length;
  const withEmail = rows.filter((c) => c.email).length;
  const [manageOpen, setManageOpen] = useState(false);
  const [quickView, setQuickView] = useState<CrmCustomer | null>(null);

  // DEMO parity: duplicate a customer via the real create endpoint.
  const duplicate = async (c: CrmCustomer) => {
    try {
      const { id: _id, created_at: _ca, ...rest } = c;
      await crm.createCustomer({ ...rest, name: `${c.name} (copy)` });
      toast.success("Customer duplicated.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Customers"
        subtitle="Your customer directory: names, TRN and addresses pulled onto invoices & quotations"
        action={
          <div className="flex gap-2 flex-wrap">
            <button
              className="btn-ghost"
              aria-label="Manage custom fields"
              onClick={() => setManageOpen(true)}
            >
              <Sliders size={15} /> Customize fields
            </button>
            <button
              className="btn-ghost"
              aria-label="Export"
              onClick={() =>
                downloadCsv(
                  "filey-customers",
                  filtered as unknown as Record<string, unknown>[],
                  [
                    { key: "name", label: "Contact" },
                    { key: "company", label: "Company" },
                    { key: "trn", label: "TRN" },
                    { key: "email", label: "Email" },
                    { key: "phone", label: "Phone" },
                    { key: "address", label: "Address" },
                  ]
                )
              }
            >
              <Download size={15} /> Export
            </button>
            <button
              className="btn-ghost"
              aria-label="Follow-ups"
              onClick={() => nav("/follow-ups")}
            >
              <AlarmClock size={15} /> Follow-ups
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                setEdit(null);
                setOpen(true);
              }}
            >
              <Plus size={16} /> New customer
            </button>
          </div>
        }
      />
      <CustomFieldsManager
        open={manageOpen}
        onOpenChange={setManageOpen}
        module="customers"
        sampleValues={{ rating: "4.5", tier: "Gold" }}
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* ── KPI cards — same quiet strip as Invoicing ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 joined-kpis mb-4">
        <MetricCard
          label="Customers"
          value={num(rows.length)}
          change={segments.length > 0 ? `${segments.length} segments` : "No segments yet"}
          changeTone="up"
        />
        <MetricCard
          label="With TRN"
          value={num(withTrn)}
          change={
            rows.length - withTrn > 0
              ? `${num(rows.length - withTrn)} missing TRN`
              : "All registered"
          }
          changeTone={rows.length - withTrn > 0 ? "warn" : "up"}
        />
        <MetricCard
          label="With Email"
          value={num(withEmail)}
          change={
            rows.length - withEmail > 0
              ? `${num(rows.length - withEmail)} missing email`
              : "All reachable"
          }
          changeTone={rows.length - withEmail > 0 ? "warn" : "up"}
        />
      </div>

      {/* ── Table card: toolbar lives inside the card (DEMO reference) ── */}
      <div className="card p-0">
        <div className="px-4 pt-4 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, company, TRN…"
              className="pl-8 pr-3 h-8 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground text-[13px] w-[300px] outline-none focus:border-muted-foreground"
            />
          </div>
          <ToggleChip
            active={vw.email}
            onClick={() => setVw((v) => ({ ...v, email: !v.email }))}
          >
            Has email
          </ToggleChip>
          <ToggleChip active={vw.trn} onClick={() => setVw((v) => ({ ...v, trn: !v.trn }))}>
            Has TRN
          </ToggleChip>
          {hasFilter && (
            <button
              aria-label="Clear filters"
              onClick={() => setVw({ email: false, trn: false })}
              className="text-xs font-medium text-brand-500 hover:text-ink"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-[12px] text-muted-foreground">
            {filtered.length} shown
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH label="Customer" k="company" sortBy={sortBy} onSort={toggleSort} />
                <TH label="Contact" k="email" sortBy={sortBy} onSort={toggleSort} />
                <TH label="Segment" k="segment" sortBy={sortBy} onSort={toggleSort} />
                <th className="th w-10" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                rows.length === 0 &&
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={4} className="td">
                      <div className="h-4 w-2/3 rounded bg-hover animate-pulse" />
                    </td>
                  </tr>
                ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="td py-14">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="grid h-12 w-12 place-items-center rounded-xl bg-muted">
                        <Users size={24} className="text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {rows.length === 0 ? "No customers yet" : "No matches"}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">
                        {rows.length === 0 ? "Add your first customer to get started" : "Try adjusting your filters"}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  tabIndex={0}
                  onClick={() => nav(`/customers/${c.id}`)}
                  onKeyDown={keyActivate(() => nav(`/customers/${c.id}`))}
                  className="row-hover cursor-pointer"
                >
                  <td className="td">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {c.company || c.name}
                      </p>
                      <p className="truncate text-[11.5px] text-muted-foreground">
                        {c.name}
                      </p>
                    </div>
                  </td>
                  <td className="td">
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{c.email || <span className="text-muted-foreground">—</span>}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground">{c.phone || "—"}</p>
                    </div>
                  </td>
                  <td className="td text-muted-foreground">
                    {c.segment || "—"}
                  </td>
                  <td className="td w-10">
                    <div className="flex items-center gap-1 justify-end">
                      <RowActions
                        onView={() => setQuickView(c)}
                        onEdit={() => {
                          setEdit(c);
                          setOpen(true);
                        }}
                        onCopy={() => duplicate(c)}
                        onSend={{
                          ...(c.phone_e164 || c.phone
                            ? {
                                whatsapp: () =>
                                  shareVia("whatsapp", {
                                    phone: c.phone_e164 || c.phone,
                                    text: `Hello ${c.name},`,
                                  }),
                                sms: () =>
                                  shareVia("sms", {
                                    phone: c.phone_e164 || c.phone,
                                    text: `Hello ${c.name},`,
                                  }),
                              }
                            : {}),
                          ...(c.email
                            ? {
                                email: () =>
                                  shareVia("email", {
                                    email: c.email,
                                    url: c.company || c.name,
                                    text: `Hello ${c.name},`,
                                  }),
                              }
                            : {}),
                          copyLink: () => {
                            shareVia("copyLink", {
                              url: `${window.location.origin}/customers/${c.id}`,
                            });
                            toast.success("Customer link copied.");
                          },
                        }}
                        onDelete={async () => {
                          const ok = await confirm({
                            title: "Delete customer",
                            message: `Delete "${c.company || c.name}"?`,
                            confirmLabel: "Delete",
                            danger: true,
                          });
                          if (!ok) return;
                          await crm.deleteCustomer(c.id);
                          load();
                          toast.success("Customer deleted.");
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CustomerModal
        open={open}
        edit={edit}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />

      <Modal
        open={!!detail}
        onClose={() => {
          setDetail(null);
          setActiveTab("overview");
        }}
        title={detail?.company || detail?.name || "Customer"}
        size="lg"
      >
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4 w-full">
            {[
              { id: "overview", label: "Overview", icon: <Info size={12} /> },
              { id: "activity", label: "Activity", icon: <Activity size={12} /> },
              { id: "invoices", label: "Invoices", icon: <FileText size={12} /> },
            ].map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.icon}
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {detail && (
              <>
                <InfoCard title="Segment">
                  {detail.segment ? (
                    <Badge tone="info">{detail.segment}</Badge>
                  ) : (
                    <span className="text-brand-400">—</span>
                  )}
                </InfoCard>
                <InfoCard title="Details">
                  <dl className="space-y-1">
                    {[
                      { label: "Name", value: detail.name },
                      { label: "Company", value: detail.company },
                      { label: "TRN", value: detail.trn, mono: true },
                      { label: "Email", value: detail.email, mono: true },
                      { label: "Phone", value: detail.phone, mono: true },
                      { label: "Phone (E.164)", value: detail.phone_e164, mono: true },
                      { label: "Address", value: detail.address },
                      {
                        label: "Created",
                        value: (detail as any).created_at
                          ? new Date((detail as any).created_at).toLocaleDateString()
                          : null,
                      },
                    ].map(({ label, value, mono }) =>
                      value ? (
                        <div
                          key={label}
                          className="flex justify-between py-1 border-b border-brand-200/50 last:border-0"
                        >
                          <dt className="text-[11px] text-brand-500">{label}</dt>
                          <dd className={cn("text-sm text-ink", mono && "tabular-nums")}>
                            {value}
                          </dd>
                        </div>
                      ) : null
                    )}
                  </dl>
                </InfoCard>
              </>
            )}
          </TabsContent>

          <TabsContent value="activity">
            <EmptyState
              icon={Activity}
              title="Activity is on the full page"
              description="Open the full customer page to see notes, calls and emails."
            />
          </TabsContent>

          <TabsContent value="invoices">
            <EmptyState
              icon={FileText}
              title="Invoices are on the full page"
              description="Open the full customer page to see this customer's invoices."
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t border-brand-200">
          <button
            onClick={() => detail && nav(`/customers/${detail.id}?statement=1`)}
            className="btn-ghost"
          >
            <FileText size={14} /> Statement
          </button>
          <button
            onClick={() => detail && nav(`/customers/${detail.id}`)}
            className="btn-ghost"
          >
            Full page
          </button>
          <button
            onClick={() => {
              if (!detail) return;
              setEdit(detail);
              setOpen(true);
              setDetail(null);
            }}
            className="btn-primary"
          >
            Edit
          </button>
        </div>
      </Modal>

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        data={
          quickView
            ? customerQuickView(quickView, () => {
                nav(`/customers/${quickView.id}`);
                setQuickView(null);
              })
            : null
        }
        onEdit={
          quickView
            ? () => {
                setEdit(quickView);
                setOpen(true);
                setQuickView(null);
              }
            : undefined
        }
      />
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 h-8 rounded-md text-[13px] border transition-colors inline-flex items-center gap-1.5",
        active
          ? "bg-foreground text-background border-foreground"
          : "bg-card text-muted-foreground border-border hover:bg-hover hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function TH({
  label,
  k,
  sortBy,
  onSort,
}: {
  label: string;
  k: SortKey;
  sortBy: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
}) {
  const active = sortBy.key === k;
  return (
    <th className="th">
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground"
        )}
      >
        {label} <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

/** DEMO parity: map a customer record onto the shared QuickViewModal shape. */
function customerQuickView(
  c: CrmCustomer,
  onFullPage: () => void
): QuickViewData {
  const emirate = EMIRATES.find(
    (e) => e.code === normalizeEmirate(c.country_subdivision)
  )?.label;
  const meta = [
    { label: "TRN", value: c.trn },
    { label: "Email", value: c.email },
    { label: "Phone", value: c.phone },
    { label: "Phone (E.164)", value: c.phone_e164 },
    { label: "Address", value: c.address },
    { label: "City", value: c.city },
    { label: "Emirate", value: emirate },
    { label: "Country", value: c.country_code },
    {
      label: "Credit limit (AED)",
      value: c.credit_limit != null ? num(c.credit_limit) : undefined,
    },
    {
      label: "Opening balance (AED)",
      value: c.opening_balance != null ? num(c.opening_balance) : undefined,
    },
    {
      label: "Created",
      value: c.created_at
        ? new Date(c.created_at).toLocaleDateString()
        : undefined,
    },
  ].filter((m) => m.value != null && m.value !== "");
  return {
    title: c.company || c.name,
    subtitle: c.company ? c.name : undefined,
    badge: c.segment ? <Badge tone="info">{c.segment}</Badge> : undefined,
    meta,
    footer: (
      <div className="mt-4 flex justify-end border-t border-border pt-3">
        <button
          onClick={onFullPage}
          className="h-8 px-3 rounded-md text-[12.5px] border border-border hover:bg-hover text-foreground inline-flex items-center gap-1.5"
        >
          Open full page
        </button>
      </div>
    ),
  };
}

function CustomerModal({
  open,
  edit,
  onClose,
  onSaved,
}: {
  open: boolean;
  edit: CrmCustomer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  type FormState = {
    name: string;
    company: string;
    trn: string;
    address: string;
    city: string;
    country_subdivision: string;
    country_code: string;
    email: string;
    phone: string;
    credit_limit: string;
    opening_balance: string;
    custom_fields: Record<string, string>;
  };
  const blank: FormState = {
    name: "",
    company: "",
    trn: "",
    address: "",
    city: "",
    country_subdivision: "",
    country_code: "AE",
    email: "",
    phone: "",
    credit_limit: "",
    opening_balance: "",
    custom_fields: {},
  };
  const [f, setF] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);

  useEffect(() => {
    import("../lib/customFields").then((m) => setCustomDefs(m.listCustomFields("customers")));
  }, []);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    if (edit) {
      const next: FormState = {
        name: edit.name ?? "",
        company: edit.company ?? "",
        trn: edit.trn ?? "",
        address: edit.address ?? "",
        city: edit.city ?? "",
        country_subdivision: normalizeEmirate(edit.country_subdivision),
        country_code: edit.country_code ?? "AE",
        email: edit.email ?? "",
        phone: edit.phone ?? "",
        credit_limit: edit.credit_limit != null ? String(edit.credit_limit) : "",
        opening_balance: edit.opening_balance != null ? String(edit.opening_balance) : "",
        custom_fields: edit.custom_fields ?? {},
      };
      setF(next);
    } else {
      setF(blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit]);

  const nameErr = !f.name.trim();

  /** Run validation on every custom field. Returns the first error
   * message, or null when all required + types are OK. */
  const customErr = (() => {
    if (!f.custom_fields) return null;
    for (const def of customDefs) {
      const v = f.custom_fields[def.key] ?? "";
      const err = validateCustomValue(def, v);
      if (err) return err;
    }
    return null;
  })();

  const save = async () => {
    setTouched(true);
    if (nameErr) return;
    if (customErr) {
      toast.error(customErr);
      return;
    }
    setSaving(true);
    try {
      // Also populate phone_e164 from phone for OTP / SMS
      const e164 = toE164Local(f.phone);
      const payload: Record<string, unknown> = {
        name: f.name.trim(),
        company: f.company.trim() || undefined,
        trn: f.trn.trim() || undefined,
        email: f.email.trim() || undefined,
        phone: f.phone.trim() || undefined,
        address: f.address.trim() || undefined,
        city: f.city.trim() || undefined,
        country_subdivision: f.country_subdivision || undefined,
        country_code: f.country_code.trim() || undefined,
        credit_limit: f.credit_limit.trim() === "" ? undefined : Number(f.credit_limit),
        opening_balance:
          f.opening_balance.trim() === "" ? undefined : Number(f.opening_balance),
        phone_e164: e164 ?? undefined,
        custom_fields:
          Object.keys(f.custom_fields || {}).length > 0
            ? f.custom_fields
            : undefined,
      };
      if (edit) await crm.updateCustomer(edit.id, payload);
      else
        await crm.createCustomer(
          payload as unknown as Omit<CrmCustomer, "id" | "created_at">
        );
      toast.success(edit ? "Customer updated." : "Customer added.");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={edit ? "Edit customer" : "New customer"}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact name *">
          <input
            className={cn("input", touched && nameErr && "border-danger")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Company">
          <input
            className="input"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
            placeholder="Gulf Line Trading LLC"
          />
        </Field>
        <Field label="TRN">
          <input
            className="input"
            value={f.trn}
            onChange={(e) => setF({ ...f, trn: e.target.value })}
            placeholder="100000000000003"
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            placeholder="billing@company.com"
          />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            placeholder="+971 50 123 4567"
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Address">
          <input
            className="input"
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            placeholder="Street, City, Country"
          />
        </Field>
        {/* UAE e-invoice: buyer location (pulled onto invoices). */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Field label="City">
            <input
              className="input"
              value={f.city}
              onChange={(e) => setF({ ...f, city: e.target.value })}
              placeholder="Dubai"
            />
          </Field>
          <Field label="Emirate">
            <SelectMenu
              ariaLabel="Emirate"
              value={f.country_subdivision}
              onChange={(country_subdivision) =>
                setF({ ...f, country_subdivision })
              }
              options={[
                { value: "", label: "Select…" },
                ...EMIRATES.map((em) => ({ value: em.code, label: em.label })),
              ]}
            />
          </Field>
          <Field label="Country">
            <input
              className="input"
              value={f.country_code}
              onChange={(e) =>
                setF({ ...f, country_code: e.target.value.toUpperCase() })
              }
              placeholder="AE"
            />
          </Field>
        </div>
        {/* Credit & balance (Vyapar parity). Opening balance: + = they owe you. */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Credit limit (AED)">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={f.credit_limit}
              onChange={(e) => setF({ ...f, credit_limit: e.target.value })}
              placeholder="e.g. 100000"
            />
          </Field>
          <Field label="Opening balance (AED)">
            <input
              className="input"
              type="number"
              step="0.01"
              value={f.opening_balance}
              onChange={(e) => setF({ ...f, opening_balance: e.target.value })}
              placeholder="+ receivable / − payable"
            />
          </Field>
        </div>
      </div>

      {/* User-defined custom fields (Odoo Studio). Only renders
      when at least one field is defined. */}
      {customDefs.length > 0 && (
        <div className="mt-4 border-t border-brand-200 pt-3">
          <p className="text-[11px] font-medium text-brand-500 mb-2">Custom fields</p>
          <div className="grid grid-cols-2 gap-3">
            {customDefs
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((def) => {
                const v = f.custom_fields?.[def.key] ?? "";
                const err = touched ? validateCustomValue(def, v) : null;
                return (
                  <div
                    key={def.id}
                    className={def.type === "checkbox" ? "col-span-2" : ""}
                  >
                    <Field label={`${def.label}${def.required ? " *" : ""}`}>
                      {def.type === "checkbox" ? (
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={v === "true"}
                            onChange={(e) =>
                              setF({
                                ...f,
                                custom_fields: {
                                  ...f.custom_fields,
                                  [def.key]: e.target.checked ? "true" : "false",
                                },
                              })
                            }
                          />
                          <span className="text-brand-500">
                            {v === "true" ? "Yes" : "No"}
                          </span>
                        </label>
                      ) : def.type === "select" ? (
                        <SelectMenu
                          ariaLabel={def.label}
                          className={cn(err && "border-danger")}
                          value={v}
                          onChange={(value) =>
                            setF({
                              ...f,
                              custom_fields: {
                                ...f.custom_fields,
                                [def.key]: value,
                              },
                            })
                          }
                          options={[
                            { value: "", label: "Select…" },
                            ...(def.options ?? []).map((o) => ({
                              value: o,
                              label: o,
                            })),
                          ]}
                        />
                      ) : (
                        <input
                          className={cn("input", err && "border-danger")}
                          type={inputTypeFor(def.type)}
                          value={v}
                          onChange={(e) =>
                            setF({
                              ...f,
                              custom_fields: {
                                ...f.custom_fields,
                                [def.key]: e.target.value,
                              },
                            })
                          }
                          placeholder={
                            def.type === "phone"
                              ? "+971 50 123 4567"
                              : def.type === "url"
                                ? "https://example.com"
                                : ""
                          }
                        />
                      )}
                      {err && <p className="error-text mt-0.5">{err}</p>}
                    </Field>
                  </div>
                );
              })}
          </div>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          disabled={saving || (touched && nameErr)}
          onClick={save}
        >
          {saving ? "Saving…" : edit ? "Save changes" : "Save customer"}
        </button>
      </div>
    </Modal>
  );
}
