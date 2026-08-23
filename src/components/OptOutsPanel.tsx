import { useEffect, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";

import { crm, type EmailOptOut } from "../lib/api";
import { errMsg, fmtDate } from "../lib/format";
import { useUI } from "../lib/ui";
import { DataTable, Badge } from "./ui";

/* The suppression list. Nothing here is a nicety: an address on this list is
 * one that asked not to be contacted, and every campaign send checks it. */

export default function OptOutsPanel() {
  const { toast, confirm } = useUI();
  const [rows, setRows] = useState<EmailOptOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    crm
      .optOuts()
      .then(setRows)
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return toast.error("Enter a valid email address.");
    if (rows.some((r) => r.email.toLowerCase() === value))
      return toast.error("Already on the list.");
    setBusy(true);
    try {
      await crm.addOptOut(value, "manual");
      setEmail("");
      toast.success(`${value} will not be emailed again.`);
      load();
    } catch (e) {
      toast.error(errMsg(e) || "Could not add");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: EmailOptOut) => {
    const ok = await confirm({
      title: "Remove from opt-out list",
      message: `${r.email} will start receiving campaigns again. Only do this if they asked to be put back on, or you added them by mistake.`,
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await crm.removeOptOut(r.id);
    load();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <ShieldCheck size={16} className="text-brand-400" />
        <span className="text-sm text-foreground">
          Campaigns skip every address here. Someone who replies "unsubscribe" goes on
          this list - add them below.
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input w-full sm:max-w-xs"
          placeholder="someone@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn-primary" disabled={busy || !email.trim()} onClick={add}>
          Add opt-out
        </button>
      </div>

      <DataTable<EmailOptOut>
        rows={rows}
        loading={loading}
        pageSize={10}
        rowKey={(r) => r.id}
        empty="Nobody has opted out"
        columns={[
          {
            key: "email",
            label: "Email",
            sortValue: (r) => r.email,
            render: (r) => <span className="text-ink">{r.email}</span>,
          },
          {
            key: "reason",
            label: "Reason",
            sortValue: (r) => r.reason,
            render: (r) => (
              <Badge tone={r.reason === "bounced" ? "warn" : "info"}>{r.reason}</Badge>
            ),
          },
          {
            key: "when",
            label: "Added",
            sortValue: (r) => r.created_at ?? "",
            render: (r) => (r.created_at ? fmtDate(r.created_at) : "—"),
          },
          {
            key: "act",
            label: "Actions",
            render: (r) => (
              <button
                className="btn-ghost h-7 px-2 text-[12.5px] text-danger"
                onClick={() => remove(r)}
              >
                <Trash2 size={13} /> Remove
              </button>
            ),
          },
        ]}
      />
    </>
  );
}
