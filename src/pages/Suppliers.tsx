import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Building2,
  Boxes,
  AlertTriangle,
  Package,
  Plus,
  Sliders,
  AlarmClock,
  Download,
  Search,
  ArrowUpDown,
  ChevronRight,
} from "lucide-react";
import {
  erp,
  pos,
  suppliers as suppliersApi,
  Product,
  PoSummary,
  Supplier,
} from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { aed, num, money, cn } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { CustomFieldsManager } from "../components/CustomFieldsManager";
import { Button, Card, Field, Badge, Modal, PageHeader, ErrorBanner } from "../components/primitives";
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

type SortKey = "name" | "category" | "contact" | "balance";

/** Contact column: prefer the contact person, fall back to email. */
const contactOf = (s: Supplier) => s.contact_person || s.email || "";

export default function Suppliers() {
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PoSummary[]>([]);
  const [poPayments, setPoPayments] = useState<{ po_id: number; amount: number }[]>([]);
  const [edit, setEdit] = useState<Supplier | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [quickView, setQuickView] = useState<Supplier | null>(null);
  const [sortBy, setSortBy] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "name",
    dir: "asc",
  });
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
      pos.list().then(setOrders),
      pos.allPayments().then(setPoPayments),
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

  // Category column: the dominant (most frequent) product category among a
  // supplier's own products; empty when the supplier has none.
  const categoryBySupplier = useMemo(() => {
    const counts = new Map<number, Map<string, number>>();
    for (const p of products) {
      if (p.supplier_id == null || !p.category) continue;
      const m = counts.get(p.supplier_id) ?? new Map<string, number>();
      m.set(p.category, (m.get(p.category) ?? 0) + 1);
      counts.set(p.supplier_id, m);
    }
    const out = new Map<number, string>();
    for (const [sid, m] of counts) {
      let best = "";
      let bestN = 0;
      for (const [cat, n] of m) {
        if (n > bestN) {
          best = cat;
          bestN = n;
        }
      }
      out.set(sid, best);
    }
    return out;
  }, [products]);

  // Open balance per supplier: PO totals (excluding cancelled POs) minus
  // recorded payments — same derivation as the supplier detail page.
  const balanceBySupplier = useMemo(() => {
    const paidByPo = new Map<number, number>();
    for (const p of poPayments) {
      paidByPo.set(p.po_id, (paidByPo.get(p.po_id) ?? 0) + (Number(p.amount) || 0));
    }
    const out = new Map<number, number>();
    for (const o of orders) {
      if (o.supplier_id == null) continue;
      if ((o.status || "").toLowerCase() === "cancelled") continue;
      const open = (Number(o.total) || 0) - (paidByPo.get(o.id) ?? 0);
      out.set(o.supplier_id, (out.get(o.supplier_id) ?? 0) + open);
    }
    return out;
  }, [orders, poPayments]);

  // DEMO parity: client-side search across the visible supplier fields, then
  // client-side sort on the DEMO column keys.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = suppliers.filter((s) => {
      if (!needle) return true;
      return [s.name, categoryBySupplier.get(s.id), contactOf(s), s.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    const { key, dir } = sortBy;
    const val = (s: Supplier): string | number =>
      key === "name"
        ? s.name.toLowerCase()
        : key === "category"
          ? (categoryBySupplier.get(s.id) ?? "").toLowerCase()
          : key === "contact"
            ? contactOf(s).toLowerCase()
            : (balanceBySupplier.get(s.id) ?? 0);
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [suppliers, q, sortBy, categoryBySupplier, balanceBySupplier]);

  const toggleSort = (key: SortKey) =>
    setSortBy((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

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

      {/* ── KPI tiles (DEMO reference: icon box + value + muted hint) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-border rounded-xl overflow-hidden bg-card mb-4">
        <KpiTile
          icon={Building2}
          accent="bg-neutral-500/10 text-neutral-500 dark:text-neutral-300"
          label="Suppliers"
          value={num(suppliers.length)}
          hint="Vendors registered"
          divider="border-b sm:border-b-0 sm:border-r"
        />
        <KpiTile
          icon={Boxes}
          accent="bg-sky-500/10 text-sky-600 dark:text-sky-400"
          label="Sourced SKUs"
          value={num(products.length)}
          hint={`Across ${groups.length} categories`}
          divider="border-b sm:border-b-0 lg:border-r"
        />
        <KpiTile
          icon={Package}
          accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          label="Sourcing Value"
          value={aed(totalValue)}
          hint="Stock on hand at cost"
          divider="border-b sm:border-b-0 sm:border-r"
        />
        <KpiTile
          icon={AlertTriangle}
          accent="bg-amber-500/10 text-amber-600 dark:text-amber-500"
          label="At Reorder"
          value={num(totalLow)}
          hint="SKUs at/below reorder level"
        />
      </div>

      {/* ── Table card ── */}
      <div className="card p-0">
        <div className="px-4 pt-4 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search supplier or category…"
              className="pl-8 pr-3 h-8 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground text-[13px] w-[300px] outline-none focus:border-muted-foreground"
            />
          </div>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {filtered.length} shown
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH label="Supplier" k="name" sortBy={sortBy} onSort={toggleSort} />
                <TH label="Category" k="category" sortBy={sortBy} onSort={toggleSort} />
                <TH label="Contact" k="contact" sortBy={sortBy} onSort={toggleSort} />
                <TH label="Open balance" k="balance" sortBy={sortBy} onSort={toggleSort} right />
                <th className="th w-10" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                suppliers.length === 0 &&
                [0, 1, 2].map((i) => (
                  <tr key={i}>
                    <td colSpan={5} className="td">
                      <div className="h-4 w-2/3 rounded bg-hover animate-pulse" />
                    </td>
                  </tr>
                ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="td py-14">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="grid h-12 w-12 place-items-center rounded-xl bg-muted">
                        <Building2 size={24} className="text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {suppliers.length === 0 ? "No suppliers yet" : "No matches"}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">
                        {suppliers.length === 0 ? "Add your first supplier to get started" : "Try adjusting your search"}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => nav(`/suppliers/${s.id}`)}
                  className="row-hover cursor-pointer"
                >
                  <td className="td">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{s.name}</p>
                      <p className="truncate text-[11.5px] text-muted-foreground font-mono">
                        SUP-{s.id}
                      </p>
                    </div>
                  </td>
                  <td className="td">
                    {categoryBySupplier.get(s.id) || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="td">
                    {contactOf(s) || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="td text-right tabular-nums">
                    {money(balanceBySupplier.get(s.id) ?? 0)}
                  </td>
                  <td className="td w-10">
                    <div className="flex items-center gap-1 justify-end">
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
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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

/** DEMO reference KPI tile: tinted icon box + value + muted hint. */
function KpiTile({
  icon: Icon,
  accent,
  label,
  value,
  hint,
  divider,
}: {
  icon: typeof Building2;
  accent: string;
  label: string;
  value: string;
  hint: string;
  divider?: string;
}) {
  return (
    <div className={cn("p-5 flex items-center gap-3", divider)}>
      <div className={cn("h-10 w-10 rounded-lg grid place-items-center", accent)}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div>
        <div className="text-[12.5px] text-muted-foreground">{label}</div>
        <div className="text-[22px] font-semibold text-foreground leading-tight tabular-nums">
          {value}
        </div>
        <div className="text-[11.5px] text-muted-foreground">{hint}</div>
      </div>
    </div>
  );
}

function TH({
  label,
  k,
  sortBy,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sortBy: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sortBy.key === k;
  return (
    <th
      className={cn(
        "th",
        right && "text-right"
      )}
    >
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
