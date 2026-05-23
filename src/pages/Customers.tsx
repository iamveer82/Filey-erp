import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Users, Plus, Trash2, Pencil, Mail, Search, BadgeCheck } from "lucide-react";
import { crm, type CrmCustomer } from "../lib/api";
import { useLiveSync } from "../lib/realtime";
import { useUI } from "../lib/ui";
import { num, cn } from "../lib/format";
import {
  PageHeader,
  MetricCard,
  DataTable,
  Modal,
  Field,
  ErrorBanner,
} from "../components/ui";

export default function Customers() {
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const [rows, setRows] = useState<CrmCustomer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<CrmCustomer | null>(null);
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

  const filtered = useMemo(
    () =>
      rows.filter((c) =>
        [c.name, c.company, c.email, c.trn].some((v) =>
          (v || "").toLowerCase().includes(q.toLowerCase())
        )
      ),
    [rows, q]
  );

  const withTrn = rows.filter((c) => c.trn).length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Customers"
        subtitle="Your customer directory — names, TRN and addresses pulled onto invoices & quotations"
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            <Plus size={16} /> New customer
          </button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-4">
        <MetricCard label="Customers" value={num(rows.length)} icon={<Users size={20} />} />
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
          iconClass="bg-secondary-400/20 text-secondary-600"
        />
      </div>

      <div className="relative mb-4 w-full max-w-xs">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-400"
        />
        <input
          className="input pl-10"
          placeholder="Search name, company, TRN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <DataTable<CrmCustomer>
        rows={filtered}
        loading={loading}
        empty="No customers yet — add your first"
        onRowClick={(c) => nav(`/customers/${c.id}`)}
        columns={[
          {
            key: "name",
            label: "Customer",
            render: (c) => (
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">
                  {c.company || c.name}
                </p>
                <p className="truncate text-[11px] text-brand-400">{c.name}</p>
              </div>
            ),
          },
          {
            key: "trn",
            label: "TRN",
            render: (c) =>
              c.trn ? (
                <span className="font-mono text-xs">{c.trn}</span>
              ) : (
                "—"
              ),
          },
          { key: "email", label: "Email", render: (c) => c.email ?? "—" },
          { key: "phone", label: "Phone", render: (c) => c.phone ?? "—" },
          {
            key: "act",
            label: "",
            render: (c) => (
              <div className="flex gap-1">
                <button
                  aria-label="Edit"
                  className="rounded-lg p-1.5 text-brand-600 hover:bg-brand-100 dark:hover:bg-white/10 cursor-pointer"
                  onClick={() => {
                    setEdit(c);
                    setOpen(true);
                  }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  aria-label="Delete"
                  className="rounded-lg p-1.5 text-danger hover:bg-danger/10 cursor-pointer"
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
                  <Trash2 size={14} />
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
  const blank = {
    name: "",
    company: "",
    trn: "",
    address: "",
    email: "",
    phone: "",
  };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setF(
      edit
        ? {
            name: edit.name ?? "",
            company: edit.company ?? "",
            trn: edit.trn ?? "",
            address: edit.address ?? "",
            email: edit.email ?? "",
            phone: edit.phone ?? "",
          }
        : blank
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit]);

  const nameErr = !f.name.trim();

  const save = async () => {
    setTouched(true);
    if (nameErr) return;
    setSaving(true);
    try {
      if (edit) await crm.updateCustomer(edit.id, f);
      else
        await crm.createCustomer(
          f as unknown as Omit<CrmCustomer, "id" | "created_at">
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
      </div>
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
