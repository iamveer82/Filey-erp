import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Plus, X, Loader2, Search } from "lucide-react";
import { Link } from "react-router-dom";

import { links } from "../lib/api";
import {
  ENTITY_LABEL,
  ENTITY_TYPES,
  entityHref,
  type EntityType,
  type LinkedRecord,
} from "../lib/links";
import { fmtDate, errMsg, cn } from "../lib/format";
import { useUI } from "../lib/ui";
import { SelectMenu } from "./ui-menu";

/* Shows everything connected to one record, in both directions, and lets you
 * connect more. Drop it on any detail page:
 *
 *   <LinkedRecords type="invoice" id={doc.id} title={doc.number} />
 *
 * The point is the question "why does this record exist" — a purchase order
 * linked to the invoice it produced, a follow-up linked to the quote that
 * prompted it. Links resolve through ids, so renaming the other side keeps
 * the connection (unlike crm_activities.related_to, which matches on name).
 */

export default function LinkedRecords({
  type,
  id,
  title,
  className,
}: {
  type: EntityType;
  id: number;
  /** This record's own name, used in the confirm copy when unlinking. */
  title?: string;
  className?: string;
}) {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<LinkedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // picker state
  const [pickType, setPickType] = useState<EntityType>(
    type === "invoice" ? "customer" : "invoice"
  );
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<{ id: number; label: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  const reload = () =>
    links
      .for(type, id)
      .then(setRows)
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  // Debounced so typing a customer name doesn't fire a query per keystroke.
  // The seq guard drops out-of-order responses, which is what makes a fast
  // typist see results for what they actually typed.
  useEffect(() => {
    if (!adding) return;
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await links.search(pickType, term);
        if (seq.current === mine) setHits(r);
      } catch {
        if (seq.current === mine) setHits([]);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [term, pickType, adding]);

  const attach = async (targetId: number, label: string) => {
    // Linking a record to itself is always a mistake, and the graph reads
    // both directions so it would render as its own parent.
    if (pickType === type && targetId === id) {
      toast.error("A record can't be linked to itself.");
      return;
    }
    try {
      await links.add({ type, id }, { type: pickType, id: targetId });
      toast.success(`Linked to ${label}`);
      setTerm("");
      setAdding(false);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const detach = async (l: LinkedRecord) => {
    const ok = await confirm({
      title: "Remove link",
      message: `Unlink ${l.label}${title ? ` from ${title}` : ""}? Both records stay — only the connection goes.`,
      confirmLabel: "Unlink",
    });
    if (!ok) return;
    try {
      await links.remove(l.linkId);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const grouped = useMemo(() => {
    const m = new Map<EntityType, LinkedRecord[]>();
    for (const r of rows) m.set(r.type, [...(m.get(r.type) ?? []), r]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className={cn("card p-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Link2 size={15} className="text-brand-400" />
          Linked records
          {rows.length > 0 && (
            <span className="text-xs font-normal text-brand-400">{rows.length}</span>
          )}
        </h3>
        <button
          className="btn-ghost h-7 px-2 text-[12.5px]"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? <X size={13} /> : <Plus size={13} />} {adding ? "Cancel" : "Link"}
        </button>
      </div>

      {adding && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <SelectMenu
              value={pickType}
              onChange={(v) => {
                setPickType(v as EntityType);
                setHits([]);
              }}
              options={ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_LABEL[t] }))}
            />
            <div className="relative min-w-[180px] flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-400"
              />
              <input
                autoFocus
                className="input h-9 w-full pl-7"
                placeholder={`Search ${ENTITY_LABEL[pickType].toLowerCase()}…`}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-2 max-h-48 overflow-auto">
            {searching ? (
              <p className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-brand-400">
                <Loader2 size={13} className="animate-spin" /> Searching…
              </p>
            ) : hits.length ? (
              hits.map((h) => (
                <button
                  key={h.id}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-muted"
                  onClick={() => attach(h.id, h.label)}
                >
                  <span className="truncate">{h.label}</span>
                  <Plus size={12} className="shrink-0 text-brand-400" />
                </button>
              ))
            ) : (
              <p className="px-1 py-2 text-[12.5px] text-brand-400">
                {term ? "Nothing matches." : `No ${ENTITY_LABEL[pickType].toLowerCase()}s yet.`}
              </p>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-brand-400">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </p>
      ) : !rows.length ? (
        <p className="mt-3 text-[12.5px] text-brand-400">
          Nothing linked yet. Connect the quote it came from, the customer it's
          for, or the follow-up it created.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {grouped.map(([t, list]) => (
            <div key={t}>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-brand-400">
                {ENTITY_LABEL[t]}
              </p>
              <div className="space-y-1">
                {list.map((l) => (
                  <div
                    key={l.linkId}
                    className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <Link
                      to={entityHref(l.type, l.id)}
                      className="min-w-0 flex-1 truncate text-[12.5px] text-ink hover:underline"
                      title={l.label}
                    >
                      {l.label}
                    </Link>
                    <span className="shrink-0 text-[10px] text-brand-400">
                      {fmtDate(l.created_at)}
                    </span>
                    <button
                      className="shrink-0 text-brand-400 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      title="Unlink"
                      onClick={() => detach(l)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
