import { useEffect, useRef, useState } from "react";
import { Download, FileText, Link2, Loader2, MessageCircle, Send, Share2 } from "lucide-react";
import { Modal, ErrorBanner } from "./ui";
import { cn, errMsg } from "../lib/format";
import { bridgeState, hasDesktop, onBridgeState, sendWaFile } from "../lib/waBridge";
import { internationalPhone, openMessageDraft, prepareWhatsAppDocument, saveDocumentPdf, type MessageChannel } from "../lib/documentMessage";
import { agentStorageScope, AGENT_STORAGE_EVENT, requireAgentStorageScope } from "../lib/agentStorage";

export interface DocumentMessageProps {
  title: string;
  phone: string;
  message: string;
  channel: MessageChannel;
  loadPdf: () => Promise<File>;
  createLink?: () => Promise<string>;
}

export default function DocumentMessageDialog({ title, phone: initialPhone, message: initialMessage, channel: initialChannel, loadPdf, createLink, onClose }: DocumentMessageProps & { onClose: () => void }) {
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
  const [acceptedRecipients, setAcceptedRecipients] = useState<Set<string>>(() => new Set());
  const [link, setLink] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [scope] = useState(agentStorageScope);
  const [stale, setStale] = useState(false);
  const busyRef = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const mounted = useRef(true);
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
      setStale(true); setFile(null); setLink(""); setSavedPath(""); setNotice("");
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
    setPdfError(""); setFile(null); setSavedPath(""); setAcceptedRecipients(new Set());
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
  let accepted = false;
  try { accepted = acceptedRecipients.has(internationalPhone(phone)); } catch { /* The input is still being edited. */ }
  const savePdf = async () => {
    if (!file) throw new Error("The invoice PDF is not ready.");
    const saved = await saveDocumentPdf(file, context());
    setSavedPath(saved.path ?? "");
    return saved;
  };

  return (
    <Modal open title={`Send ${title}`} onClose={() => { if (!busy) onClose(); }}>
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
        </div>
        {createLink && !link && <div>
          <button className="btn-ghost" disabled={busy || stale} onClick={() => void run(async () => { const value = await createLink(); assertCurrent(); setLink(value); })}><Link2 size={14} /> Add invoice link</button>
          <p className="help">Anyone with this link can view the invoice. Adding it enables public access.</p>
        </div>}
        {link && <div className="rounded-md bg-muted p-3 text-xs break-all"><span className="block font-medium mb-1">Invoice link included</span>{link}</div>}
        <p className="text-xs text-muted-foreground leading-relaxed">
          {channel === "sms"
            ? "SMS sends the message and any invoice link, without a PDF attachment. Use Share PDF to choose a supported messaging app. Carrier charges may apply."
            : pairedSend ? "Paired WhatsApp sends the PDF with this exact message as its caption. Delivery and read receipts remain in WhatsApp." : "Prepare WhatsApp + PDF saves the invoice and opens this exact message as an unsent draft. Attach the saved PDF and check the recipient before sending."}
        </p>
        {pairedSend && <p className="text-xs text-success">Use Send PDF via paired WhatsApp below to send this file to the entered number.</p>}
        {channel === "whatsapp" && !pairedSend && <div className="rounded-md bg-muted p-3 text-xs leading-relaxed">
          <p className="font-medium">Send the PDF as an attachment</p>
          <p className="mt-1">{nativeShare
            ? "Choose Share PDF, then WhatsApp and the recipient in your device's share sheet. The phone field above applies to text drafts and paired sending."
            : "Choose Prepare WhatsApp + PDF, then Attach → Document and select the saved invoice. On Windows, the chat opens in Filey's browser."}</p>
          <p className="mt-2">{hasDesktop ? "For direct attachment sending, connect WhatsApp in Integrations → WhatsApp (QR)." : "Direct attachment sending is available in the Filey desktop app after pairing WhatsApp in Integrations → WhatsApp (QR)."}</p>
          <a className="inline-block underline mt-2" href="#/integrations" onClick={onClose}>WhatsApp setup</a>
        </div>}
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
          })}><Share2 size={14} /> Share PDF</button>}
          <button className="btn-ghost" disabled={busy || stale || !message.trim()} onClick={() => void run(async () => {
            await openMessageDraft(channel, phone, body, context());
            assertCurrent();
            setNotice("Text draft opened. To include the PDF, attach the downloaded invoice in your messaging app.");
          })}><MessageCircle size={14} /> {channel === "sms" ? "Open SMS draft" : "Open WhatsApp text draft"}</button>
          {channel === "whatsapp" && !pairedSend && <button className={nativeShare ? "btn-ghost" : "btn-primary"} disabled={busy || stale || !file} onClick={() => void run(async () => {
            const draft = await prepareWhatsAppDocument({ file: file!, phone, text: body, ...context() });
            assertCurrent();
            setSavedPath(draft.path ?? "");
            if (draft.error) setError(draft.error);
            setNotice(draft.draftOpened ? "PDF saved and WhatsApp draft opened. Nothing sent. Attach the PDF, review the recipient and message, then send in WhatsApp." : "PDF saved. The WhatsApp draft could not be opened; nothing was sent.");
          })}><MessageCircle size={14} /> Prepare WhatsApp + PDF</button>}
          {pairedSend && <button className="btn-primary" disabled={busy || stale || !file || accepted} onClick={() => void run(async () => {
            const recipient = internationalPhone(phone);
            if ((await bridgeState()).state !== "connected") throw new Error("WhatsApp disconnected. Reconnect in Integrations or open a draft instead.");
            assertCurrent();
            const saved = await savePdf();
            if (!saved.path) throw new Error("Save the PDF before sending it.");
            await sendWaFile(`${recipient.slice(1)}@s.whatsapp.net`, { path: saved.path, filename: file!.name, mimetype: "application/pdf", caption: body });
            assertCurrent();
            setAcceptedRecipients((previous) => new Set(previous).add(recipient));
            setNotice("WhatsApp accepted the PDF attachment and message. Check WhatsApp for delivered or read status; Filey has no delivery receipt yet.");
          })}><Send size={14} /> {accepted ? "PDF accepted by WhatsApp" : "Send PDF via paired WhatsApp"}</button>}
        </div>
      </div>
    </Modal>
  );
}
