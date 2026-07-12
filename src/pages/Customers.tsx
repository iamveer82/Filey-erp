import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { EMIRATES, normalizeEmirate } from "../lib/einvoice";
import {
  Plus,
  Trash2,
  Pencil,
  Mail,
  BadgeCheck,
  ArrowRight,
  AlarmClock,
  Download,
  Sliders,
  Activity,
  FileText,
  Info,
} from "lucide-react";
import { crm, type CrmCustomer } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { downloadCsv } from "../lib/csv";
import { num, cn } from "../lib/format";
import { CustomFieldsManager } from "../components/CustomFieldsManager";
import { inputTypeFor, validateCustomValue, type CustomFieldDef } from "../lib/customFields";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Modal,
  EmptyState,
  Badge,
  Field,
  ErrorBanner,
  FilterChip,
  SearchInput,
  InfoCard,
} from "../components/ui";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/Tabs";
import { Users } from "lucide-react";

// Local re-export so the form doesn't need a separate import.
const toE164Local = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("971")) return "+" + digits;
  if (digits.startsWith("0") && digits.length === 10) return "+971" + digits.slice(1);
  return null;
};

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
  const [vw, setVw] = useState<{ seg: string; email: boolean; trn: boolean }>(() => {
    try {
      return {
        seg: "",
        email: false,
        trn: false,
        ...JSON.parse(localStorage.getItem("crm.customers.view") || "{}"),
      };
    } catch (e) {
      console.warn("Failed to load saved customer view", e);
      return { seg: "", email: false, trn: false };
    }
  });
  useEffect(() => {
    localStorage.setItem("crm.customers.view", JSON.stringify(vw));
  }, [vw]);
  const segments = useMemo(
    () => [...new Set(rows.map((c) => c.segment).filter(Boolean))] as string[],
    [rows]
  );
  const hasFilter = !!vw.seg || vw.email || vw.trn;

  const filtered = useMemo(
    () =>
      rows.filter((c) => {
        const text = [c.name, c.company, c.email, c.trn].some((v) =>
          (v || "").toLowerCase().includes(q.toLowerCase())
        );
        if (!text) return false;
        if (vw.seg && c.segment !== vw.seg) return false;
        if (vw.email && !c.email) return false;
        if (vw.trn && !c.trn) return false;
        return true;
      }),
    [rows, q, vw]
  );

  const withTrn = rows.filter((c) => c.trn).length;
  const [manageOpen, setManageOpen] = useState(false);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Customers"
        subtitle="Your customer directory — names, TRN and addresses pulled onto invoices & quotations"
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
                  rows as unknown as Record<string, unknown>[],
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

      <div className="grid grid-cols-3 gap-4 mb-4">
        <MetricCard
          label="Customers"
          value={num(rows.length)}
          icon={<Users size={20} />}
        />
        <MetricCard
          label="With TRN"
          value={num(withTrn)}
          icon={<BadgeCheck size={20} />}
          iconClass="bg-info/15 text-info"
        />
        <MetricCard
          label="With email"
          value={num(rows.filter((c) => c.email).length)}
          icon={<Mail size={20} />}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search name, company, TRN…"
          className="w-full max-w-xs"
        />

        {segments.length > 0 && (
          <select
            className="select h-10 w-auto"
            value={vw.seg}
            onChange={(e) => setVw((v) => ({ ...v, seg: e.target.value }))}
          >
            <option value="">All segments</option>
            {segments.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}

        <FilterChip
          active={vw.email}
          onClick={() => setVw((v) => ({ ...v, email: !v.email }))}
        >
          Has email
        </FilterChip>
        <FilterChip active={vw.trn} onClick={() => setVw((v) => ({ ...v, trn: !v.trn }))}>
          Has TRN
        </FilterChip>

        {hasFilter && (
          <button
            aria-label="Clear filters"
            onClick={() => setVw({ seg: "", email: false, trn: false })}
            className="text-xs font-medium text-brand-500 hover:text-ink"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-brand-400">{filtered.length} shown</span>
      </div>

      <DataTable<CrmCustomer>
        rows={filtered}
        loading={loading}
        empty="No customers yet — add your first"
        onRowClick={(c) => setDetail(c)}
        columns={[
          {
            key: "name",
            label: "Customer",
            sortValue: (c) => (c.company || c.name || "").toLowerCase(),
            render: (c) => (
              <div className="min-w-0">
                <p className="truncate text-ink font-medium">{c.company || c.name}</p>
                <p className="truncate text-[11px] text-brand-400">{c.name}</p>
              </div>
            ),
          },
          {
            key: "trn",
            label: "TRN",
            sortValue: (c) => c.trn ?? "",
            render: (c) => (c.trn ? <span className="text-xs tabular-nums">{c.trn}</span> : "—"),
          },
          {
            key: "email",
            label: "Email",
            sortValue: (c) => c.email ?? "",
            render: (c) => c.email ?? "—",
            editable: {
              value: (c) => c.email ?? "",
              onSave: async (c, v) => {
                try {
                  await crm.updateCustomer(c.id, { email: v.trim() || undefined });
                  load();
                } catch (e: any) {
                  toast.error(e?.message || "Failed to update email");
                }
              },
            },
          },
          {
            key: "phone",
            label: "Phone",
            sortValue: (c) => c.phone ?? "",
            render: (c) => c.phone ?? "—",
            editable: {
              value: (c) => c.phone ?? "",
              onSave: async (c, v) => {
                try {
                  await crm.updateCustomer(c.id, { phone: v.trim() || undefined });
                  load();
                } catch (e: any) {
                  toast.error(e?.message || "Failed to update phone");
                }
              },
            },
          },
          {
            key: "segment",
            label: "Segment",
            sortValue: (c) => c.segment ?? "",
            render: (c) =>
              c.segment ? (
                <Badge tone="info">{c.segment}</Badge>
              ) : (
                <span className="text-brand-400">—</span>
              ),
          },
          {
            key: "act",
            label: "",
            render: (c) => (
              <div className="flex items-center justify-end gap-1">
                <button
                  aria-label="Edit"
                  className="rounded-xl p-1.5 text-brand-500 hover:bg-brand-100 dark:hover:bg-white/10 cursor-pointer"
                  onClick={() => {
                    setEdit(c);
                    setOpen(true);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  aria-label="Delete"
                  className="rounded-full p-1.5 text-danger hover:bg-danger/8 cursor-pointer"
                  onClick={async () => {
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
                >
                  <Trash2 size={13} />
                </button>
                <button
                  onClick={() => setDetail(c)}
                  className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-brand-500 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-white/10 cursor-pointer"
                >
                  View <ArrowRight size={11} />
                </button>
              </div>
            ),
          },
        ]}
      />

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
                          className="flex justify-between py-1 border-b border-brand-200/50 last:border-0 dark:border-[#2C2C2E]/50"
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

        <div className="flex justify-end gap-2 pt-4 border-t border-brand-200 dark:border-[#2C2C2E]">
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
    </div>
  );
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
            placeholder="Acme Trading LLC"
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
            <select
              className="select"
              value={f.country_subdivision}
              onChange={(e) => setF({ ...f, country_subdivision: e.target.value })}
            >
              <option value="">Select…</option>
              {EMIRATES.map((em) => (
                <option key={em.code} value={em.code}>
                  {em.label}
                </option>
              ))}
            </select>
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
        <div className="mt-4 border-t border-brand-200 dark:border-[#2C2C2E] pt-3">
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
                        <select
                          className={cn("select", err && "border-danger")}
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
                        >
                          <option value="">— Select —</option>
                          {def.options?.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
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
