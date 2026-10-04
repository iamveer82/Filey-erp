import { FileySpinner as Loader2 } from "../components/FileySpinner";
import { useEffect, useMemo, useRef, useState } from "react";
import { Hash, Plus, MessageCircle, Search, ArrowLeft } from "lucide-react";

import { channels, messages, org, type OrgChannel, type OrgMember } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isLocalMode } from "../lib/dataMode";
import { UserAvatar } from "../components/AvatarPicker";
import { useSearchParams } from "react-router-dom";
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
  const { user } = useAuth();
  const local = isLocalMode();
  const [people, setPeople] = useState<OrgMember[]>([]);
  const [search, setSearch] = useState("");
  const [directUnread, setDirectUnread] = useState<Record<string, number>>({});
  const [list, setList] = useState<OrgChannel[]>([]);
  const [params, setParams] = useSearchParams();
  const active = params.get("channel") || GENERAL;
  const recipient = params.get("person") || undefined;
  const mobileConversation = !!recipient || params.has("channel");
  const view = recipient
    ? "chats"
    : params.get("view") || (params.has("channel") || local ? "channels" : "chats");
  const setActive = (channel: string) => setParams({ channel });
  const focusMessage = Number(params.get("message")) || undefined;
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Keep unsent messages and attachments while browsing conversations; never upload drafts.
  const drafts = useRef<Record<string, { text: string; files: File[] }>>({});
  // Sends survive feed remounts when the user changes conversations.
  const [sends, setSends] = useState<Record<string, { pending: boolean; version: number }>>({});
  const draftKey = recipient ? `person:${recipient}` : `channel:${active}`;

  const load = async () => {
    try {
      const rows = await channels.list();
      setList(rows);
      setUnread(await messages.unread());
      if (!local) {
        const [team, direct] = await Promise.all([
          org.members(),
          messages.unreadDirect(),
        ]);
        setPeople(
          team.filter(
            (m) =>
              m.user_id !== user?.id &&
              (["owner", "admin"].includes(m.role) ||
                m.modules == null ||
                m.modules.includes("team"))
          )
        );
        setDirectUnread(direct);
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
    void load();
  }, ["org_channels", "org_messages", "org_members"]);

  const add = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await channels.create(name);
      const rows = await channels.list();
      setList(rows);
      const created = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/^-+|-+$/g, "");
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
      [
        ...new Map(
          [
            { id: 0, name: GENERAL, purpose: "Everything, by default", created_at: "" },
            ...list,
          ].map((c) => [c.name, c])
        ).values(),
      ].sort((a, b) =>
        // general first, then alphabetical — the default room shouldn't drift
        // down the list as channels are added.
        a.name === GENERAL ? -1 : b.name === GENERAL ? 1 : a.name.localeCompare(b.name)
      ),
    [list]
  );

  const activeChannel = sorted.find((c) => c.name === active);
  const person = people.find((p) => p.user_id === recipient);
  const refreshUnread = () => {
    void messages
      .unread()
      .then(setUnread)
      .catch(() => {});
    void messages
      .unreadDirect()
      .then(setDirectUnread)
      .catch(() => {});
  };

  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Team"
        subtitle="Private conversations and shared channels, together."
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Channel rail */}
        <aside className={mobileConversation ? "hidden lg:block" : undefined}>
          <div className="card p-3">
            <div
              className="mb-3 flex gap-1 rounded-full bg-muted p-1"
              role="group"
              aria-label="Conversation type"
            >
              <button
                className={cn(
                  "flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm",
                  view === "chats" ? "bg-background font-medium" : "text-muted-foreground"
                )}
                aria-pressed={view === "chats"}
                onClick={() => setParams({ view: "chats" })}
              >
                <MessageCircle size={15} /> Chats
              </button>
              <button
                className={cn(
                  "flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full text-sm",
                  view === "channels"
                    ? "bg-background font-medium"
                    : "text-muted-foreground"
                )}
                aria-pressed={view === "channels"}
                onClick={() => setActive(GENERAL)}
              >
                <Hash size={15} /> Channels
              </button>
            </div>
            {view === "chats" ? (
              <div>
                {local ? (
                  <p className="p-2 text-sm text-muted-foreground">
                    Open a cloud workspace to message your teammates.
                  </p>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
                      />
                      <input
                        className="input !pl-9"
                        aria-label="Find a teammate"
                        placeholder="Find a teammate"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    {loading && (
                      <p role="status" className="p-3 text-sm text-muted-foreground">
                        Loading teammates…
                      </p>
                    )}
                    <ul className="max-h-52 space-y-1 overflow-y-auto lg:max-h-[65dvh]">
                      {people
                        .filter((p) =>
                          `${p.name} ${p.email}`
                            .toLowerCase()
                            .includes(search.toLowerCase())
                        )
                        .map((p) => (
                          <li key={p.user_id}>
                            <button
                              onClick={() => setParams({ person: p.user_id })}
                              aria-current={recipient === p.user_id ? "page" : undefined}
                              className={cn(
                                "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                                recipient === p.user_id
                                  ? "bg-muted"
                                  : "hover:bg-muted"
                              )}
                            >
                              <UserAvatar src={p.avatar} name={p.name || p.email} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {p.name || p.email}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {p.role}
                                </span>
                              </span>
                              {!!directUnread[p.user_id] && (
                                <span
                                  className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background"
                                  aria-label={`${directUnread[p.user_id]} unread messages`}
                                >
                                  {directUnread[p.user_id]}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                    </ul>
                    {!loading && !people.length && (
                      <p className="p-3 text-sm text-muted-foreground">
                        Invite a teammate in Settings → Teams to start chatting.
                      </p>
                    )}
                    {!!people.length &&
                      !people.some((p) =>
                        `${p.name} ${p.email}`
                          .toLowerCase()
                          .includes(search.toLowerCase())
                      ) && (
                        <p className="p-3 text-sm text-muted-foreground">
                          No teammates match your search.
                        </p>
                      )}
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Channels</p>
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
                  <form
                    className="mb-3 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void add();
                    }}
                  >
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
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => setCreating(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={busy || !name.trim()}
                      >
                        {busy ? "Creating…" : "Create"}
                      </button>
                    </div>
                  </form>
                )}

                {loading ? (
                  <p className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-muted-foreground">
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
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <Hash size={12} className="shrink-0 opacity-70" />
                        <span className="truncate">{c.name}</span>
                        {!!unread[c.name] && (
                          <span
                            className="ml-auto rounded-full bg-foreground px-1.5 text-[11px] text-background"
                            aria-label={`${unread[c.name]} unread messages`}
                          >
                            {unread[c.name] > 99 ? "99+" : unread[c.name]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Feed for the selected channel. Keyed so switching channels remounts
            rather than showing the previous room's messages for a beat. */}
        <section className={cn("min-w-0", !mobileConversation && "hidden lg:block")}>
          {mobileConversation && (
            <button
              className="btn-ghost mb-3 lg:hidden"
              onClick={() => setParams({ view: recipient ? "chats" : "channels" })}
            >
              <ArrowLeft size={16} /> {recipient ? "All chats" : "All channels"}
            </button>
          )}
          {view === "channels" && activeChannel?.purpose && (
            <p className="mb-2 text-[12.5px] text-muted-foreground">{activeChannel.purpose}</p>
          )}
          {view === "channels" || (person && !local) ? (
            <CompanyMessages
              key={`${draftKey}:${sends[draftKey]?.version || 0}`}
              channel={recipient ? "general" : active}
              recipient={recipient}
              recipientName={person?.name || person?.email}
              draft={drafts.current[draftKey]}
              onDraftChange={(draft) => { drafts.current[draftKey] = draft; }}
              sending={sends[draftKey]?.pending || false}
              onSendStateChange={(state, reply) => {
                if (state === "sent" && !reply) drafts.current[draftKey] = { text: "", files: [] };
                setSends(previous => ({ ...previous, [draftKey]: {
                  pending: state === "sending",
                  // Refresh a remounted feed and its draft after the original send succeeds.
                  version: (previous[draftKey]?.version || 0) + (state === "sent" ? 1 : 0),
                } }));
              }}
              active={mobileConversation}
              focusMessage={focusMessage}
              onRead={refreshUnread}
            />
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
              <MessageCircle size={28} className="text-muted-foreground" />
              <h2 className="text-lg font-medium">Your team, one conversation away</h2>
              <p className="max-w-xs text-sm text-muted-foreground">
                Choose a teammate for a private chat, or open a channel to share an update
                with everyone.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
