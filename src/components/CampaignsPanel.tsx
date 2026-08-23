import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Play, Plus, Send, Users } from "lucide-react";

import {
  crm,
  billing,
  type Campaign,
  type CampaignRecipient,
  type CrmCustomer,
  type CompanyProfile,
} from "../lib/api";
import type { Lead } from "../lib/marketing";
import { HOT_SCORE } from "../lib/marketing";
import { SelectMenu } from "./ui-menu";
import {
  buildRecipients,
  renderTemplate,
  sendCampaign,
  usedMergeFields,
  type SendProgress,
} from "../lib/campaigns";
import { errMsg } from "../lib/format";
import { useUI } from "../lib/ui";
import { DataTable, Badge, Modal, Field, InfoCard } from "./ui";

/* Campaigns: compose once, send to a slice of the lead list. The rules that
 * keep this from hurting invoice deliverability live in lib/campaigns — this
 * panel's job is to show the user exactly who will be written to, and why the
 * skipped ones were skipped, before anything is sent. */

const statusTone = (s: Campaign["status"]) =>
  s === "sent" ? "success" : s === "sending" ? "warn" : s === "paused" ? "warn" : "info";

export default function CampaignsPanel({ leads }: { leads: Lead[] }) {
  const { toast, confirm } = useUI();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const stopRef = useRef(false);

  const load = () =>
    Promise.all([
      crm.campaigns().then(setCampaigns),
      crm.customers().then(setCustomers),
      billing
        .getCompany()
        .then(setCompany)
        .catch(() => {}),
    ])
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const send = async (c: Campaign) => {
    const pending = c.recipients.filter((r) => r.status === "pending").length;
    if (!pending) return toast.error("Nothing left to send in this campaign.");

    const replyTo = company?.email?.trim();
    if (!replyTo)
      return toast.error(
        "Add a company email in Settings → Company first - it is the unsubscribe address."
      );

    const ok = await confirm({
      title: `Send "${c.name}"?`,
      message: `This emails ${pending} ${pending === 1 ? "person" : "people"}. Every message carries an unsubscribe line, and anyone who has opted out is skipped.`,
      confirmLabel: `Send ${pending}`,
    });
    if (!ok) return;

    stopRef.current = false;
    setSendingId(c.id);
    setProgress(null);
    try {
      await crm.updateCampaign(c.id, { status: "sending" });
      const { recipients, progress: done } = await sendCampaign({
        campaign: c,
        customers,
        fromName: company?.name || "Filey",
        replyTo,
        shouldStop: () => stopRef.current,
        onProgress: (p) => setProgress(p),
      });
      await crm.updateCampaign(c.id, {
        recipients,
        sent_count: done.sent,
        failed_count: done.failed,
        // Anything still pending means the run stopped early and can resume.
        status: done.remaining > 0 ? "paused" : "sent",
        ...(done.remaining === 0 ? { sent_at: new Date().toISOString() } : {}),
      });
      toast[done.failed ? "error" : "success"](
        done.stoppedBecause
          ? `Stopped after ${done.sent}: ${done.stoppedBecause}`
          : `Sent ${done.sent}${done.failed ? `, ${done.failed} failed` : ""}.`
      );
      load();
    } catch (e) {
      toast.error(errMsg(e) || "Could not send campaign");
    } finally {
      setSendingId(null);
      setProgress(null);
    }
  };

  const remove = async (c: Campaign) => {
    const ok = await confirm({
      title: "Delete campaign",
      message: `Delete "${c.name}"? The record of who was already emailed goes with it.`,
      danger: true,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    await crm.deleteCampaign(c.id);
    load();
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={() => setComposing(true)}>
          <Plus size={16} /> New campaign
        </button>
      </div>

      {sendingId != null && progress && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <Send size={16} className="text-brand-400" />
          <span className="text-sm text-foreground">
            Sent {progress.sent} · {progress.remaining} to go
            {progress.failed ? ` · ${progress.failed} failed` : ""}
          </span>
          <button
            className="btn-secondary ml-auto"
            onClick={() => {
              stopRef.current = true;
            }}
          >
            Stop
          </button>
        </div>
      )}

      <DataTable<Campaign>
        rows={campaigns}
        loading={loading}
        pageSize={10}
        rowKey={(c) => c.id}
        empty="No campaigns yet - write one and it'll appear here"
        columns={[
          {
            key: "name",
            label: "Campaign",
            sortValue: (c) => c.name,
            render: (c) => (
              <div>
                <p className="font-medium text-ink">{c.name || "Untitled"}</p>
                <p className="text-[11px] text-brand-400">{c.subject}</p>
              </div>
            ),
          },
          {
            key: "status",
            label: "Status",
            sortValue: (c) => c.status,
            render: (c) => <Badge tone={statusTone(c.status)}>{c.status}</Badge>,
          },
          {
            key: "audience",
            label: "Audience",
            render: (c) => {
              const pending = c.recipients.filter((r) => r.status === "pending").length;
              const skipped = c.recipients.filter((r) => r.status === "skipped").length;
              return (
                <span className="text-[12.5px] text-brand-500">
                  {c.recipients.length} picked · {pending} to send
                  {skipped ? ` · ${skipped} skipped` : ""}
                </span>
              );
            },
          },
          {
            key: "sent",
            label: "Sent",
            sortValue: (c) => c.sent_count,
            render: (c) => (
              <span className="tabular-nums">
                {c.sent_count}
                {c.failed_count ? (
                  <span className="text-danger"> · {c.failed_count} failed</span>
                ) : null}
              </span>
            ),
          },
          {
            key: "act",
            label: "Actions",
            render: (c) => {
              const pending = c.recipients.filter((r) => r.status === "pending").length;
              return (
                <div className="flex items-center gap-1">
                  <button
                    className="btn-ghost h-7 px-2 text-[12.5px]"
                    disabled={!pending || sendingId != null}
                    title={pending ? `Send to ${pending}` : "Nothing left to send"}
                    onClick={() => send(c)}
                  >
                    <Play size={13} /> {c.status === "paused" ? "Resume" : "Send"}
                  </button>
                  <button
                    className="btn-ghost h-7 px-2 text-[12.5px] text-danger"
                    onClick={() => remove(c)}
                  >
                    Delete
                  </button>
                </div>
              );
            },
          },
        ]}
      />

      {composing && (
        <ComposeModal
          leads={leads}
          onClose={() => setComposing(false)}
          onCreated={() => {
            setComposing(false);
            load();
          }}
        />
      )}
    </>
  );
}

/** Compose: pick the slice, write the message, see exactly who it resolves to
 *  before saving. Nothing sends from here — the list is created as a draft. */
function ComposeModal({
  leads,
  onClose,
  onCreated,
}: {
  leads: Lead[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useUI();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(
    "<p>Hi {{first_name}},</p>\n<p>Write your message here.</p>\n<p>Thanks,<br>The team</p>"
  );
  const [minScore, setMinScore] = useState(0);
  const [optedOut, setOptedOut] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    crm
      .optOuts()
      .then((list) => setOptedOut(new Set(list.map((o) => o.email.trim().toLowerCase()))))
      .catch(() => setOptedOut(new Set()));
  }, []);

  const recipients: CampaignRecipient[] = useMemo(
    () => buildRecipients(leads, optedOut, { minScore: minScore || undefined }),
    [leads, optedOut, minScore]
  );
  const willSend = recipients.filter((r) => r.status === "pending");
  const skipped = recipients.filter((r) => r.status === "skipped");

  const sample = willSend[0]
    ? leads.find((l) => l.customer.id === willSend[0].customer_id)?.customer
    : undefined;

  const save = async () => {
    if (!name.trim() || !subject.trim()) return toast.error("Name and subject required.");
    if (!willSend.length) return toast.error("This audience resolves to nobody.");
    setSaving(true);
    try {
      await crm.createCampaign({
        name: name.trim(),
        subject: subject.trim(),
        body_html: body,
        audience: { filter: "leads", min_score: minScore || undefined },
        recipients,
      });
      toast.success(`Draft saved - ${willSend.length} to send.`);
      onCreated();
    } catch (e) {
      toast.error(errMsg(e) || "Could not save campaign");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New campaign" size="2xl">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label="Campaign name">
            <input
              className="input"
              placeholder="August offer"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Subject">
            <input
              className="input"
              placeholder="A quick note for {{first_name}}"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label="Message (HTML)">
            <textarea
              className="input min-h-[180px] font-mono text-[12.5px]"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <p className="text-[12px] text-brand-500">
            Merge fields: <code>{"{{first_name}}"}</code> <code>{"{{name}}"}</code>{" "}
            <code>{"{{company}}"}</code> <code>{"{{email}}"}</code>
            {usedMergeFields(body + subject).length
              ? ` · using ${usedMergeFields(body + subject).join(", ")}`
              : ""}
          </p>
          <Field label="Only leads scoring at least">
            <SelectMenu
              value={String(minScore)}
              onChange={(v) => setMinScore(Number(v))}
              options={[
                { value: "0", label: "Everyone with an email" },
                { value: "30", label: "30+ - some history" },
                { value: String(HOT_SCORE), label: `${HOT_SCORE}+ - hot leads only` },
              ]}
            />
          </Field>
        </div>

        <div className="space-y-3">
          <InfoCard
            title="Who this reaches"
            action={<Users size={15} className="text-brand-400" />}
          >
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {willSend.length}
            </p>
            <p className="text-[12.5px] text-brand-500">
              {skipped.length
                ? `${skipped.length} skipped - unsubscribed, duplicate address, or no email on file.`
                : "Nobody skipped."}
            </p>
            {skipped.length > 0 && (
              <ul className="mt-2 max-h-24 overflow-auto space-y-1">
                {skipped.slice(0, 12).map((r) => (
                  <li
                    key={`${r.customer_id}-${r.email}`}
                    className="text-[11.5px] text-brand-400"
                  >
                    {r.name} - {r.error}
                  </li>
                ))}
              </ul>
            )}
          </InfoCard>

          <InfoCard
            title="Preview"
            action={<Mail size={15} className="text-brand-400" />}
          >
            {sample ? (
              <>
                <p className="text-[12.5px] text-brand-500">
                  To {sample.name} &lt;{sample.email}&gt;
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {renderTemplate(subject || "(no subject)", sample)}
                </p>
                <div
                  className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-2 text-[12.5px] text-ink"
                  // Preview only: the same HTML the campaign will send, rendered
                  // for the author. Merge values are escaped by renderTemplate;
                  // the surrounding markup is the author's own.
                  dangerouslySetInnerHTML={{ __html: renderTemplate(body, sample) }}
                />
              </>
            ) : (
              <p className="text-sm text-brand-500">Nobody matches this audience yet.</p>
            )}
            <p className="mt-2 text-[11.5px] text-brand-400">
              An unsubscribe line is added to every message automatically.
            </p>
          </InfoCard>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save draft"}
        </button>
      </div>
    </Modal>
  );
}
