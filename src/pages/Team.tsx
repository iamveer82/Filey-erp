import { useEffect, useMemo, useState } from "react";
import { Hash, Plus, Loader2, MessageSquare } from "lucide-react";

import { channels, type OrgChannel } from "../lib/api";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { errMsg, cn } from "../lib/format";
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
      // #general is created on first visit rather than seeded by the
      // migration: the migration runs without a signed-in user, so the row
      // would have no owner.
      if (!rows.some((c) => c.name === GENERAL)) {
        await channels.create(GENERAL, "Everything, by default").catch(() => {});
        setList(await channels.list());
      } else {
        setList(rows);
      }
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
    if (!name.trim()) return;
    setBusy(true);
    try {
      await channels.create(name);
      const rows = await channels.list();
      setList(rows);
      const created = name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-");
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
      [...list].sort((a, b) =>
        // general first, then alphabetical — the default room shouldn't drift
        // down the list as channels are added.
        a.name === GENERAL ? -1 : b.name === GENERAL ? 1 : a.name.localeCompare(b.name)
      ),
    [list]
  );

  const activeChannel = sorted.find((c) => c.name === active);

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-4 sm:px-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <MessageSquare size={19} className="text-brand-400" />
          Team
        </h1>
        <p className="mt-1 text-[12.5px] text-brand-500">
          Talk to your workspace. Mention a teammate with @ and reply to keep a
          thread together.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* Channel rail */}
        <aside>
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand-400">
                Channels
              </p>
              <button
                className="btn-ghost h-6 px-1.5 text-[11px]"
                onClick={() => setCreating((v) => !v)}
                title="New channel"
              >
                <Plus size={12} />
              </button>
            </div>

            {creating && (
              <div className="mb-2 flex gap-1.5">
                <input
                  autoFocus
                  className="input h-8 min-w-0 flex-1 text-[12.5px]"
                  placeholder="sales"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") add();
                    if (e.key === "Escape") setCreating(false);
                  }}
                />
                <button className="btn-primary h-8 px-2 text-[12px]" disabled={busy} onClick={add}>
                  {busy ? <Loader2 size={12} className="animate-spin" /> : "Add"}
                </button>
              </div>
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
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors",
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
