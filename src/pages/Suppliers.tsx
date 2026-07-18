import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Users,
  Boxes,
  AlertTriangle,
  Package,
  Plus,
  Sliders,
  AlarmClock,
  Download,
} from "lucide-react";
import {
  erp,
  suppliers as suppliersApi,
  shareRecord,
  Product,
  Supplier,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, num } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { CustomFieldsManager } from "../components/CustomFieldsManager";
import { Button, Card, Field, Badge, DataTable, Modal, MetricCard, PageHeader, ShareToggle, ErrorBanner } from "../components/primitives";
import { SearchInput } from "../components/ui";
import {
  RowActions,
  QuickViewModal,
  shareVia,
  type QuickViewData,
} from "../components/RowActions";

interface CategoryGroup {
  name: string;
  skus: number;
  value: number;
  low: number;
}

export default function Suppliers() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [edit, setEdit] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [quickView, setQuickView] = useState<Supplier | null>(null);
  const { confirm, toast } = useUI();
  const nav = useNavigate();
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
    return Promise.all([
      erp.products().then(setProducts),
      suppliersApi.list().then(setSuppliers),
    ])
      .catch((e) =>
        setError(`Could not load suppliers: ${e instanceof Error ? e.message : e}`)
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  useLiveSync(load);

  const groups = useMemo<CategoryGroup[]>(() => {
    const m = new Map<string, CategoryGroup>();
    for (const p of products) {
      const key = p.category || "Unsorted";
      const g = m.get(key) ?? { name: key, skus: 0, value: 0, low: 0 };
      g.skus += 1;
      // Guard unset/NaN qty or cost so a product with no cost price adds 0 (not NaN).
      g.value += (Number(p.quantity) || 0) * (Number(p.cost_price) || 0);
      if (p.quantity <= p.reorder_level) g.low += 1;
      m.set(key, g);
    }
    return Array.from(m.values()).sort((a, b) => b.value - a.value);
  }, [products]);

  const totalValue = groups.reduce((s, g) => s + g.value, 0);
  const totalLow = groups.reduce((s, g) => s + g.low, 0);

  // DEMO parity: client-side search across the visible supplier fields.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return suppliers;
    return suppliers.filter((s) =>
      [s.name, s.contact_person, s.email, s.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }, [suppliers, q]);

  // DEMO parity: duplicate a supplier via the real create endpoint.
  const duplicate = async (s: Supplier) => {
    try {
      const { id: _id, created_at: _ca, shared: _sh, ...rest } = s;
      await suppliersApi.create({ ...rest, name: `${s.name} (copy)` });
      toast.success("Supplier duplicated.");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Suppliers"
        subtitle="Vendors you buy from — track balances and purchase history"
        action={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="md" onClick={() => setManageOpen(true)}>
              <Sliders size={15} /> Customize fields
            </Button>
            <button
              className="btn-ghost"
              aria-label="Export"
              onClick={() =>
                downloadCsv(
                  "filey-suppliers",
                  filtered as unknown as Record<string, unknown>[],
                  [
                    { key: "name", label: "Supplier" },
                    { key: "contact_person", label: "Contact" },
                    { key: "email", label: "Email" },
                    { key: "phone", label: "Phone" },
                    { key: "address", label: "Address" },
                    { key: "tax_id", label: "Tax ID / TRN" },
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
            <Button
              variant="primary"
              size="md"
              aria-label="New supplier"
              onClick={() => {
                setEdit(null);
                setOpen(true);
              }}
            >
              <Plus size={16} /> New Supplier
            </Button>
          </div>
        }
      />
      <CustomFieldsManager
        open={manageOpen}
        onOpenChange={setManageOpen}
        module="suppliers"
        sampleValues={{ region: "Sharjah", lead_time: "5 days" }}
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 joined-kpis mb-4">
        <MetricCard
          label="Suppliers"
          value={num(suppliers.length)}
          icon={<Users size={20} />}
          iconClass="bg-primary-100 text-ink"
        />
        <MetricCard
          label="Sourced SKUs"
          value={num(products.length)}
          icon={<Boxes size={20} />}
          iconClass="bg-primary-100 text-ink"
        />
        <MetricCard
          label="Sourcing Value"
          value={aed(totalValue)}
          icon={<Package size={20} />}
          iconClass="bg-primary-100 text-ink"
        />
        <MetricCard
          label="At Reorder"
          value={num(totalLow)}
          icon={<AlertTriangle size={20} />}
          iconClass="bg-danger/15 text-danger"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search supplier, contact, email…"
          className="w-full max-w-xs"
        />
        <span className="ml-auto text-[11px] font-medium text-brand-400 tracking-tight">{filtered.length} shown</span>
      </div>

      <DataTable<Supplier>
        rows={filtered}
        loading={loading}
        empty="No suppliers yet — add your first one"
        onRowClick={(s) => nav(`/suppliers/${s.id}`)}
        columns={[
          {
            key: "name",
            label: "Supplier",
            sortValue: (s) => s.name,
            render: (s) => (
              <div className="min-w-0">
                <p className="truncate text-ink font-medium">{s.name}</p>
                <p className="truncate text-[11px] text-brand-400 font-mono">SUP-{s.id}</p>
              </div>
            ),
          },
          {
            key: "contact",
            label: "Contact",
            sortValue: (s) => s.contact_person ?? "",
            render: (s) => s.contact_person ?? "—",
          },
          {
            key: "email",
            label: "Email",
            sortValue: (s) => s.email ?? "",
            render: (s) => s.email ?? "—",
          },
          {
            key: "phone",
            label: "Phone",
            sortValue: (s) => s.phone ?? "",
            render: (s) => s.phone ?? "—",
          },
          {
            key: "share",
            label: "Sharing",
            render: (s) => (
              <ShareToggle
                shared={s.shared}
                onToggle={async (next) => {
                  try {
                    await shareRecord("suppliers", s.id, next);
                    load();
                    toast.success(next ? "Shared with team." : "Set to private.");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            ),
          },
          {
            key: "act",
            label: "",
            render: (s) => (
              <RowActions
                onView={() => setQuickView(s)}
                onEdit={() => {
                  setEdit(s);
                  setOpen(true);
                }}
                onCopy={() => duplicate(s)}
                onSend={{
                  ...(s.phone
                    ? {
                        whatsapp: () =>
                          shareVia("whatsapp", {
                            phone: s.phone,
                            text: `Hello ${s.name},`,
                          }),
                        sms: () =>
                          shareVia("sms", {
                            phone: s.phone,
                            text: `Hello ${s.name},`,
                          }),
                      }
                    : {}),
                  ...(s.email
                    ? {
                        email: () =>
                          shareVia("email", {
                            email: s.email,
                            url: s.name,
                            text: `Hello ${s.name},`,
                          }),
                      }
                    : {}),
                  copyLink: () => {
                    shareVia("copyLink", {
                      url: `${window.location.origin}/suppliers/${s.id}`,
                    });
                    toast.success("Supplier link copied.");
                  },
                }}
                onDelete={async () => {
                  const ok = await confirm({
                    title: "Delete supplier",
                    message: `Delete supplier "${s.name}"?`,
                    confirmLabel: "Delete",
                    danger: true,
                  });
                  if (!ok) return;
                  await suppliersApi.remove(s.id);
                  load();
                  toast.success("Supplier deleted.");
                }}
              />
            ),
          },
        ]}
      />

      <p className="mt-8 mb-3 text-xs font-medium text-brand-500">By product category</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g.name} className="flex flex-col gap-4 hover:border-primary-300 transition-colors duration-200">
            <div className="flex items-start justify-between">
              <div className="rounded-xl bg-primary-100 text-ink p-3">
                <Package size={22} />
              </div>
              {g.low > 0 ? (
                <Badge tone="warn">{g.low} low</Badge>
              ) : (
                <Badge tone="success">healthy</Badge>
              )}
            </div>
            <div>
              <p className="text-lg font-semibold text-ink">{g.name}</p>
              <p className="text-sm text-brand-500 mt-0.5">
                {g.skus} SKU{g.skus === 1 ? "" : "s"} sourced
              </p>
            </div>
            <div className="mt-auto pt-3 border-t border-brand-200 flex items-center justify-between">
              <span className="text-xs font-medium text-brand-500">Sourcing value</span>
              <span className="text-sm font-semibold text-ink">{aed(g.value)}</span>
            </div>
          </Card>
        ))}
        {groups.length === 0 && (
          <Card className="col-span-full text-center text-sm text-brand-500">
            No supplier groups yet — add products with categories to see sourcing
            performance.
          </Card>
        )}
      </div>

      <SupplierModal
        open={open}
        initial={edit}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />

      <QuickViewModal
        open={!!quickView}
        onClose={() => setQuickView(null)}
        data={
          quickView
            ? supplierQuickView(quickView, () => {
                nav(`/suppliers/${quickView.id}`);
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

/** DEMO parity: map a supplier record onto the shared QuickViewModal shape. */
function supplierQuickView(s: Supplier, onFullPage: () => void): QuickViewData {
  const bank = s.bank_details ?? {};
  const meta = [
    { label: "Contact person", value: s.contact_person },
    { label: "Email", value: s.email },
    { label: "Phone", value: s.phone },
    { label: "Tax ID / TRN", value: s.tax_id },
    { label: "Address", value: s.address },
    { label: "Bank", value: bank.bank_name },
    {
      label: "IBAN / Account",
      value: bank.iban || bank.account_number,
    },
    {
      label: "Created",
      value: s.created_at
        ? new Date(s.created_at).toLocaleDateString()
        : undefined,
    },
  ].filter((m) => m.value != null && m.value !== "");
  return {
    title: s.name,
    subtitle: s.contact_person ? `Contact: ${s.contact_person}` : undefined,
    badge: s.shared ? (
      <Badge tone="info">Shared</Badge>
    ) : (
      <Badge tone="neutral">Private</Badge>
    ),
    meta,
    notes: s.notes || undefined,
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

function SupplierModal({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useUI();
  const [f, setF] = useState({
    name: "",
    contact_person: "",
    email: "",
    phone: "",
    address: "",
    tax_id: "",
    notes: "",
  });
  useEffect(() => {
    if (open) {
      setF({
        name: initial?.name ?? "",
        contact_person: initial?.contact_person ?? "",
        email: initial?.email ?? "",
        phone: initial?.phone ?? "",
        address: initial?.address ?? "",
        tax_id: initial?.tax_id ?? "",
        notes: initial?.notes ?? "",
      });
    }
  }, [open, initial]);

  const save = async () => {
    if (!f.name.trim()) {
      toast.error("Supplier name is required.");
      return;
    }
    const payload = {
      name: f.name.trim(),
      contact_person: f.contact_person || undefined,
      email: f.email || undefined,
      phone: f.phone || undefined,
      address: f.address || undefined,
      tax_id: f.tax_id || undefined,
      notes: f.notes || undefined,
    };
    try {
      if (initial) await suppliersApi.update(initial.id, payload);
      else await suppliersApi.create(payload);
      toast.success(initial ? "Supplier updated." : "Supplier added.");
      onSaved();
    } catch (e) {
      toast.error(
        `Could not save supplier: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit Supplier" : "New Supplier"}
    >
      <div className="space-y-3">
        <Field label="Name *">
          <input
            className="input"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label="Contact person">
          <input
            className="input"
            value={f.contact_person}
            onChange={(e) => setF({ ...f, contact_person: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Address">
          <textarea
            className="input"
            rows={2}
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
          />
        </Field>
        <Field label="Tax ID / TRN">
          <input
            className="input"
            value={f.tax_id}
            onChange={(e) => setF({ ...f, tax_id: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <textarea
            className="input"
            rows={2}
            value={f.notes}
            onChange={(e) => setF({ ...f, notes: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save}>
          Save Supplier
        </Button>
      </div>
    </Modal>
  );
}
