import { useEffect, useState } from "react";
import { Send, Trash2, MessageSquare, Loader2 } from "lucide-react";
import { messages, type OrgMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useUI } from "../lib/ui";
import { useLiveSync } from "../lib/realtime";
import { InfoCard } from "./ui";

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

/** Company message board — an org-wide team feed on the dashboard. */
export default function CompanyMessages() {
  const { user } = useAuth();
  const { toast } = useUI();
  const [items, setItems] = useState<OrgMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    messages
      .list()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useLiveSync(load);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await messages.post(body);
      setText("");
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

  return (
    <InfoCard
      title="Company Messages"
      action={
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400">
          <MessageSquare size={12} /> {items.length}
        </span>
      }
    >
      {/* composer */}
      <div className="flex items-center gap-2 mb-3">
        <input
          className="input"
          placeholder="Share an update with your team…"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          aria-label="Post message"
          className="btn-primary shrink-0"
          disabled={busy || !text.trim()}
          onClick={send}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>

      {/* feed */}
      {loading && items.length === 0 ? (
        <p className="text-sm text-brand-400 py-4 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-brand-400 py-4 text-center">
          No messages yet — say hello to your team.
        </p>
      ) : (
        <ul className="space-y-3 max-h-72 overflow-y-auto">
          {items.map((m) => (
            <li key={m.id} className="flex gap-3 group">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${tone(
                  m.user_id
                )}`}
              >
                {initials(m.author)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">
                  <span className="font-semibold text-ink">{m.author}</span>{" "}
                  <span className="text-[11px] text-brand-400">
                    {ago(m.created_at)}
                  </span>
                </p>
                <p className="text-sm text-brand-600 whitespace-pre-wrap break-words">
                  {m.body}
                </p>
              </div>
              {m.user_id === user?.id && (
                <button
                  aria-label="Delete message"
                  onClick={() => remove(m.id)}
                  className="opacity-0 group-hover:opacity-100 text-brand-300 hover:text-danger transition-opacity shrink-0 cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}
