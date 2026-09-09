import { useEffect, useMemo, useState } from "react";
import { Hash, Plus, Loader2 } from "lucide-react";

import { channels, type OrgChannel } from "../lib/api";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { errMsg, cn } from "../lib/format";
import { PageHeader } from "../components/ui";
import CompanyMessages from "../components/CompanyMessages";

/* Team chat.
 *
 * The message feed, mentions, replies and realtime already existed in
 * CompanyMessages — it was simply never mounted anywhere, so none of it was
 * reachable. This gives it a home and splits it by channel, because one global
 * feed collapses every topic into the same column.
 *
 * Channels are rows rather than values inferred from messages, so an empty
 * channel still exists and can be posted into.
 */

const GENERAL = "general";

export default function Team() {
  const { toast } = useUI();
  const [list, setList] = useState<OrgChannel[]>([]);
  const [active, setActive] = useState(GENERAL);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const rows = await channels.list();
      setList(rows);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A teammate creating a channel should appear here without a refresh.
  useLiveSync(() => {
    channels.list().then(setList).catch(() => {});
  });

  const add = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await channels.create(name);
      const rows = await channels.list();
      setList(rows);
      const created = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
      setActive(created);
      setName("");
      setCreating(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const sorted = useMemo(
    () =>
      // Messages address channels by name. Show legacy duplicates once without
      // deleting records, and offer the default room without a write on mount.
      [...new Map([{ id: 0, name: GENERAL, purpose: "Everything, by default", created_at: "" }, ...list].map((c) => [c.name, c])).values()].sort((a, b) =>
        // general first, then alphabetical — the default room shouldn't drift
        // down the list as channels are added.
        a.name === GENERAL ? -1 : b.name === GENERAL ? 1 : a.name.localeCompare(b.name)
      ),
    [list]
  );

  const activeChannel = sorted.find((c) => c.name === active);

  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Team"
        subtitle="Talk to your workspace. Mention a teammate with @ and reply to keep a thread together."
      />

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* Channel rail */}
        <aside>
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">
                Channels
              </p>
              <button
                className="btn-ghost w-10 p-0"
                disabled={busy}
                aria-label={creating ? "Cancel new channel" : "New channel"}
                aria-expanded={creating}
                onClick={() => setCreating((v) => !v)}
                title="New channel"
              >
                <Plus size={16} />
              </button>
            </div>

            {creating && (
              <form className="mb-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
                <input
                  autoFocus
                  className="input"
                  aria-label="Channel name"
                  disabled={busy}
                  placeholder="sales"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && !busy) setCreating(false);
                  }}
                />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => setCreating(false)}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
                    {busy ? "Creating…" : "Create"}
                  </button>
                </div>
              </form>
            )}

            {loading ? (
              <p className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-brand-400">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </p>
            ) : (
              <div className="space-y-0.5">
                {sorted.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActive(c.name)}
                    aria-current={c.name === active ? "page" : undefined}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2 rounded-full px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      c.name === active
                        ? "bg-primary-100 font-medium text-ink"
                        : "text-brand-500 hover:bg-muted hover:text-ink"
                    )}
                  >
                    <Hash size={12} className="shrink-0 opacity-70" />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Feed for the selected channel. Keyed so switching channels remounts
            rather than showing the previous room's messages for a beat. */}
        <section>
          {activeChannel?.purpose && (
            <p className="mb-2 text-[12.5px] text-brand-400">{activeChannel.purpose}</p>
          )}
          <CompanyMessages key={active} channel={active} />
        </section>
      </div>
    </div>
  );
}
