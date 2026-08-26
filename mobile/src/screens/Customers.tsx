import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import { crm, type CrmCustomer } from "@shared/api";
import { Screen, ListRow, SearchHeader, EmptyState, Loading, Sheet, Field } from "@mobile/components/ui";

export default function Customers() {
  const nav = useNavigate();
  const [rows, setRows] = useState<CrmCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [params] = useSearchParams();

  useEffect(() => {
    crm
      .customers()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => {
    if (params.get("new") === "1") setOpen(true);
  }, [params]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return rows;
    return rows.filter((c) =>
      `${c.name} ${c.company || ""} ${c.email || ""} ${c.phone || ""}`
        .toLowerCase()
        .includes(n)
    );
  }, [rows, q]);

  return (
    <Screen title="Customers" subtitle={`${rows.length} in directory`}>
      <div className="space-y-3">
        <SearchHeader value={q} onChange={setQ} placeholder="Search name, company, phone…" />
        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users size={22} />}
            title={rows.length === 0 ? "No customers yet" : "No matches"}
            hint={rows.length === 0 ? "Add your first customer to bill them." : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((c) => (
              <ListRow
                key={c.id}
                title={c.company || c.name}
                subtitle={c.email || c.phone || c.name}
                onClick={() => nav(`/customers/${c.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <AddCustomer
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(id) => {
          setRows((r) => r); // list refetches on next mount of detail
          setOpen(false);
          nav(`/customers/${String(id)}`);
        }}
      />
    </Screen>
  );
}

export function AddCustomer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the new customer's id — crm.createCustomer resolves to it. */
  onSaved: (id: number) => void;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [trn, setTrn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() && !company.trim())
      return setErr("A name or company is required.");
    setBusy(true);
    setErr(null);
    try {
      const id = await crm.createCustomer({
        name: name.trim() || company.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        trn: trn.trim() || undefined,
      } as never);
      onSaved(Number(id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="New customer">
      <div className="space-y-3">
        <Field label="Contact name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Company">
          <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="TRN">
          <input className="input" value={trn} onChange={(e) => setTrn(e.target.value)} />
        </Field>
        {err && <p className="text-[12.5px] font-medium text-danger">{err}</p>}
        <button className="btn-primary w-full" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save customer"}
        </button>
      </div>
    </Sheet>
  );
}
