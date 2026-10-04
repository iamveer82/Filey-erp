import { FileySpinner as Loader2 } from "./FileySpinner";
import { isLocalMode } from "../lib/dataMode";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Trash2, MessageSquare, Reply, X } from "lucide-react";
import { messages, org, type OrgMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { InfoCard } from "./ui";
import MentionInput, { type MentionMember } from "./MentionInput";
import { UserAvatar } from "./AvatarPicker";
import { TeamAttachmentPicker, TeamMessageAttachment } from "./TeamChatAttachments";

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Render message body, highlighting @mentions. */
function renderBody(body: string): ReactNode {
  const parts = body.split(/(@[\p{L}\p{N}_.\-]+)/gu);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-medium underline decoration-muted-foreground/50 underline-offset-2">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

/** Individual message row — module-level so React doesn't re-mount on every parent render. */
function MessageRow({
  m,
  isReply,
  userId,
  onReply,
  onDelete,
}: {
  m: OrgMessage;
  isReply?: boolean;
  userId?: string;
  onReply: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const sent = m.user_id === userId;
  return (
    <div className={`group flex items-start gap-2 ${sent ? 'flex-row-reverse' : ''}`}>
      <UserAvatar src={m.author_avatar} name={m.author} className="h-8 w-8 text-[11px]" />
      <div className="min-w-0 max-w-[85%] sm:max-w-[75%]">
        <p className={`mb-1 flex flex-wrap items-baseline gap-x-2 text-xs ${sent ? 'justify-end' : ''}`}>
          <span className="font-medium text-foreground">{m.author}</span>
          <time dateTime={m.created_at} title={new Date(m.created_at).toLocaleString()} className="text-[11px] text-muted-foreground">{ago(m.created_at)}</time>
        </p>
        <div className={`rounded-2xl px-3.5 py-2.5 text-foreground ${sent ? 'rounded-tr-sm bg-muted' : 'rounded-tl-sm border border-border bg-background'}`}>
          {!!m.body && <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{renderBody(m.body)}</p>}
          {m.attachments?.map(attachment => <TeamMessageAttachment key={attachment.path} attachment={attachment} />)}
        </div>
        <div className={`mt-1 flex items-center gap-1 ${sent ? 'justify-end' : ''}`}>
          {!isReply && <button type="button" onClick={() => onReply(m.id)} className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11"><Reply size={12} /> Reply</button>}
          {sent && <button type="button" aria-label="Delete message" onClick={() => onDelete(m.id)} className="btn-ghost h-8 w-8 !p-0 text-muted-foreground hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"><Trash2 size={12} /></button>}
        </div>
      </div>
    </div>
  );
}

/** Company message board — org-wide team feed with threaded replies and
 * @mention highlighting. */
export default function CompanyMessages({
  /** Which channel to show and post into. Defaults to the room every message
   *  predating channels already belongs to. */
  channel = "general",
  focusMessage,
  onRead,
  recipient,
  recipientName,
  draft,
  onDraftChange,
  sending = false,
  onSendStateChange,
  active = true,
}: {
  channel?: string;
  focusMessage?: number;
  onRead?: () => void;
  recipient?: string;
  recipientName?: string;
  draft?: { text: string; files: File[] };
  onDraftChange?: (draft: { text: string; files: File[] }) => void;
  sending?: boolean;
  onSendStateChange?: (state: "sending" | "sent" | "failed", reply: boolean) => void;
  active?: boolean;
} = {}) {
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const [all, setAll] = useState<OrgMessage[]>([]);
  const [text, setText] = useState(draft?.text || "");
  const [postingHere, setBusy] = useState(false);
  const busy = postingHere || sending;
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [files,setFiles]=useState<File[]>(draft?.files || []);
  const [replyFiles,setReplyFiles]=useState<File[]>([]);
  const posting=useRef(false);
  const [members, setMembers] = useState<MentionMember[]>([]);
  const [pages,setPages] = useState(1);
  const [hasMore,setHasMore] = useState(false);
  const [error,setError] = useState("");
  const request = useRef(0);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const focusRef = useRef<HTMLLIElement>(null);
  const feedRef = useRef<HTMLUListElement>(null);
  const stickToBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const focusedMessage = useRef<number | undefined>(undefined);
  const olderScroll = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => { onDraftChange?.({ text, files }); }, [text, files, onDraftChange]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      let before: number | undefined;
      let next: number | null = null;
      let rows: OrgMessage[] = [];
      for (let page = 0; page < pages; page++) {
        const result = await messages.page(channel,before,recipient);
        rows.push(...result.rows); next = result.next;
        if (next === null) break;
        before = next;
      }
      if (focusMessage && !rows.some(m => m.id === focusMessage)) rows.push(...await messages.thread(channel,focusMessage,recipient));
      if (id !== request.current) return;
      rows = [...new Map(rows.map(m => [m.id,m])).values()];
      setAll(rows); setHasMore(next !== null); setError("");
    } catch(e) {
      if (id === request.current) { olderScroll.current = null; setError(e instanceof Error ? e.message : "Could not load messages."); }
    } finally { if (id === request.current) setLoading(false); }
  },[channel,pages,focusMessage,recipient]);
  useEffect(() => { void load(); return () => { request.current++; }; },[load]);
  useLiveSync(() => void load(),["org_messages","profiles","org_members"]);
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    if (focusMessage && focusedMessage.current !== focusMessage && focusRef.current) {
      focusRef.current.scrollIntoView({ block: "nearest" });
      focusedMessage.current = focusMessage;
      stickToBottom.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      setAtBottom(stickToBottom.current);
    } else if (olderScroll.current) {
      feed.scrollTop = olderScroll.current.top + feed.scrollHeight - olderScroll.current.height;
      olderScroll.current = null;
    } else if (stickToBottom.current) feed.scrollTop = feed.scrollHeight;
  },[all,focusMessage]);

  const jumpToLatest = () => {
    stickToBottom.current = true;
    setAtBottom(true);
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  };
  useEffect(() => {
    const last = Math.max(0,...all.map(m => m.id));
    if (!last || loading || error || !atBottom) return;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      if (!active && typeof matchMedia !== "undefined" && !matchMedia("(min-width: 1024px)").matches) return;
      void messages.markRead(channel,last,recipient).then(() => onReadRef.current?.()).catch(() => {});
    };
    read(); document.addEventListener("visibilitychange",read); window.addEventListener("resize",read);
    return () => { document.removeEventListener("visibilitychange",read); window.removeEventListener("resize",read); };
  },[all,channel,loading,error,recipient,atBottom,active]);
  const loadMembers = useCallback(() => {
    if (isLocalMode()) { setMembers([]); return; }
    org
      .members()
      .then((ms) => setMembers(ms.map((m) => ({ id: m.user_id, name: m.name, avatar: m.avatar }))))
      .catch(() => toast.error("Failed to load members"));
  }, [toast]);
  useEffect(loadMembers, [loadMembers]);
  useLiveSync(loadMembers, ["org_members", "profiles"]);

  const roots = useMemo(
    () => {
      return all.filter(m => !m.parent_id).sort((a,b) => a.id-b.id);
    },
    [all]
  );
  const repliesByParent = useMemo(() => {
    const map = new Map<number, OrgMessage[]>();
    for (const m of all) {
      if (!m.parent_id) continue;
      const arr = map.get(m.parent_id) ?? [];
      arr.push(m);
      map.set(m.parent_id, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.id - b.id);
    return map;
  }, [all]);

  const post = async (body: string, parentId: number | null) => {
    const trimmed = body.trim();
    const attachments=parentId?replyFiles:files;
    if ((!trimmed && !attachments.length) || posting.current || sending) return;
    posting.current=true;
    setBusy(true);
    onSendStateChange?.("sending", parentId !== null);
    let sent = false;
    try {
      await messages.post(trimmed, parentId, channel, attachments,recipient);
      sent = true;
      stickToBottom.current=true;
      setAtBottom(true);
      if (parentId) {
        setReplyText("");
        setReplyFiles([]);
        setReplyTo(null);
      } else {
        setText("");
        setFiles([]);
        onDraftChange?.({ text: "", files: [] });
      }
      await load();
    } catch (e) {
      toast.error(`Could not post: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      posting.current=false;
      setBusy(false);
      onSendStateChange?.(sent ? "sent" : "failed", parentId !== null);
    }
  };

  const remove = async (id: number) => {
    if (
      !(await confirm({
        title: "Delete message",
        message: "Delete this message? This cannot be undone.",
      }))
    )
      return;
    try {
      await messages.remove(id);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleReply = (id: number) => { if(!busy) {setReplyTo((r) => (r === id ? null : id)); setReplyText(''); setReplyFiles([]);} };

  return (
    <InfoCard
      title={recipient ? recipientName || 'Private chat' : `#${channel}`}
      action={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground" aria-label={`${all.length} messages`}>
          <MessageSquare size={12} /> {all.length}
        </span>
      }
    >
      {/* Composer stays below the independently scrolling conversation. */}
      {isLocalMode() && <p className="mb-3 text-xs text-muted-foreground">Local channels stay on this device. Open a cloud workspace to talk with your team.</p>}
      {recipient && <p className="mb-4 text-xs text-muted-foreground">Private conversation · Only the two of you can read these messages.</p>}
      <div className="flex min-w-0 flex-col gap-4">
      <fieldset disabled={busy} className="order-2 min-w-0 space-y-1 rounded-2xl border border-border bg-muted/60 p-2 focus-within:ring-2 focus-within:ring-ring">
      <div className="flex min-w-0 items-end gap-2">
      <MentionInput
          value={text}
          onChange={setText}
          onEnter={() => post(text, null)}
          members={members}
          label="Team update"
          placeholder={recipient ? `Message ${recipientName || 'your teammate'}…` : "Share an update… type @ to mention"}
        />
        <button
          aria-label="Post message"
          className="btn-primary h-10 w-10 shrink-0 !p-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          disabled={busy || (!text.trim() && !files.length)}
          onClick={() => post(text, null)}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={17} />}
        </button>
      </div>
      {!isLocalMode() && <TeamAttachmentPicker files={files} onChange={setFiles} label="Attach files to message"/>}
      <p className="hidden px-2 pb-1 text-[11px] text-muted-foreground sm:block">Enter to send · Shift+Enter for a new line</p>
      {busy && <p role="status" className="text-xs text-muted-foreground">{files.length || replyFiles.length?'Uploading files and sending…':'Sending…'}</p>}
      </fieldset>

      {/* feed */}
      {error && <div role="alert" className="mb-3 rounded-xl bg-muted p-3 text-sm"><p>{error}</p><button className="btn-ghost mt-2" onClick={() => void load()}>Try again</button></div>}
      {loading && all.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      ) : roots.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {recipient ? 'Start the conversation. Send a message, photo or document.' : 'No messages yet — say hello to your team.'}
        </p>
      ) : (
        <div className="relative min-w-0">
        <ul ref={feedRef} onScroll={e=>{const el=e.currentTarget;stickToBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;setAtBottom(stickToBottom.current);}} className="space-y-4 min-h-48 max-h-[50dvh] overflow-y-auto overscroll-contain [overflow-anchor:none] px-1 pb-2" aria-label={recipient?'Private messages':'Channel conversations'}>
          {hasMore && <li><button className="btn-ghost w-full" disabled={loading} onClick={() => {const feed=feedRef.current;if(feed) olderScroll.current={height:feed.scrollHeight,top:feed.scrollTop};setPages(n => n+1);}}>{loading ? "Loading…" : "Load older conversations"}</button></li>}
          {roots.map((m) => {
            const replies = repliesByParent.get(m.id) ?? [];
            const focused = m.id === focusMessage || replies.some(reply => reply.id === focusMessage);
            return (
              <li key={m.id} ref={focused ? focusRef : undefined} className={focused ? "rounded-xl bg-muted/60 p-3" : undefined}>
                <MessageRow
                  m={m}
                  userId={user?.id}
                  onReply={handleReply}
                  onDelete={remove}
                />
                {(replies.length > 0 || replyTo === m.id) && (
                  <div className="ml-6 mt-2 space-y-2 border-l border-border pl-3">
                    {replies.map((r) => (
                      <MessageRow
                        key={r.id}
                        m={r}
                        isReply
                        userId={user?.id}
                        onReply={handleReply}
                        onDelete={remove}
                      />
                    ))}
                    {replyTo === m.id && (
                      <fieldset disabled={busy} className="min-w-0 space-y-2 rounded-xl border border-border bg-muted/60 p-2 focus-within:ring-2 focus-within:ring-ring">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>Replying to {m.author}</span><button type="button" className="btn-ghost h-9 w-9 !p-0" aria-label="Cancel reply" onClick={() => handleReply(m.id)}><X size={14}/></button></div>
                      <div className="flex min-w-0 items-center gap-2">
                        <MentionInput
                          small
                          value={replyText}
                          onChange={setReplyText}
                          onEnter={() => post(replyText, m.id)}
                          members={members}
                          label={`Reply to ${m.author}`}
                          placeholder={`Reply to ${m.author}… type @ to mention`}
                        />
                        <button
                          aria-label="Post reply"
                          className="btn-primary shrink-0"
                          disabled={busy || (!replyText.trim() && !replyFiles.length)}
                          onClick={() => post(replyText, m.id)}
                        >
                          <ArrowUp size={16} />
                        </button>
                      </div>
                      {!isLocalMode() && <TeamAttachmentPicker files={replyFiles} onChange={setReplyFiles} label="Attach files to reply"/>}
                      </fieldset>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {!atBottom && <button type="button" onClick={jumpToLatest} className="btn-secondary absolute bottom-3 left-1/2 -translate-x-1/2 gap-1.5 text-xs shadow-sm"><ArrowDown size={14} /> Latest messages</button>}
        </div>
      )}
      </div>
    </InfoCard>
  );
}
