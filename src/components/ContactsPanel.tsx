import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Mail,
  Phone,
  Plus,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { crm, type Person } from "../lib/api";
import { errMsg } from "../lib/format";
import { useUI } from "../lib/ui";

/* Contacts at a company — the people you actually deal with.
 *
 * crm_customers merged the business and the human onto one row, so a company
 * could only ever have one contact and there was nowhere to put a second name,
 * a job title, or a direct line. These are real crm_people rows linked by
 * company_id (supabase/2026-07-26-crm-objects.sql).
 *
 * Named "contacts" deliberately: the app's People section is employees. */

interface Draft {
  name: string;
  title: string;
  email: string;
  phone: string;
}

const EMPTY: Draft = { name: "", title: "", email: "", phone: "" };

export default function ContactsPanel({ companyId }: { companyId: number }) {
  const { toast, confirm } = useUI();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const all = await crm.people();
      setPeople(all.filter((p) => Number(p.company_id) === companyId));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
    // toast identity changes each render — depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  // Primary contact first, then alphabetical.
  const sorted = useMemo(
    () =>
      [...people].sort(
        (a, b) =>
          Number(b.is_primary ?? false) - Number(a.is_primary ?? false) ||
          (a.name ?? "").localeCompare(b.name ?? "")
      ),
    [people]
  );

  const save = async () => {
    const name = draft.name.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await crm.createPerson({
        company_id: companyId,
        name,
        title: draft.title.trim() || undefined,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        // First contact on a company is its primary one.
        is_primary: people.length === 0,
      });
      setDraft(EMPTY);
      setAdding(false);
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  /** Exactly one primary per company — promoting one demotes the rest. */
  const makePrimary = async (person: Person) => {
    try {
      await Promise.all(
        people
          .filter((p) => p.is_primary && p.id !== person.id)
          .map((p) => crm.updatePerson(p.id, { is_primary: false }))
      );
      await crm.updatePerson(person.id, { is_primary: true });
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (person: Person) => {
    const ok = await confirm({
      title: `Remove ${person.name}?`,
      message: "This only removes the contact, not the company.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await crm.deletePerson(person.id);
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="rounded-xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : `${people.length} contact${people.length === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink transition-transform active:scale-[0.97]"
        >
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Cancel" : "Add contact"}
        </button>
      </div>

      {adding && (
        <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2">
          {(
            [
              ["name", "Name", "e.g. Fatima Al Suwaidi"],
              ["title", "Job title", "e.g. Finance Manager"],
              ["email", "Email", "name@company.com"],
              ["phone", "Phone", "+971…"],
            ] as [keyof Draft, string, string][]
          ).map(([field, label, placeholder]) => (
            <label key={field} className="text-sm">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
              <input
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                }}
                placeholder={placeholder}
                className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              />
            </label>
          ))}
          <div className="sm:col-span-2">
            <button
              type="button"
              onClick={save}
              disabled={!draft.name.trim() || busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm text-bg transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Save contact
            </button>
          </div>
        </div>
      )}

      {!loading && sorted.length === 0 && !adding && (
        <p className="p-4 text-sm text-muted-foreground">
          No contacts yet. Add the people you deal with at this company.
        </p>
      )}

      <ul className="divide-y divide-line">
        {sorted.map((p) => (
          <li key={p.id} className="group flex items-center gap-3 px-3 py-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-bg">
              <UserRound className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm text-ink">
                {p.name}
                {p.is_primary && (
                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                    primary
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {p.title || "—"}
              </p>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              {p.email && (
                <a
                  href={`mailto:${p.email}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-ink"
                >
                  <Mail className="h-3.5 w-3.5" /> {p.email}
                </a>
              )}
              {p.phone && (
                <a
                  href={`tel:${p.phone}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-ink"
                >
                  <Phone className="h-3.5 w-3.5" /> {p.phone}
                </a>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              {!p.is_primary && (
                <button
                  type="button"
                  onClick={() => makePrimary(p)}
                  title="Make primary contact"
                  aria-label={`Make ${p.name} the primary contact`}
                >
                  <Star className="h-4 w-4 text-muted-foreground hover:text-amber-500" />
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(p)}
                aria-label={`Remove ${p.name}`}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
