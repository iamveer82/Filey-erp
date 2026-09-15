import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, FileText, Link2, Loader2, MessageCircle, Send, Share2, Sparkles, Square } from "lucide-react";
import { Modal, ErrorBanner } from "./ui";
import { cn, errMsg } from "../lib/format";
import { bridgeState, hasDesktop, onBridgeState } from "../lib/waBridge";
import { internationalPhone, openMessageDraft, prepareWhatsAppDocument, saveDocumentPdf, type MessageChannel } from "../lib/documentMessage";
import { agentStorageScope, AGENT_STORAGE_EVENT, requireAgentStorageScope } from "../lib/agentStorage";
import { computerUseSupported } from "../lib/computerUse";
import { beginMessage, finishMessage, sendPairedDocument, messageJobs, blocksMessage, OUTBOX_EVENT, type MessageJob } from "../lib/messageOutbox";
import { waLogAdd, waLogList, type WaLogEntry } from "../lib/waLog";
const PdfCanvas = lazy(() => import("./PdfCanvas"));

export interface DocumentMessageProps {
  documentKey?: string;
  documentVersion?: string;
  title: string;
  phone: string;
  message: string;
  channel: MessageChannel;
  loadPdf: () => Promise<File>;
  createLink?: () => Promise<string>;
}

