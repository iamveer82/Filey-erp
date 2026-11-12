import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Bookmark, ChevronLeft, Copy, Heart, Link2, MessageCircle, Phone as PhoneIcon, Plus, RefreshCw, Rocket, Send, Trash2, UserPlus, Video, X, Zap } from "lucide-react";
import { useUI } from "../lib/ui";
import { cn, errMsg, fmtDate } from "../lib/format";
import { Badge, EmptyState, ErrorBanner, Switch } from "./ui";
import {
  EVENT_LABELS, draftFrom, draftProblems, fillTags, instagram, newDraft, openInstagramConnect, parseKeywords, toInput, triggerSummary,
  type IgAutomation, type IgConnection, type IgDraft, type IgEvent, type IgMedia, type IgTarget,
} from "../lib/instagram";

/** A simple camera-outline glyph for Instagram (lucide dropped brand icons). */
function IgGlyph({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
  </svg>;
}

/** Instagram comment-to-DM automation in Marketing: connect a professional account, pick a post and keywords,
 *  write the DM, see it on a phone before going live. Runs on Filey's server, so it keeps working with Filey closed. */
export default function InstagramDmPanel() {
  const { toast, confirm } = useUI();
  const [connections, setConnections] = useState<IgConnection[] | null>(null);
  const [automations, setAutomations] = useState<IgAutomation[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ draft: IgDraft; id?: string; connectionId: string } | null>(null);
  const [view, setView] = useState<"automations" | "activity">("automations");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [cs, as] = await Promise.all([instagram.connections(), instagram.automations()]);
      setConnections(cs);
      setAutomations(as);
    } catch (e) {
      setConnections((c) => c ?? []);
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  // After the Meta sign-in in the browser, coming back to Filey shows the new account.
  useEffect(() => {
    if (connections?.length) return;
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [connections, load]);

  const connect = async () => {
    setBusy("connect");
    try { await openInstagramConnect(await instagram.connectUrl()); toast.success("Finish connecting in your browser, then come back here."); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(""); }
  };
  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await work(); if (done) toast.success(done); await load(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(""); }
  };

  if (editing) {
    return <AutomationEditor
      initial={editing.draft} id={editing.id} connectionId={editing.connectionId} connections={connections ?? []}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;
  }
  if (connections === null) return <p className="py-16 text-center text-sm text-muted-foreground">Loading Instagram…</p>;

  if (!connections.length) {
    return <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      <div className="grid gap-6 rounded-2xl border border-border bg-card p-6 md:grid-cols-[1fr_260px] md:items-center">
        <div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)] text-white"><IgGlyph size={22} /></span>
          <h2 className="mt-4 text-xl font-semibold text-foreground">Reply to Instagram comments with a DM, automatically</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">Someone comments “LINK” on your reel and gets your link in their inbox a second later, even while Filey is closed. Uses Instagram's official API: no password, no scraping.</p>
          <ul className="mt-4 space-y-1.5 text-sm text-foreground">
            <li className="flex gap-2"><Zap size={16} className="mt-0.5 shrink-0 text-warning" /> Keyword to DM on any post, reel, story reply or live</li>
            <li className="flex gap-2"><MessageCircle size={16} className="mt-0.5 shrink-0 text-info" /> Optional public reply under the comment</li>
            <li className="flex gap-2"><UserPlus size={16} className="mt-0.5 shrink-0 text-success" /> Ask them to follow you before sending the link</li>
          </ul>
          <button type="button" className="btn-primary mt-5" disabled={busy === "connect"} onClick={() => { void connect(); }}>
            <IgGlyph size={16} /> {busy === "connect" ? "Opening…" : "Connect Instagram"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">Needs an Instagram Business or Creator account. Already connected in the browser? <button type="button" className="underline" onClick={() => { void load(); }}>Check again</button>.</p>
        </div>
        <div className="hidden md:block"><MiniPhone /></div>
      </div>
    </div>;
  }

  const start = () => setEditing({ draft: newDraft(), connectionId: connections[0].id });

  return <div className="space-y-4">
    {error && <ErrorBanner message={error} />}
    <div className="flex flex-wrap items-center gap-2">
      {connections.map((c) => <span key={c.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-2 text-sm">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)] text-white"><IgGlyph size={13} /></span>
        @{c.ig_username || c.ig_user_id}
        {c.needs_reconnect
          ? <button type="button" className="text-xs font-medium text-danger underline" disabled={!!busy}
              onClick={() => { void run(`refresh-${c.id}`, () => instagram.refreshToken(c.id), "Instagram connection renewed."); }}>Renew connection</button>
          : <Badge tone="success">Connected</Badge>}
        <button type="button" aria-label={`Disconnect @${c.ig_username}`} className="text-muted-foreground hover:text-danger" disabled={!!busy}
          onClick={async () => {
            if (await confirm({ title: "Disconnect Instagram", message: `Disconnect @${c.ig_username}? Its automations, links and activity log are deleted.`, confirmLabel: "Disconnect", danger: true }))
              void run(`dc-${c.id}`, () => instagram.disconnect(c.id), "Disconnected.");
          }}><X size={14} /></button>
      </span>)}
      <button type="button" className="btn-ghost h-8 text-xs" disabled={busy === "connect"} onClick={() => { void connect(); }}><Plus size={13} /> Add account</button>
      <div className="ml-auto flex gap-1.5">
        {(["automations", "activity"] as const).map((v) => <button key={v} type="button"
          className={cn("rounded-full px-3 py-1 text-sm", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-hover")}
          onClick={() => setView(v)}>{v === "automations" ? "Automations" : "Activity"}</button>)}
        <button type="button" className="btn-primary" onClick={start}><Plus size={15} /> New automation</button>
      </div>
    </div>

    {view === "activity" ? <ActivityLog /> : !automations.length
      ? <div className="rounded-2xl border border-border bg-card">
          <EmptyState icon={MessageCircle} title="No automations yet" description="Pick a post, choose a keyword like LINK, and write the DM people get when they comment it."
            action={<button type="button" className="btn-primary" onClick={start}><Plus size={15} /> New automation</button>} />
        </div>
      : <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {automations.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing({ draft: draftFrom(a), id: a.id, connectionId: a.connection_id })}>
              <p className="truncate font-medium text-ink">{a.name}</p>
              <p className="truncate text-xs text-muted-foreground">{triggerSummary(a)}</p>
            </button>
            <div className="flex gap-4 text-xs tabular-nums text-muted-foreground">
              <span title="DMs sent in the last 90 days"><b className="text-foreground">{a.stats.sent}</b> sent</span>
              <span title="Link button taps"><b className="text-foreground">{a.stats.linkClicks}</b> clicks</span>
            </div>
            <Switch checked={a.is_active} label={a.is_active ? `Turn off ${a.name}` : `Turn on ${a.name}`} busy={busy === `t-${a.id}`} disabled={!!busy}
              onChange={(next) => { void run(`t-${a.id}`, () => instagram.toggle(a.id, next), next ? "Automation is live." : "Automation paused."); }} />
            <button type="button" aria-label={`Duplicate ${a.name}`} className="btn-ghost h-8 w-8 !px-0" disabled={!!busy}
              onClick={() => { void run(`d-${a.id}`, () => instagram.duplicate(a.id), "Copied. The copy starts paused."); }}><Copy size={14} /></button>
            <button type="button" aria-label={`Delete ${a.name}`} className="btn-ghost h-8 w-8 !px-0 text-danger" disabled={!!busy}
              onClick={async () => {
                if (await confirm({ title: "Delete automation", message: `Delete “${a.name}”? This cannot be undone.`, confirmLabel: "Delete", danger: true }))
                  void run(`x-${a.id}`, () => instagram.remove(a.id), "Deleted.");
              }}><Trash2 size={14} /></button>
          </li>)}
        </ul>}
  </div>;
}

function ActivityLog() {
  const [events, setEvents] = useState<IgEvent[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { setError(""); instagram.events().then(setEvents).catch((e) => { setEvents([]); setError(errMsg(e)); }); }, []);
  useEffect(load, [load]);
  if (!events) return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  return <div className="rounded-2xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
      <p className="text-sm font-medium text-foreground">Last 50 events</p>
      <button type="button" className="btn-ghost h-8 text-xs" onClick={load}><RefreshCw size={13} /> Refresh</button>
    </div>
    {error && <div className="p-4"><ErrorBanner message={error} /></div>}
    {!events.length && !error ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing yet. Comment a keyword from another account to test.</p>
      : <ul className="divide-y divide-border text-sm">{events.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
          <Badge tone={e.kind === "error" || e.kind === "public_reply_failed" ? "danger" : e.kind === "dm_skipped" || e.kind === "follow_gate_declined" ? "warn" : "success"}>{EVENT_LABELS[e.kind] ?? e.kind}</Badge>
          <span className="text-foreground">{e.actor_username ? `@${e.actor_username}` : "Someone"}</span>
          <span className="truncate text-muted-foreground">{e.automation_name ?? ""}{typeof e.detail?.reason === "string" ? ` · ${e.detail.reason}` : ""}</span>
          <span className="ml-auto text-xs text-muted-foreground">{fmtDate(e.created_at.slice(0, 10))} {e.created_at.slice(11, 16)}</span>
        </li>)}</ul>}
  </div>;
}

