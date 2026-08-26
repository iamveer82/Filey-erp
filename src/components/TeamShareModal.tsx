import { useEffect, useState } from "react";
import { Modal, Badge } from "./ui";
import { Check } from "lucide-react";
import { supabase, cloudConfigured } from "../lib/supabase";
import { org, type OrgMember } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { cn } from "../lib/format";

/* ── TeamShareModal — share a record with your workspace ────────────────────
 * Two levels, mirroring the RLS: the whole company (record.shared = true) or
 * specific members (record.shared_with = [user-id…]). The server RPC enforces
 * author-or-admin; this modal just shows the current state and writes intent.
 *
 * Generic by design: `record` is a table name, so quotes/customers adopt this
 * by adding the same shared_with column + RLS clause and passing their table. */

export interface TeamShareModalProps {
  open: boolean;
  onClose: () => void;
  /** Table the record lives in (e.g. "invoice_docs"). */
  record: string;
  /** The record's id. */
  recordId: number;
  /** Display label, e.g. "INV-0042". */
  label: string;
  /** Called after a successful save (refresh the list). */
  onShared?: () => void;
  /** RPC that performs the share — defaults to the invoice RPC. */
  shareFn?: (id: number, all: boolean, userIds: string[]) => Promise<void>;
  /** Read the record's current share state. Defaults to invoices. */
  stateFn?: (
    id: number
  ) => Promise<{ shared: boolean; shared_with: string[] | null; user_id: string }>;
}

export default function TeamShareModal({
  open,
  onClose,
  record,
  recordId,
  label,
  onShared,
  shareFn,
  stateFn,
}: TeamShareModalProps) {
  const { user } = useAuth();
  const { toast } = useUI();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [shared, setShared] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [author, setAuthor] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const doShare =
    shareFn ??
    (async (id: number, all: boolean, userIds: string[]) => {
      if (!supabase) throw new Error("Cloud isn't configured.");
      const { error } = await supabase.rpc("share_invoice", {
        p_id: id,
        p_all: all,
        p_user_ids: userIds,
      });
      if (error) throw error;
    });

  const loadState =
    stateFn ??
    (async (id: number) => {
      if (!supabase) throw new Error("Cloud isn't configured.");
      const { data, error } = await supabase
        .from(record)
        .select("shared, shared_with, user_id")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as { shared: boolean; shared_with: string[] | null; user_id: string };
    });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([loadState(recordId), org.members()])
      .then(([st, mems]) => {
        setShared(!!st.shared);
        setSharedWith(st.shared_with ?? []);
        setAuthor(st.user_id ?? "");
        setMembers(mems);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordId]);

  const authorName =
    members.find((m) => m.user_id === author)?.name ??
    (author === user?.id ? "You" : "the author");

  const toggleMember = (uid: string) =>
    setSharedWith((arr) =>
      arr.includes(uid) ? arr.filter((x) => x !== uid) : [...arr, uid]
    );

  const save = async () => {
    setSaving(true);
    try {
      await doShare(recordId, shared, sharedWith);
      toast.success(
        shared
          ? `${label} is visible to your whole company.`
          : `${label} shared with ${sharedWith.length} member${sharedWith.length === 1 ? "" : "s"}.`
      );
      onShared?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Share ${label}`}>
      {!cloudConfigured ? (
        <p className="text-sm text-warning">
          Team sharing needs Cloud mode — your data lives on this device.
        </p>
      ) : loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Whole-company toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={shared}
            onClick={() => setShared((v) => !v)}
            className={cn(
              "w-full rounded-xl border p-3.5 text-left transition-colors",
              shared ? "border-primary-500/60 bg-primary-50 dark:bg-white/5" : "border-border"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  Entire company
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Every member of your workspace can see this {record === "invoice_docs" ? "invoice" : "record"}.
                </p>
              </div>
              <span
                className={cn(
                  "relative w-11 h-6 rounded-full shrink-0 transition-colors",
                  shared ? "bg-primary-400" : "bg-border"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all",
                    shared ? "left-[22px]" : "left-0.5"
                  )}
                />
              </span>
            </div>
          </button>

          {/* Per-member list */}
          <div>
            <p className="label">Or share with specific members</p>
            {members.length <= 1 ? (
              <p className="text-[12.5px] text-muted-foreground">
                You're the only member — invite your team in Settings → Users &amp;
                Roles first.
              </p>
            ) : (
              <ul className="rounded-xl border border-border divide-y divide-border max-h-64 overflow-y-auto">
                {members
                  .filter((m) => m.user_id !== author)
                  .map((m) => {
                    const checked = sharedWith.includes(m.user_id);
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => toggleMember(m.user_id)}
                          disabled={shared}
                          className={cn(
                            "w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                            shared ? "opacity-40" : "hover:bg-hover"
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-4.5 w-4.5 place-items-center rounded border shrink-0",
                              checked
                                ? "bg-foreground border-foreground text-background"
                                : "border-border"
                            )}
                            style={{ width: 18, height: 18 }}
                          >
                            {checked && <Check size={12} strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13.5px] text-foreground">
                              {m.name}
                            </span>
                            <span className="block truncate text-[11.5px] text-muted-foreground">
                              {m.email}
                            </span>
                          </span>
                          <Badge tone={m.role === "owner" ? "warn" : "info"}>
                            {m.role}
                          </Badge>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
            {shared && (
              <p className="mt-2 text-[11.5px] text-muted-foreground">
                Whole-company sharing is on — the member list is disabled until
                you turn it off.
              </p>
            )}
          </div>

          {/* Current state */}
          <p className="text-[11.5px] text-muted-foreground">
            Created by {author === user?.id ? "you" : authorName}.{" "}
            {shared
              ? "Visible to the entire company."
              : sharedWith.length > 0
                ? `Visible to ${sharedWith.length} member${sharedWith.length === 1 ? "" : "s"}.`
                : "Only you can see this."}
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => void save()}
          disabled={loading || saving || !cloudConfigured}
        >
          {saving ? "Saving…" : "Save sharing"}
        </button>
      </div>
    </Modal>
  );
}
