import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Plus, Trash2, Users, X } from "lucide-react";
import { crm, type Opportunity, type Person } from "../lib/api";
import {
  DEAL_ROLES,
  listDealContacts,
  removeDealContact,
  setDealContact,
  type DealContact,
} from "../lib/dealContacts";
import { aed, cn, fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";
import { Modal } from "./ui";
import { SelectMenu } from "./ui-menu";
import CrmRecordPanel from "./CrmRecordPanel";
import StageChip from "./crm/StageChip";
import DealTimeline from "./crm/DealTimeline";

/* Right-side record panel for a deal (trycompai record-sheet DNA): header with
 * stage chip, meta grid, one-tap stage move, contact roles, and a typed-icon
 * activity timeline. */

const STAGES = [
  { id: "qualification", label: "Qualification" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

/** Preset close reasons — the win/loss report groups by exact string, so a
 *  picker both saves typing and keeps the report readable. */
const CLOSE_REASONS: Record<"won" | "lost", string[]> = {
  won: ["Repeat customer", "Referral", "Best price", "Relationship"],
  lost: [
    "Price too high",
    "Chose competitor",
    "Budget frozen",
    "Timing postponed",
    "Went silent",
  ],
};

export default function DealDrawer({
  opp,
  onClose,
  onChange,
}: {
  opp: Opportunity | null;
  onClose: () => void;
  /** Called after a change that affects the board (stage move, delete). */
  onChange: () => void;
}) {
  const { toast, confirm } = useUI();
  // Set when a stage move needs a reason first (won/lost).
  const [closingTo, setClosingTo] = useState<"won" | "lost" | null>(null);

  useEffect(() => {
    if (!opp) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [opp, onClose]);

  if (!opp) return null;

  const moveStage = async (stage: string) => {
    if (stage === opp.stage) return;
    // Closing asks why first — an uncaptured loss is a lesson thrown away.
    if (stage === "won" || stage === "lost") {
      setClosingTo(stage);
      return;
    }
    try {
      await crm.setOppStage(opp.id, stage);
      onChange();
      toast.success(`Moved to ${STAGES.find((s) => s.id === stage)?.label ?? stage}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmClose = async (reason: string) => {
    const stage = closingTo;
    if (!stage) return;
    setClosingTo(null);
    try {
      await crm.setOppStage(opp.id, stage, { reason });
      onChange();
      toast.success(
        `${stage === "won" ? "Won" : "Lost"}${reason ? ` — ${reason}` : ""}.`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async () => {
    const ok = await confirm({
      title: "Delete deal?",
      message: `“${opp.title}” will be permanently removed.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await crm.deleteOpportunity(opp.id);
      onChange();
      onClose();
      toast.success("Deal deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return createPortal(
    <div
      className="materialize-scrim fixed inset-0 z-50 flex justify-end bg-foreground/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Deal: ${opp.title}`}
        style={{ "--materialize-origin": "right center" } as React.CSSProperties}
        className="materialize-surface flex h-full w-full max-w-md flex-col border-l border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: name + live stage chip */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] font-semibold tracking-tight text-foreground">
                {opp.title}
              </p>
              <StageChip stage={opp.stage} />
            </div>
            <p className="mt-1 flex items-center gap-1 text-[12px] text-muted-foreground">
              <Building2 size={12} strokeWidth={1.75} />{" "}
              {opp.customer_name || "No company"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border px-5 py-4">
          <MetaField label="Value">
            <span className="tabular-nums">{aed(opp.value)}</span>
          </MetaField>
          <MetaField label="Probability">
            <span className="tabular-nums">{opp.probability}%</span>
          </MetaField>
          <MetaField label="Expected close">
            <span className="tabular-nums">
              {opp.expected_close ? fmtDate(opp.expected_close) : "—"}
            </span>
          </MetaField>
          <MetaField label="Owner">{opp.owner || "—"}</MetaField>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {/* One-tap stage mover */}
          <section className="px-5 py-4">
            <SectionLabel>Stage</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => moveStage(s.id)}
                  aria-pressed={s.id === opp.stage}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                    s.id === opp.stage
                      ? "border-primary-400 bg-primary-500/10 text-primary-600 dark:text-primary-400"
                      : "border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </section>

          {/* Who at the customer plays which part on THIS deal. */}
          <section className="px-5 py-4">
            <DealContacts oppId={opp.id} customerId={opp.customer_id ?? null} />
          </section>

          {/* Timeline */}
          <section className="flex min-h-[240px] flex-col px-5 py-4">
            <SectionLabel>Activity</SectionLabel>
            <DealTimeline relatedTo={opp.title} />
          </section>

          {/* Notes and tasks against the deal itself. Without this a deal had
              nowhere to hang a next step, so the pipeline health check had
              nothing to read and every deal looked neglected. */}
          <section className="px-5 py-4">
            <CrmRecordPanel targetType="deal" targetId={opp.id} />
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-3">
          <button type="button" onClick={del} className="btn-ghost w-full text-danger">
            <Trash2 size={14} /> Delete deal
          </button>
        </div>
      </div>
      <CloseReasonModal
        outcome={closingTo}
        onConfirm={confirmClose}
        onClose={() => setClosingTo(null)}
      />
    </div>,
    document.body
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-[13px] font-medium text-foreground">{children}</p>
    </div>
  );
}

/** Attach/re-role/detach contacts for this deal. Roles live device-local (see
 *  lib/dealContacts.ts) — the drawer is where a salesperson decides whether
 *  they're actually talking to the decision maker or just a friendly gatekeeper. */
function DealContacts({
  oppId,
  customerId,
}: {
  oppId: number;
  customerId: number | null;
}) {
  const { toast } = useUI();
  const [rows, setRows] = useState<DealContact[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<string>(DEAL_ROLES[0]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([listDealContacts(oppId), crm.people()])
      .then(([r, p]) => {
        if (!alive) return;
        setRows(r);
        // The deal's own company first; fall back to everyone so a deal with
        // no linked customer can still be staffed.
        const mine = customerId ? p.filter((x) => x.company_id === customerId) : [];
        setPeople(mine.length ? mine : p);
      })
      .catch(() => alive && setPeople([]));
    return () => {
      alive = false;
    };
  }, [oppId, customerId]);

  const reload = () =>
    listDealContacts(oppId)
      .then(setRows)
      .catch(() => {});

  const add = async () => {
    if (!personId || busy) return;
    setBusy(true);
    try {
      await setDealContact(oppId, Number(personId), role);
      setPersonId("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person: number) => {
    try {
      await removeDealContact(oppId, person);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const nameOf = (id: number) =>
    people.find((p) => p.id === id)?.name ?? "(removed contact)";

  const taken = new Set(rows.map((r) => r.person_id));

  return (
    <div>
      <SectionLabel>
        <span className="inline-flex items-center gap-1.5">
          <Users size={11} strokeWidth={1.75} /> Deal contacts
        </span>
      </SectionLabel>
      {rows.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          Nobody tagged yet — mark who decides, who pays and who can kill it.
        </p>
      )}
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-foreground">
              {nameOf(r.person_id)}
            </span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {r.role}
            </span>
            <button
              type="button"
              onClick={() => remove(r.person_id)}
              aria-label={`Remove ${nameOf(r.person_id)} from deal`}
              className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X size={13} className="text-muted-foreground transition-colors hover:text-danger" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <SelectMenu
          size="sm"
          className="flex-1 min-w-0"
          ariaLabel="Contact to attach"
          value={personId}
          onChange={(v) => setPersonId(v)}
          options={[
            { value: "", label: "Add contact…" },
            ...people
              .filter((p) => !taken.has(p.id))
              .map((p) => ({ value: String(p.id), label: p.name })),
          ]}
        />
        <SelectMenu
          size="sm"
          className="w-36"
          ariaLabel="Role"
          value={role}
          onChange={(v) => setRole(v)}
          options={DEAL_ROLES.map((r) => ({ value: r, label: r }))}
        />
        <button
          type="button"
          className="btn-primary h-8 shrink-0"
          disabled={!personId || busy}
          aria-label="Attach contact to deal"
          onClick={add}
        >
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

/** Won/lost asks why before it closes — presets keep the win/loss report
 *  groupable; the free-text field catches everything else. */
function CloseReasonModal({
  outcome,
  onConfirm,
  onClose,
}: {
  outcome: "won" | "lost" | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [outcome]);
  if (!outcome) return null;
  const won = outcome === "won";
  return (
    <Modal open onClose={onClose} title={won ? "Why did we win?" : "Why was it lost?"}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {CLOSE_REASONS[outcome].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r === reason ? "" : r)}
              aria-pressed={r === reason}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                r === reason
                  ? "border-primary-400 bg-primary-500/10 text-primary-600 dark:text-primary-400"
                  : "border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground"
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="Or write your own reason…"
          aria-label="Close reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Recorded on the deal and grouped in the forecast's win/loss report.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => onConfirm(reason.trim())}>
          Mark {won ? "won" : "lost"}
        </button>
      </div>
    </Modal>
  );
}
