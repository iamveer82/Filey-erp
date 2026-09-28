import { FileySpinner as Loader2 } from "./FileySpinner";
import { isLocalMode } from "../lib/dataMode";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Send, Trash2, MessageSquare, Reply } from "lucide-react";
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
      <span key={i} className="font-medium text-primary-700">
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
  direct,
}: {
  m: OrgMessage;
  isReply?: boolean;
  userId?: string;
  onReply: (id: number) => void;
  onDelete: (id: number) => void;
  direct?: boolean;
}) {
  return (
    <div className={`flex gap-3 group ${direct && m.user_id===userId?'flex-row-reverse':''}`}>
      <UserAvatar src={m.author_avatar} name={m.author} className={isReply ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-[11px]"} />
      <div className={`min-w-0 ${direct ? `max-w-[85%] rounded-xl p-3 ${m.user_id===userId?'bg-primary-500/10 text-foreground':'bg-muted'}` : 'flex-1'}`}>
        <p className="text-sm leading-snug">
          <span className="font-medium text-ink">{m.author}</span>{" "}
          <span className="text-[11px] text-brand-400">{ago(m.created_at)}</span>
        </p>
        <p className="text-sm text-brand-600 whitespace-pre-wrap break-words">
          {renderBody(m.body)}
        </p>
        {m.attachments?.map(attachment=><TeamMessageAttachment key={attachment.path} attachment={attachment}/>)}
        {!isReply && (
          <button
            onClick={() => onReply(m.id)}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand-400 hover:text-primary-700 cursor-pointer"
          >
            <Reply size={11} /> Reply
          </button>
        )}
      </div>
      {m.user_id === userId && (
        <button
          aria-label="Delete message"
          onClick={() => onDelete(m.id)}
          className="btn-ghost h-10 w-10 p-0 text-muted-foreground hover:text-danger shrink-0 self-start"
        >
          <Trash2 size={14} />
        </button>
      )}
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
}: {
  channel?: string;
  focusMessage?: number;
  onRead?: () => void;
  recipient?: string;
  recipientName?: string;
} = {}) {
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const [all, setAll] = useState<OrgMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [files,setFiles]=useState<File[]>([]);
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
      if (id === request.current) setError(e instanceof Error ? e.message : "Could not load messages.");
    } finally { if (id === request.current) setLoading(false); }
  },[channel,pages,focusMessage,recipient]);
  useEffect(() => { void load(); return () => { request.current++; }; },[load]);
  useLiveSync(() => void load(),["org_messages","profiles","org_members"]);
  useEffect(() => { if (!loading && focusMessage) focusRef.current?.scrollIntoView({block:"nearest"}); },[loading,focusMessage]);
  useEffect(() => {
    if (recipient && !focusMessage && stickToBottom.current && feedRef.current)
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
  },[all,recipient,focusMessage]);
  useEffect(() => {
    const last = Math.max(0,...all.map(m => m.id));
    if (!last || loading || error) return;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      void messages.markRead(channel,last,recipient).then(() => onReadRef.current?.()).catch(() => {});
    };
    read(); document.addEventListener("visibilitychange",read);
    return () => document.removeEventListener("visibilitychange",read);
  },[all,channel,loading,error,recipient]);
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
      const latest = new Map<number,number>();
      all.forEach(m => latest.set(m.parent_id || m.id,Math.max(latest.get(m.parent_id || m.id)||0,m.id)));
      return all.filter(m => !m.parent_id).sort((a,b) => recipient ? a.id-b.id : latest.get(b.id)!-latest.get(a.id)!);
    },
    [all,recipient]
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
    if ((!trimmed && !attachments.length) || posting.current) return;
    posting.current=true;
    setBusy(true);
    try {
      await messages.post(trimmed, parentId, channel, attachments,recipient);
      stickToBottom.current=true;
      if (parentId) {
        setReplyText("");
        setReplyFiles([]);
        setReplyTo(null);
      } else {
        setText("");
        setFiles([]);
      }
      await load();
    } catch (e) {
      toast.error(`Could not post: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      posting.current=false;
      setBusy(false);
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
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-400">
          <MessageSquare size={12} /> {all.length}
        </span>
      }
    >
      {/* composer */}
      {isLocalMode() && <p className="mb-3 text-xs text-muted-foreground">Local channels stay on this device. Open a cloud workspace to talk with your team.</p>}
      {recipient && <p className="mb-4 text-xs text-muted-foreground">Private conversation · Only the two of you can read these messages.</p>}
      <div className={`flex min-w-0 flex-col ${recipient?'gap-4':''}`}>
      <fieldset disabled={busy} className={`min-w-0 space-y-2 ${recipient?'order-2 border-t border-border pt-4':'mb-4'}`}>
      <div className="flex min-w-0 items-center gap-2">
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
          className="btn-primary shrink-0"
          disabled={busy || (!text.trim() && !files.length)}
          onClick={() => post(text, null)}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
      {!isLocalMode() && <TeamAttachmentPicker files={files} onChange={setFiles} label="Attach files to message"/>}
      {busy && <p role="status" className="text-xs text-muted-foreground">{files.length || replyFiles.length?'Uploading files and sending…':'Sending…'}</p>}
      </fieldset>

      {/* feed */}
      {error && <div role="alert" className="mb-3 rounded-xl bg-muted p-3 text-sm"><p>{error}</p><button className="btn-ghost mt-2" onClick={() => void load()}>Try again</button></div>}
      {loading && all.length === 0 ? (
        <p className="text-sm text-brand-400 py-4 text-center">Loading…</p>
      ) : roots.length === 0 ? (
        <p className="text-sm text-brand-400 py-4 text-center">
          {recipient ? 'Start the conversation. Send a message, photo or document.' : 'No messages yet — say hello to your team.'}
        </p>
      ) : (
        <ul ref={feedRef} onScroll={e=>{const el=e.currentTarget;stickToBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}} className="space-y-4 max-h-[55dvh] overflow-y-auto" aria-label={recipient?'Private messages':'Channel conversations'}>
          {roots.map((m) => {
            const replies = repliesByParent.get(m.id) ?? [];
            return (
              <li key={m.id} ref={m.id === focusMessage ? focusRef : undefined} className={m.id === focusMessage ? "rounded-xl bg-primary-500/10 p-3" : undefined}>
                <MessageRow
                  m={m}
                  userId={user?.id}
                  onReply={handleReply}
                  onDelete={remove}
                  direct={!!recipient}
                />
                {(replies.length > 0 || replyTo === m.id) && (
                  <div className="ml-6 mt-2 space-y-2 border-l-2 border-brand-100 pl-3">
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
                      <fieldset disabled={busy} className="min-w-0 space-y-2 pt-1">
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
                          <Send size={14} />
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
      )}
      {hasMore && <button className="btn-ghost mt-4 w-full" disabled={loading} onClick={() => setPages(n => n+1)}>{loading ? "Loading…" : "Load older conversations"}</button>}
      </div>
    </InfoCard>
  );
}