/* ── Builder ─────────────────────────────────────────────────────────────── */

type PreviewTab = "post" | "comments" | "dm";
const SAMPLE = { username: "sara.designs", first_name: "Sara" };

function Box({ title, children, onFocus }: { title: string; children: ReactNode; onFocus?: () => void }) {
  return <section className="space-y-2" onFocusCapture={onFocus} onClick={onFocus}>
    <h3 className="text-lg font-semibold text-foreground">{title}</h3>
    {children}
  </section>;
}
function Choice({ checked, label, onSelect, children, hint }: { checked: boolean; label: string; onSelect: () => void; children?: ReactNode; hint?: string }) {
  return <div className={cn("rounded-xl bg-muted/60 p-3 transition-colors", checked && "ring-1 ring-foreground/15")}>
    <label className="flex cursor-pointer items-center gap-3 text-sm text-foreground">
      <input type="radio" className="h-4 w-4 accent-[hsl(var(--info))]" checked={checked} onChange={onSelect} />
      <span className="min-w-0 flex-1">{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
    {checked && children && <div className="mt-3">{children}</div>}
  </div>;
}
function ToggleRow({ label, hint, checked, onChange, children }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return <div className="rounded-xl bg-muted/60 p-3">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 text-sm text-foreground">{label}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
    {checked && children && <div className="mt-3">{children}</div>}
  </div>;
}

function AutomationEditor({ initial, id, connectionId: initialConnection, connections, onClose, onSaved }: {
  initial: IgDraft; id?: string; connectionId: string; connections: IgConnection[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useUI();
  const [d, setD] = useState<IgDraft>(initial);
  const [connectionId, setConnectionId] = useState(initialConnection);
  const [media, setMedia] = useState<IgMedia[] | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [keywordText, setKeywordText] = useState("");
  const [tab, setTab] = useState<PreviewTab>("post");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof IgDraft>(k: K, v: IgDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const account = connections.find((c) => c.id === connectionId);
  const handle = account?.ig_username || "yourshop";

  useEffect(() => {
    setMedia(null); setMediaError("");
    instagram.media(connectionId, 24).then(setMedia).catch((e) => { setMedia([]); setMediaError(errMsg(e)); });
  }, [connectionId]);
  const post = media?.find((m) => m.id === d.platform_post_id) ?? (d.target === "post" ? undefined : media?.[0]);
  const problems = draftProblems(d);
  const story = d.target === "story_reply" || d.target === "story_mention";
  const replyable = d.target === "post" || d.target === "any" || d.target === "live_comment";

  const addKeywords = (text: string) => { const next = parseKeywords(text, d.keywords); set("keywords", next); setKeywordText(""); };
  const save = async (goLive: boolean) => {
    setTouched(true);
    if (problems.length) { toast.error(problems[0]); return; }
    setSaving(true);
    try {
      await instagram.save(connectionId, toInput(d, goLive), id);
      toast.success(goLive ? "Live. Comment the keyword from another account to test it." : "Saved as a draft.");
      onSaved();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSaving(false); }
  };
  const pickTarget = (t: IgTarget) => { set("target", t); setTab(t === "story_reply" || t === "story_mention" ? "dm" : "post"); };
  const insertTag = (tag: string) => set("dm_message", `${d.dm_message}${d.dm_message.endsWith(" ") || !d.dm_message ? "" : " "}{{${tag}}}`);

  return <div className="pb-10">
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button type="button" className="btn-ghost h-9 w-9 !px-0" aria-label="Back to automations" onClick={onClose}><ArrowLeft size={16} /></button>
      <input aria-label="Automation name" className={cn("input h-10 min-w-48 flex-1 text-base font-medium sm:max-w-sm", touched && !d.name.trim() && "border-danger")}
        placeholder="Name, e.g. Reel giveaway link" value={d.name} onChange={(e) => set("name", e.target.value)} />
      {connections.length > 1 && <select aria-label="Instagram account" className="input h-10 w-auto" value={connectionId} onChange={(e) => { setConnectionId(e.target.value); set("platform_post_id", null); }}>
        {connections.map((c) => <option key={c.id} value={c.id}>@{c.ig_username}</option>)}
      </select>}
      <div className="ml-auto flex gap-2">
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => { void save(false); }}>Save draft</button>
        <button type="button" className="btn-primary" disabled={saving} onClick={() => { void save(true); }}><Rocket size={15} /> {saving ? "Saving…" : "Go Live"}</button>
      </div>
    </div>
    {touched && problems.length > 0 && <div className="mb-4"><ErrorBanner message={problems.join(" ")} /></div>}

    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
      <div className="min-w-0 space-y-7">
        <Box title="When someone…" onFocus={() => setTab(story ? "dm" : "post")}>
          <Choice checked={d.target === "post"} label="comments on a specific post or reel" onSelect={() => pickTarget("post")}>
            {mediaError ? <p className="text-xs text-danger">{mediaError}</p>
              : !media ? <p className="text-xs text-muted-foreground">Loading your posts…</p>
              : !media.length ? <p className="text-xs text-muted-foreground">No posts on @{handle} yet.</p>
              : <>
                <div className="grid grid-cols-4 gap-1.5" role="listbox" aria-label="Posts">
                  {(showAll ? media : media.slice(0, 4)).map((m) => <button key={m.id} type="button" role="option" aria-selected={d.platform_post_id === m.id}
                    title={m.caption?.slice(0, 80) || "Post"}
                    className={cn("relative aspect-square overflow-hidden rounded-lg bg-muted ring-offset-2 ring-offset-card", d.platform_post_id === m.id && "ring-2 ring-info")}
                    onClick={() => { set("platform_post_id", m.id); setTab("post"); }}>
                    <MediaThumb m={m} />
                  </button>)}
                </div>
                {media.length > 4 && <button type="button" className="mt-2 text-sm font-medium text-info" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : `Show all (${media.length})`}</button>}
              </>}
          </Choice>
          <Choice checked={d.target === "any"} label="comments on any post or reel" hint="Including the ones you post later." onSelect={() => pickTarget("any")} />
          <Choice checked={d.target === "story_reply"} label="replies to your story" onSelect={() => pickTarget("story_reply")} />
          <Choice checked={d.target === "story_mention"} label="mentions you in their story" onSelect={() => pickTarget("story_mention")} />
          <Choice checked={d.target === "live_comment"} label="comments during your live" onSelect={() => pickTarget("live_comment")} />
        </Box>

        {d.target !== "story_mention" && <Box title={story ? "And their reply has" : "And this comment has"} onFocus={() => setTab(story ? "dm" : "comments")}>
          <Choice checked={d.match === "words"} label="a specific word or words" onSelect={() => set("match", "words")}>
            <div className={cn("flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5", touched && !d.keywords.length ? "border-danger" : "border-border")}>
              {d.keywords.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-md bg-info/10 px-2 py-0.5 text-sm text-info">
                {k.toUpperCase()}<button type="button" aria-label={`Remove ${k}`} onClick={() => set("keywords", d.keywords.filter((x) => x !== k))}><X size={12} /></button>
              </span>)}
              <input aria-label="Keywords" className="min-w-24 flex-1 bg-transparent text-sm outline-none" placeholder={d.keywords.length ? "Add another" : "Enter a word or multiple"}
                value={keywordText} onChange={(e) => { if (/[,\n]/.test(e.target.value)) addKeywords(e.target.value); else setKeywordText(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && keywordText.trim()) { e.preventDefault(); addKeywords(keywordText); }
                  if (e.key === "Backspace" && !keywordText && d.keywords.length) set("keywords", d.keywords.slice(0, -1));
                }}
                onBlur={() => { if (keywordText.trim()) addKeywords(keywordText); }} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Press Enter after each word.</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">For example:
              {["Price", "Link", "Shop", "Info"].map((w) => <button key={w} type="button" className="rounded-full border border-info/30 px-2.5 py-0.5 text-info hover:bg-info/10" onClick={() => addKeywords(w)}>{w}</button>)}
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={d.typo_tolerance} onChange={(e) => set("typo_tolerance", e.target.checked)} /> Also catch small typos (“lnk” for “link”)
            </label>
          </Choice>
          <Choice checked={d.match === "any"} label="any word" onSelect={() => set("match", "any")} />
          {replyable && <ToggleRow label={`reply to their comments under the ${d.target === "live_comment" ? "live" : "post"}`} hint="Shows everyone that the DM is on its way."
            checked={d.publicReply} onChange={(v) => { set("publicReply", v); setTab("comments"); }}>
            <textarea aria-label="Public reply" className="input min-h-16" value={d.comment_reply ?? ""} onFocus={() => setTab("comments")} onChange={(e) => set("comment_reply", e.target.value)} />
          </ToggleRow>}
        </Box>}

        <Box title="They will get" onFocus={() => setTab("dm")}>
          <ToggleRow label="ask them to follow you first" hint="The DM comes with a “Send me the link” button. Tapping it sends the link only once they follow you." checked={d.follow_gate} onChange={(v) => set("follow_gate", v)} />
          <div className="rounded-xl bg-muted/60 p-3">
            <p className="mb-2 text-sm text-foreground">a DM</p>
            <textarea aria-label="DM message" className={cn("input min-h-28", touched && !d.dm_message.trim() && "border-danger")} value={d.dm_message} maxLength={1000}
              onChange={(e) => set("dm_message", e.target.value)} />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Insert: {[["first_name", "First name"], ["username", "Username"]].map(([tag, label]) =>
                <button key={tag} type="button" className="rounded-md border border-border px-2 py-0.5 hover:bg-hover" onClick={() => insertTag(tag)}>{label}</button>)}
              <span className="ml-auto tabular-nums">{d.dm_message.length}/{d.buttons.some((b) => b.title || b.url) ? 640 : 1000}</span>
            </div>
            <div className="mt-3 space-y-2">
              {d.buttons.map((b, i) => <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-1.5">
                <input aria-label={`Button ${i + 1} label`} className="input" placeholder="Button label" maxLength={20} value={b.title}
                  onChange={(e) => set("buttons", d.buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <input aria-label={`Button ${i + 1} link`} className="input" placeholder="https://…" inputMode="url" value={b.url}
                  onChange={(e) => set("buttons", d.buttons.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button type="button" aria-label={`Remove button ${i + 1}`} className="btn-ghost w-9 !px-0 text-danger" onClick={() => set("buttons", d.buttons.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>)}
              {d.buttons.length < 3 && <button type="button" className="btn-ghost h-8 text-xs" onClick={() => set("buttons", [...d.buttons, { title: "", url: "" }])}><Link2 size={13} /> Add a link button</button>}
            </div>
          </div>
        </Box>

        <Box title="More options">
          {d.target !== "story_mention" && d.match === "words" && <ToggleRow label="also reply when they DM you the keyword" checked={d.also_match_in_dms} onChange={(v) => set("also_match_in_dms", v)} />}
          <div className="rounded-xl bg-muted/60 p-3 text-sm text-foreground">
            <p className="mb-2">How often the same person gets it</p>
            <div className="flex flex-wrap gap-1.5">
              {([["once", "Once"], ["every_comment", "Every time they comment"]] as const).map(([v, label]) =>
                <button key={v} type="button" aria-pressed={d.repeat_mode === v}
                  className={cn("rounded-full border px-3 py-1 text-xs", d.repeat_mode === v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-hover")}
                  onClick={() => set("repeat_mode", v)}>{label}</button>)}
            </div>
            {d.repeat_mode === "every_comment" && <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">At most once every
              <input aria-label="Cooldown hours" type="number" min={1} max={720} className="input h-8 w-20" value={d.cooldown_hours ?? 24}
                onChange={(e) => set("cooldown_hours", Math.max(1, Math.min(720, Math.floor(Number(e.target.value)) || 1)))} /> hours</label>}
          </div>
        </Box>
      </div>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:h-fit">
        <div className="rounded-2xl bg-muted/40 p-4">
          <p className="mb-3 text-sm text-muted-foreground">Preview</p>
          <Phone>
            {tab === "post" ? <PostScreen handle={handle} post={post} story={story} />
              : tab === "comments" ? <CommentsScreen d={d} handle={handle} />
              : <DmScreen d={d} handle={handle} />}
          </Phone>
          <div className="mx-auto mt-3 flex w-fit gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="Preview">
            {(["post", "comments", "dm"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t}
              className={cn("rounded-full px-3 py-1 text-xs", tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setTab(t)}>{t === "dm" ? "DM" : t === "post" ? "Post" : "Comments"}</button>)}
          </div>
        </div>
      </aside>
    </div>
  </div>;
}

/* ── Phone preview ───────────────────────────────────────────────────────── */

function MediaThumb({ m }: { m: IgMedia }) {
  if (!m.media_url) return <span className="grid h-full w-full place-items-center text-muted-foreground"><IgGlyph /></span>;
  return m.media_type === "VIDEO"
    ? <video src={m.media_url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
    : <img src={m.media_url} alt="" loading="lazy" className="h-full w-full object-cover" />;
}
function Avatar({ handle, size = 28 }: { handle: string; size?: number }) {
  return <span className="grid shrink-0 place-items-center rounded-full bg-[linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)] p-[2px]" style={{ width: size, height: size }}>
    <span className="grid h-full w-full place-items-center rounded-full bg-[#111] text-[10px] font-semibold uppercase text-white">{handle.slice(0, 1)}</span>
  </span>;
}
function Phone({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-[300px] max-w-full rounded-[2.6rem] bg-[#1c2230] p-[10px] shadow-xl">
    <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[2rem] bg-[#000] text-[#fff]">
      <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold"><span>9:41</span><span className="h-4 w-20 rounded-full bg-[#1c1c1e]" /><span>5G</span></div>
      {children}
    </div>
  </div>;
}
function PostScreen({ handle, post, story }: { handle: string; post?: IgMedia; story: boolean }) {
  if (story) return <div className="flex flex-1 flex-col">
    <div className="mx-3 mt-2 h-0.5 rounded bg-[#fff]/40"><div className="h-full w-1/2 rounded bg-[#fff]" /></div>
    <div className="flex items-center gap-2 px-3 py-2 text-xs"><Avatar handle={handle} size={24} /> {handle}</div>
    <div className="m-3 grid flex-1 place-items-center rounded-2xl bg-[linear-gradient(160deg,#2b2b2b,#111)] text-center text-sm text-[#fff]/70">Your story</div>
    <div className="mx-3 mb-4 rounded-full border border-[#fff]/40 px-4 py-2 text-xs text-[#fff]/60">Send message</div>
  </div>;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center px-3 py-1.5"><ChevronLeft size={18} /><div className="flex-1 text-center leading-tight"><p className="text-[10px] uppercase text-[#fff]/60">{handle}</p><p className="text-sm font-semibold">Posts</p></div><span className="w-[18px]" /></div>
    <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold"><Avatar handle={handle} size={26} /> {handle}</div>
    <div className="aspect-square w-full bg-[#1a1a1a]">{post ? <MediaThumb m={post} /> : <span className="grid h-full place-items-center text-xs text-[#fff]/50">Pick a post on the left</span>}</div>
    <div className="flex items-center gap-3 px-3 py-2"><Heart size={18} /><MessageCircle size={18} /><Send size={18} /><Bookmark size={18} className="ml-auto" /></div>
    <p className="line-clamp-4 px-3 text-[11px] leading-snug"><b>{handle}</b> {post?.caption ?? ""}</p>
  </div>;
}
function CommentsScreen({ d, handle }: { d: IgDraft; handle: string }) {
  const said = d.match === "words" && d.keywords[0] ? d.keywords[0].toUpperCase() : "Love this! 😍";
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="h-16 bg-[#1a1a1a]" />
    <div className="-mt-4 flex flex-1 flex-col rounded-t-2xl bg-[#262626]">
      <div className="mx-auto mt-2 h-1 w-10 rounded bg-[#fff]/30" />
      <p className="border-b border-[#fff]/10 py-2 text-center text-sm font-semibold">Comments</p>
      <div className="space-y-3 p-3 text-[11px]">
        <div className="flex gap-2"><Avatar handle={SAMPLE.username} size={26} />
          <div className="min-w-0 flex-1"><p><b>{SAMPLE.username}</b> <span className="text-[#fff]/50">now</span></p><p>{said}</p><p className="mt-0.5 text-[#fff]/50">Reply</p></div><Heart size={12} className="text-[#fff]/50" />
        </div>
        {d.publicReply && d.target !== "story_reply" && <div className="ml-8 flex gap-2"><Avatar handle={handle} size={22} />
          <div className="min-w-0 flex-1"><p><b>{handle}</b> <span className="text-[#fff]/50">now</span></p><p className="whitespace-pre-wrap break-words">{fillTags(d.comment_reply || "", SAMPLE) || "…"}</p></div>
        </div>}
      </div>
      <div className="mt-auto flex justify-around px-3 pb-2 text-base">{["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"].map((e) => <span key={e}>{e}</span>)}</div>
      <div className="mx-3 mb-3 rounded-full border border-[#fff]/20 px-3 py-2 text-[10px] text-[#fff]/50">Add a comment for {SAMPLE.username}…</div>
    </div>
  </div>;
}
function DmScreen({ d, handle }: { d: IgDraft; handle: string }) {
  const text = fillTags(d.dm_message || "…", SAMPLE);
  const links = d.buttons.filter((b) => b.title.trim());
  const Bubble = ({ children }: { children: ReactNode }) => <div className="flex items-end gap-1.5"><Avatar handle={handle} size={22} />
    <div className="max-w-[78%] rounded-2xl bg-[#262626] p-2.5 text-[11px] leading-snug">{children}</div></div>;
  const Buttons = ({ titles }: { titles: string[] }) => titles.length ? <div className="mt-2 space-y-1">{titles.map((t, i) =>
    <div key={i} className="rounded-lg bg-[#3a3a3a] py-1.5 text-center font-medium">{t}</div>)}</div> : null;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center gap-2 border-b border-[#fff]/10 px-3 py-2"><ChevronLeft size={18} /><Avatar handle={handle} size={26} /><span className="flex-1 text-xs font-semibold">{handle}</span><PhoneIcon size={16} /><Video size={16} /></div>
    <div className="flex-1 space-y-2 overflow-y-auto p-3">
      {d.follow_gate ? <>
        <Bubble><p className="whitespace-pre-wrap break-words">{text}</p><Buttons titles={["Send me the link"]} /></Bubble>
        <div className="flex justify-end"><span className="rounded-2xl bg-[#6b4cf6] px-3 py-1.5 text-[11px]">Send me the link</span></div>
        <Bubble><p className="whitespace-pre-wrap break-words">{text}</p><Buttons titles={links.map((b) => b.title)} /></Bubble>
        <p className="text-center text-[9px] text-[#fff]/40">The link is sent once they follow @{handle}</p>
      </> : <Bubble><p className="whitespace-pre-wrap break-words">{text}</p><Buttons titles={links.map((b) => b.title)} /></Bubble>}
    </div>
    <div className="mx-3 mb-3 rounded-full bg-[#262626] px-3 py-2 text-[10px] text-[#fff]/50">Message…</div>
  </div>;
}
function MiniPhone() {
  return <Phone><DmScreen d={{ ...newDraft(), dm_message: "Hey {{first_name}}! Here's the link you asked for 👇", buttons: [{ title: "Open the link", url: "https://example.com" }] }} handle="yourshop" /></Phone>;
}
