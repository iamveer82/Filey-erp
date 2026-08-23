import { useEffect, useState } from "react";
import { AlertTriangle, Megaphone, RefreshCw, Send, ShieldCheck } from "lucide-react";

import {
  getZernioConfig,
  setZernioConfig,
  zernioReady,
  listAccounts,
  createPost,
  overLimit,
  type ZernioAccount,
} from "../lib/zernio";
import { errMsg } from "../lib/format";
import { useUI } from "../lib/ui";
import { Badge, Field, InfoCard } from "./ui";

/* Connect + compose for Zernio. Deliberately shows the connected accounts
 * before it shows a compose box: publishing to the wrong handle is the mistake
 * worth designing against, and it is not undoable. */

export default function ZernioPanel() {
  const { toast, confirm } = useUI();
  const [cfg, setCfg] = useState(getZernioConfig);
  const [accounts, setAccounts] = useState<ZernioAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [content, setContent] = useState("");
  const [when, setWhen] = useState("");
  const [posting, setPosting] = useState(false);

  const save = (patch: Partial<typeof cfg>) => setCfg(setZernioConfig(patch));

  const refresh = async () => {
    setLoading(true);
    setFailed("");
    try {
      setAccounts(await listAccounts(cfg.profileId));
    } catch (e) {
      setFailed(errMsg(e));
      setAccounts(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (zernioReady(cfg)) refresh();
    // Only re-probe when the credential itself changes, not on every keystroke
    // elsewhere on the page.
  }, [cfg.apiKey, cfg.enabled, cfg.profileId]);

  const chosen = (accounts ?? []).filter((a) => picked.has(a.id));
  const tooLong = overLimit(content, chosen);

  const publish = async () => {
    if (!chosen.length) return toast.error("Pick at least one account.");
    const names = chosen
      .map((a) => `${a.platform}${a.username ? ` @${a.username}` : ""}`)
      .join(", ");
    const ok = await confirm({
      title: when ? "Schedule this post?" : "Publish this post now?",
      message: `It will go out on ${names}. A published post is public - deleting it afterwards is the platform's business, not Filey's.`,
      confirmLabel: when ? "Schedule" : "Publish",
    });
    if (!ok) return;

    setPosting(true);
    try {
      const post = await createPost({
        accountIds: [...picked],
        content,
        ...(when ? { scheduledAt: new Date(when).toISOString() } : {}),
      });
      toast.success(when ? `Scheduled (${post.id}).` : `Published (${post.id}).`);
      setContent("");
      setWhen("");
    } catch (e) {
      toast.error(errMsg(e) || "Could not post");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <InfoCard
        title="Connection"
        action={<Megaphone size={15} className="text-brand-400" />}
      >
        <label className="flex items-start gap-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
            className="mt-1 cursor-pointer"
          />
          <span>
            <span className="block text-sm font-medium text-ink">
              Let Filey publish to your social accounts
            </span>
            <span className="block text-xs text-brand-500 mt-0.5">
              Off by default. Nothing is ever posted without you confirming the accounts
              first.
            </span>
          </span>
        </label>

        <Field label="Zernio API key">
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder="sk_…"
            value={cfg.apiKey}
            onChange={(e) => save({ apiKey: e.target.value.trim() })}
          />
        </Field>
        <Field label="Profile ID (optional)">
          <input
            className="input"
            placeholder="Leave blank to use every profile"
            value={cfg.profileId ?? ""}
            onChange={(e) => save({ profileId: e.target.value.trim() || undefined })}
          />
        </Field>
        <p className="text-xs text-brand-500">
          Stored on this device only, like your AI model key - it never syncs to the cloud
          and never leaves except to zernio.com.
        </p>
        <button
          className="btn-secondary mt-3"
          disabled={!zernioReady(cfg) || loading}
          onClick={refresh}
        >
          <RefreshCw size={14} /> {loading ? "Checking…" : "Test connection"}
        </button>
        {failed && <p className="mt-2 text-sm text-danger">{failed}</p>}
      </InfoCard>

      <InfoCard
        title="Connected accounts"
        action={accounts ? <Badge tone="info">{accounts.length}</Badge> : undefined}
      >
        {!zernioReady(cfg) ? (
          <p className="text-sm text-brand-500">Add your key to see accounts.</p>
        ) : accounts === null ? (
          <p className="text-sm text-brand-500">
            {loading ? "Loading…" : "Not connected yet."}
          </p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-brand-500">
            No accounts connected yet - connect them in your Zernio dashboard, then hit
            Test connection.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {accounts.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={picked.has(a.id)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        e.target.checked ? n.add(a.id) : n.delete(a.id);
                        return n;
                      })
                    }
                    className="cursor-pointer"
                  />
                  <Badge tone="info">{a.platform}</Badge>
                  <span className="text-ink">{a.displayName || a.username || a.id}</span>
                  {a.status && a.status !== "active" && (
                    <Badge tone="warn">{a.status}</Badge>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </InfoCard>

      <InfoCard title="Compose" action={<Send size={15} className="text-brand-400" />}>
        <Field label="Post">
          <textarea
            className="input min-h-[120px]"
            placeholder="What's going out?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <div className="flex items-center justify-between text-[12px] text-brand-500">
          <span>{content.trim().length} characters</span>
          <span>
            {picked.size} account{picked.size === 1 ? "" : "s"} selected
          </span>
        </div>

        {tooLong.length > 0 && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-2.5">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-danger">
              <AlertTriangle size={13} /> Too long for:
            </p>
            <ul className="mt-1">
              {tooLong.map((t) => (
                <li key={t.platform} className="text-[12px] text-foreground">
                  {t.platform} - {t.over} over the {t.limit} limit
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Schedule for (optional)">
          <input
            type="datetime-local"
            className="input"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <button
          className="btn-primary mt-2"
          disabled={
            !zernioReady(cfg) ||
            !picked.size ||
            (!content.trim() && true) ||
            tooLong.length > 0 ||
            posting
          }
          onClick={publish}
        >
          <Send size={15} /> {posting ? "Sending…" : when ? "Schedule" : "Publish now"}
        </button>
      </InfoCard>

      <InfoCard
        title="What Filey will and won't do"
        action={<ShieldCheck size={15} className="text-brand-400" />}
      >
        <p className="text-sm text-ink">
          Filey publishes only to accounts you tick, and the AI assistant has to ask
          before it posts anything - the same confirm step that guards sending money.
        </p>
        <p className="mt-2 text-xs text-brand-500">
          There is no "post to all" shortcut on purpose. A social post is public and
          effectively permanent, and an accidental broadcast is not something an undo
          button fixes.
        </p>
      </InfoCard>
    </div>
  );
}