export default function DocumentMessageDialog({ documentKey, documentVersion, title, phone: initialPhone, message: initialMessage, channel: initialChannel, loadPdf, createLink, onClose }: DocumentMessageProps & { onClose: () => void }) {
  const [channel, setChannel] = useState(initialChannel);
  const [phone, setPhone] = useState(initialPhone);
  const [message, setMessage] = useState(initialMessage);
  const [file, setFile] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [jobs, setJobs] = useState<MessageJob[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [computerRunning, setComputerRunning] = useState(false);
  const [link, setLink] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [scope] = useState(agentStorageScope);
  const [preview, setPreview] = useState(false);
  const historyKey = documentKey || title;
  const version = documentVersion || historyKey;
  const recentShares = () => waLogList({ limit: 200 }).filter(entry => entry.document?.key === historyKey).slice(-5).reverse();
  const [history, setHistory] = useState(recentShares);
  const remember = (outcome: NonNullable<WaLogEntry["document"]>["outcome"], recipient = phone) => {
    assertCurrent();
    waLogAdd({ dir: "out", from: recipient, text: `[Invoice sharing: ${outcome === "draft" ? "draft opened, not sent" : outcome === "unknown" ? "outcome unknown, check messaging app" : outcome}] ${body}`, document: { key: historyKey, filename: file?.name || "", channel, outcome } }, scope ?? "signed-out");
    setHistory(recentShares());
  };
  const [stale, setStale] = useState(false);
  const busyRef = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const computerAbort = useRef<AbortController | null>(null);
  const context = () => ({ expectedScope: scope ?? "signed-out", signal: lifetime.current?.signal });
  const assertCurrent = () => {
    context().signal?.throwIfAborted();
    requireAgentStorageScope(scope ?? "signed-out");
  };

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    lifetime.current = controller;
    const check = () => {
      if (agentStorageScope() === scope) return;
      controller.abort();
      setStale(true); setFile(null); setLink(""); setSavedPath(""); setNotice(""); setHistory([]);
      setError("Your workspace changed. Close this dialog and open the invoice in the current workspace.");
    };
    window.addEventListener(AGENT_STORAGE_EVENT, check);
    window.addEventListener("filey:workspace-changed", check);
    window.addEventListener("storage", check);
    return () => {
      mounted.current = false;
      controller.abort();
      window.removeEventListener(AGENT_STORAGE_EVENT, check);
      window.removeEventListener("filey:workspace-changed", check);
      window.removeEventListener("storage", check);
    };
  }, [scope]);

  useEffect(() => {
    let active = true;
    computerAbort.current?.abort();
    setPdfError(""); setFile(null); setSavedPath("");
    void (async () => {
      requireAgentStorageScope(scope ?? "signed-out");
      const value = await loadPdf();
      requireAgentStorageScope(scope ?? "signed-out");
      if (active && !lifetime.current?.signal.aborted) setFile(value);
    })().catch((e) => { if (active && !lifetime.current?.signal.aborted) setPdfError(errMsg(e)); });
    return () => { active = false; };
  }, [loadPdf, attempt, scope]);

  useEffect(() => {
    let active = true;
    void bridgeState().then((s) => { if (active) setConnected(s.state === "connected"); })
      .catch(() => { if (active) setConnected(false); });
    const stop = onBridgeState((s) => setConnected(s.state === "connected"));
    return () => { active = false; stop(); };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => { void messageJobs(scope ?? "signed-out").then(rows => {
      if (active) { setJobs(rows); setHistoryReady(true); }
    }).catch(error => { if (active) { setHistoryReady(false); setError(errMsg(error)); } }); };
    refresh();
    window.addEventListener(OUTBOX_EVENT, refresh);
    return () => { active = false; window.removeEventListener(OUTBOX_EVENT, refresh); };
  }, [scope]);

  const body = link ? `${message}\n\n${link}` : message;
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current || stale) return;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try { assertCurrent(); await action(); }
    catch (e) { if (mounted.current && (e as Error).name !== "AbortError") setError(errMsg(e)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  let nativeShare = false;
  try { nativeShare = !!file && !!navigator.canShare?.({ files: [file] }) && !!navigator.share; } catch { /* File sharing is unavailable on this device. */ }
  const pairedSend = channel === "whatsapp" && hasDesktop && connected;
  const computerSupported = computerUseSupported();
  let accepted = false;
  let computerAttempted = false;
  try {
    const recipient = internationalPhone(phone);
    const previous = jobs.filter(job => job.documentKey === historyKey && job.version === version && job.recipient === recipient && blocksMessage(job));
    accepted = previous.some(job => job.outcome === "accepted" || job.outcome === "observed_sent");
    computerAttempted = previous.some(job => job.outcome === "sending" || job.outcome === "unknown");
  } catch { /* The input is still being edited. */ }
  const savePdf = async () => {
    if (!file) throw new Error("The invoice PDF is not ready.");
    const saved = await saveDocumentPdf(file, context());
    setSavedPath(saved.path ?? "");
    return saved;
  };

  return (
    <Modal open size="lg" title={`Send ${title}`} onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label="Message channel">
          {(["whatsapp", "sms"] as const).map((value) => (
            <button key={value} type="button" disabled={busy || stale} aria-pressed={channel === value}
              className={cn("chip", channel === value && "chip-active")}
              onClick={() => { setChannel(value); setNotice(""); }}>
              {value === "whatsapp" ? <MessageCircle size={14} /> : <Send size={14} />}
              {value === "whatsapp" ? "WhatsApp" : "Messages / SMS"}
            </button>
          ))}
        </div>
        <div><label className="label" htmlFor="document-message-phone">Recipient phone</label>
          <input id="document-message-phone" aria-describedby="document-message-phone-help" type="tel" autoComplete="tel" className="input" value={phone} disabled={busy || stale}
            placeholder="+971 50 123 4567" onChange={(e) => setPhone(e.target.value)} />
          <p id="document-message-phone-help" className="help">Include the country code. You can change the saved contact number here.</p>
        </div>
        <label className="block"><span className="label">Message</span>
          <textarea className="textarea min-h-28" value={message} disabled={busy || stale} maxLength={4000}
            onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="flex items-start gap-3 border-y border-border py-4">
          <FileText size={20} className="shrink-0 text-muted-foreground mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium break-words">{file?.name || (pdfError ? "PDF unavailable" : stale ? "Workspace changed" : "Preparing invoice PDF…")}</p>
            <p className="text-xs text-muted-foreground mt-1">{file ? `${Math.max(1, Math.ceil(file.size / 1024))} KB · PDF ready to share` : "Uses the saved invoice and its selected template."}</p>
            {pdfError && <p role="alert" className="error-text">{pdfError} <button disabled={busy || stale} className="underline" onClick={() => setAttempt((n) => n + 1)}>Retry PDF</button></p>}
          </div>
          {!file && !pdfError && !stale && <Loader2 size={16} className="animate-spin shrink-0" />}
          {file && <button className="btn-ghost shrink-0" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? "Hide PDF" : "Preview PDF"}</button>}
        </div>
        {preview && file && <section aria-label="Invoice PDF preview" className="h-[420px] overflow-hidden rounded-xl border border-border bg-muted"><Suspense fallback={<p className="p-4 text-sm">Loading preview…</p>}><PdfCanvas file={file}/></Suspense></section>}
        {createLink && !link && <div>
          <button className="btn-ghost" disabled={busy || stale} onClick={() => void run(async () => { const value = await createLink(); assertCurrent(); setLink(value); })}><Link2 size={14} /> Add invoice link</button>
          <p className="help">Anyone with this link can view the invoice. Adding it enables public access.</p>
        </div>}
        {link && <div className="rounded-md bg-muted p-3 text-xs break-all"><span className="block font-medium mb-1">Invoice link included</span>{link}</div>}
        {channel === "whatsapp" && <section aria-label="Filey AI WhatsApp sharing" className="rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium"><Sparkles size={16} /> Let Filey AI send it</div>
          <p id="whatsapp-computer-disclosure" className="mt-2 text-xs text-muted-foreground leading-relaxed">
            {computerSupported
              ? "Filey AI checks the number, attaches this PDF and sends your exact message. Clicking Send allows mouse and keyboard control of its WhatsApp window and file picker until this task finishes or you stop it. Screenshots go to your selected AI model."
              : "Automatic sending runs in the installed Windows app. In this localhost/browser preview, use the sharing options below."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">Sign in to WhatsApp in Filey Browser. Use a vision-capable local model or your own AI provider. Filey stops if login is needed.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" aria-describedby="whatsapp-computer-disclosure"
              disabled={!computerSupported || !historyReady || busy || stale || !file || !message.trim() || accepted || computerAttempted}
              onClick={() => void run(async () => {
                const recipient = internationalPhone(phone);
                const controller = new AbortController();
                computerAbort.current = controller;
                setComputerRunning(true);
                let job: MessageJob | undefined;
                try {
                  job = await beginMessage({documentKey:historyKey, version, file:file!, filename:file!.name, recipient, text:body, method:"computer"}, scope ?? "signed-out");
                  const { sendWhatsAppWithComputer } = await import("../lib/whatsappComputerSend");
                  assertCurrent();
                  const result = await sendWhatsAppWithComputer({
                    file: file!, phone: recipient, text: body, expectedScope: scope ?? "signed-out",
                    signal: AbortSignal.any([controller.signal, ...(lifetime.current ? [lifetime.current.signal] : [])]),
                    onProgress: (progress) => {
                      assertCurrent();
                      if (controller.signal.aborted) return;
                      setNotice(progress.message);
                      if (progress.path) setSavedPath(progress.path);
                    },
                  });
                  await finishMessage(job, result.sendAttempted ? (result.status === "sent" ? "observed_sent" : "unknown") : "not_sent");
                  assertCurrent();
                  if (result.path) setSavedPath(result.path);
                  setNotice(result.message);
                  if (result.sendAttempted) remember(result.status === "sent" ? "observed_sent" : "unknown", recipient);
                } catch (error) {
                  if (job) await finishMessage(job, "unknown");
                  throw error;
                } finally {
                  if (computerAbort.current === controller) computerAbort.current = null;
                  if (mounted.current) setComputerRunning(false);
                }
              })}>
              {computerRunning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {computerRunning ? "Filey AI is working…" : computerAttempted ? "Check the send in WhatsApp" : "Send with Filey AI"}
            </button>
            {computerRunning && <button type="button" className="btn-ghost" onClick={() => computerAbort.current?.abort()}><Square size={14} /> Stop</button>}
            {!computerRunning && <a className="btn-ghost" href="#/settings?section=ai" onClick={onClose}>AI settings</a>}
          </div>
        </section>}
        {(channel === "sms" || pairedSend) && <p className="text-xs text-muted-foreground leading-relaxed">
          {channel === "sms"
            ? "SMS sends the message and any invoice link, without a PDF attachment. Use Share PDF to choose a supported messaging app. Carrier charges may apply."
            : pairedSend ? "Paired WhatsApp sends the PDF with this exact message as its caption. Delivery and read receipts remain in WhatsApp." : "Prepare WhatsApp + PDF saves the invoice and opens this exact message as an unsent draft. Attach the saved PDF and check the recipient before sending."}
        </p>}
        {channel === "whatsapp" && !pairedSend && <div className="rounded-md bg-muted p-3 text-xs leading-relaxed">
          <p className="font-medium">Send the PDF as an attachment</p>
          <p className="mt-1">{nativeShare
            ? "Choose Share PDF, then WhatsApp and the recipient in your device's share sheet. The phone field above applies to text drafts and paired sending."
            : "Choose Prepare WhatsApp + PDF, then Attach → Document and select the saved invoice. On Windows, the chat opens in Filey's browser."}</p>
          <p className="mt-2">{computerSupported ? "For automatic sending, use Filey AI above or pair WhatsApp in Integrations → WhatsApp (QR)." : "The Windows app supports automatic sending with Filey AI or a paired WhatsApp connection."}</p>
          <a className="inline-block underline mt-2" href="#/integrations?tab=free" onClick={onClose}>WhatsApp setup</a>
        </div>}
        {(accepted || computerAttempted) && <p className="help">This version already has a send attempt. <a className="underline" href="#/comms" onClick={onClose}>Review message history in Comms</a> before sending another copy.</p>}
        {error && <ErrorBanner message={error} />}
        {notice && <p role="status" className="text-[13px] rounded-md bg-muted px-3 py-2">{notice}</p>}
        {savedPath && <div className="text-xs leading-relaxed"><p className="font-medium">Saved PDF</p><p className="mt-1 break-all select-all text-muted-foreground">{savedPath}</p></div>}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <button className={channel === "sms" && !nativeShare ? "btn-primary" : "btn-ghost"} disabled={busy || stale || !file} onClick={() => void run(async () => {
            const saved = await savePdf();
            setNotice(hasDesktop ? (saved.path ? "PDF saved. Attach it in your messaging app." : "Save cancelled.") : "PDF downloaded. Attach it in your messaging app.");
          })}><Download size={14} /> Download PDF</button>
          {nativeShare && <button className={pairedSend ? "btn-ghost" : "btn-primary"} disabled={busy || stale} onClick={() => void run(async () => {
            await navigator.share({ files: [file!], title, text: body });
            assertCurrent();
            setNotice("PDF handed to the selected app. Check that app for delivery.");
            remember("handed_off", "Chosen in share sheet");
          })}><Share2 size={14} /> Share PDF</button>}
          <button className="btn-ghost" disabled={busy || stale || !message.trim()} onClick={() => void run(async () => {
            await openMessageDraft(channel, phone, body, context());
            assertCurrent();
            setNotice("Text draft opened. To include the PDF, attach the downloaded invoice in your messaging app.");
            remember("draft");
          })}><MessageCircle size={14} /> {channel === "sms" ? "Open SMS draft" : "Open WhatsApp text draft"}</button>
          {channel === "whatsapp" && !pairedSend && <button className={nativeShare ? "btn-ghost" : "btn-primary"} disabled={busy || stale || !file} onClick={() => void run(async () => {
            const draft = await prepareWhatsAppDocument({ file: file!, phone, text: body, ...context() });
            assertCurrent();
            setSavedPath(draft.path ?? "");
            if (draft.error) setError(draft.error);
            setNotice(draft.draftOpened ? "PDF saved and WhatsApp draft opened. Nothing sent. Attach the PDF, review the recipient and message, then send in WhatsApp." : "PDF saved. The WhatsApp draft could not be opened; nothing was sent.");
            if (draft.draftOpened) remember("draft");
          })}><MessageCircle size={14} /> Prepare WhatsApp + PDF</button>}
          {pairedSend && <button className={computerSupported ? "btn-ghost" : "btn-primary"} disabled={!historyReady || busy || stale || !file || accepted || computerAttempted} onClick={() => void run(async () => {
            const recipient = internationalPhone(phone);
            if ((await bridgeState()).state !== "connected") throw new Error("WhatsApp disconnected. Reconnect in Integrations or open a draft instead.");
            assertCurrent();
            const saved = await savePdf();
            if (!saved.path) throw new Error("Save the PDF before sending it.");
            try { await sendPairedDocument({documentKey:historyKey,version,file:file!,recipient,text:body,path:saved.path},scope ?? "signed-out"); }
            catch (e) { if (agentStorageScope() === scope) remember("unknown", recipient); throw e; }
            assertCurrent();
            remember("accepted", recipient);
            setNotice("WhatsApp accepted the PDF attachment and message. Check WhatsApp for delivered or read status; Filey has no delivery receipt yet.");
          })}><Send size={14} /> {accepted ? "PDF accepted by WhatsApp" : "Send PDF via paired WhatsApp"}</button>}
        </div>
        {!!history.length && <section aria-label="Recent invoice sharing" className="border-t border-border pt-4"><h3 className="text-sm font-medium">Recent sharing on this device</h3><p className="help">A draft or handoff is not a delivery receipt. Check WhatsApp or your messaging app before retrying an uncertain send.</p><ul className="divide-y divide-border">{history.map((entry,index) => <li key={`${entry.at}:${index}`} className="py-2 text-xs"><span className="font-medium">{({ draft: "Draft opened · not sent", handed_off: "Handed to sharing app", accepted: "Accepted by WhatsApp", observed_sent: "Sent bubble observed in WhatsApp", unknown: "Outcome unknown · check WhatsApp" } as const)[entry.document!.outcome]}</span><p className="mt-1 text-muted-foreground">{entry.from} · {entry.document!.channel === "sms" ? "Messages / SMS" : "WhatsApp"} · {new Date(entry.at).toLocaleString()}</p></li>)}</ul></section>}
      </div>
    </Modal>
  );
}
