import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Send, Trash2, MessageSquare, Loader2, Reply } from "lucide-react";
import { messages, org, type OrgMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { InfoCard } from "./ui";
import MentionInput, { type MentionMember } from "./MentionInput";

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";

const AVATAR_TONES = [
  "bg-primary-100 text-primary-700",
  "bg-secondary-400/20 text-secondary-600",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
];
const tone = (id: string) => {
  let h = 0;
  for (const c of id) h = (h + c.charCodeAt(0)) % AVATAR_TONES.length;
  return AVATAR_TONES[h];
};

/** Render message body, highlighting @mentions. */
function renderBody(body: string): ReactNode {
  const parts = body.split(/(@[\w.\-]+)/g);
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-semibold text-primary-700">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

/** Company message board — org-wide team feed with threaded replies and
 *  @mention highlighting. */
export default function CompanyMessages() {
  const { user } = useAuth();
  const { toast } = useUI();
  const [all, setAll] = useState<OrgMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [members, setMembers] = useState<MentionMember[]>([]);

  const load = () => {
    messages
      .list()
      .then(setAll)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useLiveSync(load);
  useEffect(() => {
    org
      .members()
      .then((ms) =>
        setMembers(ms.map((m) => ({ id: m.user_id, name: m.name })))
      )
      .catch(() => {});
  }, []);

  const roots = useMemo(
    () =>
      all
        .filter((m) => !m.parent_id)
        .sort((a, b) => b.id - a.id),
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
    if (!trimmed) return;
    setBusy(true);
    try {
      await messages.post(trimmed, parentId);
      if (parentId) {
        setReplyText("");
        setReplyTo(null);
      } else {
        setText("");
      }
      load();
    } catch (e) {
      toast.error(
        `Could not post: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await messages.remove(id);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const Message = ({ m, isReply }: { m: OrgMessage; isReply?: boolean }) => (
    <div className="flex gap-3 group">
      <span
        className={`grid ${
          isReply ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-[11px]"
        } shrink-0 place-items-center rounded-full font-bold ${tone(
          m.user_id
        )}`}
      >
        {initials(m.author)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold text-ink">{m.author}</span>{" "}
          <span className="text-[11px] text-brand-400">{ago(m.created_at)}</span>
        </p>
        <p className="text-sm text-brand-600 whitespace-pre-wrap break-words">
          {renderBody(m.body)}
        </p>
        {!isReply && (
          <button
            onClick={() =>
              setReplyTo((r) => (r === m.id ? null : m.id))
            }
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400 hover:text-primary-700 cursor-pointer"
          >
            <Reply size={11} /> Reply
          </button>
        )}
      </div>
      {m.user_id === user?.id && (
        <button
          aria-label="Delete message"
          onClick={() => remove(m.id)}
          className="opacity-0 group-hover:opacity-100 text-brand-300 hover:text-danger transition-opacity shrink-0 cursor-pointer self-start"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );

  return (
    <InfoCard
      title="Company Messages"
      action={
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400">
          <MessageSquare size={12} /> {all.length}
        </span>
      }
    >
      {/* composer */}
      <div className="flex items-center gap-2 mb-3">
        <MentionInput
          value={text}
          onChange={setText}
          onEnter={() => post(text, null)}
          members={members}
          placeholder="Share an update… type @ to mention"
        />
        <button
          aria-label="Post message"
          className="btn-primary shrink-0"
          disabled={busy || !text.trim()}
          onClick={() => post(text, null)}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>

      {/* feed */}
      {loading && all.length === 0 ? (
        <p className="text-sm text-brand-400 py-4 text-center">Loading…</p>
      ) : roots.length === 0 ? (
        <p className="text-sm text-brand-400 py-4 text-center">
          No messages yet — say hello to your team.
        </p>
      ) : (
        <ul className="space-y-4 max-h-96 overflow-y-auto">
          {roots.map((m) => {
            const replies = repliesByParent.get(m.id) ?? [];
            return (
              <li key={m.id}>
                <Message m={m} />
                {(replies.length > 0 || replyTo === m.id) && (
                  <div className="ml-6 mt-2 space-y-2 border-l-2 border-brand-100 dark:border-[#2A261E] pl-3">
                    {replies.map((r) => (
                      <Message key={r.id} m={r} isReply />
                    ))}
                    {replyTo === m.id && (
                      <div className="flex items-center gap-2 pt-1">
                        <MentionInput
                          small
                          value={replyText}
                          onChange={setReplyText}
                          onEnter={() => post(replyText, m.id)}
                          members={members}
                          placeholder={`Reply to ${m.author}… type @ to mention`}
                        />
                        <button
                          className="btn-primary shrink-0 !py-1.5"
                          disabled={busy || !replyText.trim()}
                          onClick={() => post(replyText, m.id)}
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </InfoCard>
  );
}
