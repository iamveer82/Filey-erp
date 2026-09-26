import { billing } from "./api";
import { isLocalMode } from "./dataMode";
import { requireAgentStorageScope } from "./agentStorage";
import { deliverFile, type DeliveredFile } from "./agentFiles";

export type MessageChannel = "whatsapp" | "sms";

export function internationalPhone(value: string): string {
  const phone = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  if (!/^\+[1-9]\d{6,14}$/.test(phone))
    throw new Error("Enter an international phone number, including + and the country code.");
  return phone;
}

export function messageUrl(channel: MessageChannel, phone: string, text: string, ios = false): string {
  const recipient = internationalPhone(phone);
  const body = encodeURIComponent(text);
  return channel === "whatsapp"
    ? `https://wa.me/${recipient.slice(1)}?text=${body}`
    : `sms:${recipient}${ios ? "&" : "?"}body=${body}`;
}

/** A recipient cannot open a localhost/Tauri/device-only portal. */
export function publicAppBase(raw = import.meta.env.VITE_PUBLIC_APP_URL || `${location.origin}${location.pathname}`): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".") ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
      /^[\d.]+$/.test(host) || host.includes(":")) return null;
    url.hash = "";
    url.search = "";
    return url.href;
  } catch { return null; }
}

export async function invoicePublicLink(id: number): Promise<string> {
  const base = publicAppBase();
  if (isLocalMode() || !base)
    throw new Error("Public invoice links need a hosted cloud address. Share the PDF from this device instead.");
  const token = await billing.publicLink(id);
  return `${base}#/portal/${encodeURIComponent(token)}`;
}

export interface DocumentMessageContext { expectedScope: string; signal?: AbortSignal }

function assertCurrent(context: DocumentMessageContext): void {
  context.signal?.throwIfAborted();
  requireAgentStorageScope(context.expectedScope);
}

export interface MessageDraftLocation {
  surface: "filey_browser" | "external" | "sms";
  tabId?: string;
  windowId?: string;
}

/** Open a reviewed text draft. This never attaches a file or sends a message. */
export async function openMessageDraft(channel: MessageChannel, phone: string, text: string, context: DocumentMessageContext = { expectedScope: requireAgentStorageScope() }): Promise<MessageDraftLocation> {
  assertCurrent(context);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const url = messageUrl(channel, phone, text, ios);
  if ("__TAURI_INTERNALS__" in window) {
    if (channel === "whatsapp") {
      const { desktopBrowserSupported, desktopBrowserCommand } = await import("./desktopBrowser");
      assertCurrent(context);
      if (desktopBrowserSupported()) {
        const recipient = internationalPhone(phone).slice(1);
        const opened = await desktopBrowserCommand({ action: "open", url: `https://web.whatsapp.com/send?phone=${recipient}&text=${encodeURIComponent(text)}` }, context.signal);
        assertCurrent(context);
        return { surface: "filey_browser", tabId: opened.tab?.id, windowId: opened.tab?.window_id ?? undefined };
      }
    }
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    assertCurrent(context);
    await openUrl(url);
  } else if (channel === "whatsapp") {
    // An explicit opener check distinguishes a blocked popup from an opened draft.
    const opened = window.open("about:blank", "_blank");
    if (!opened) throw new Error("Your browser blocked WhatsApp. Allow popups for Filey and open the draft again.");
    opened.opener = null;
    opened.location.replace(url);
  } else {
    window.location.href = url;
  }
  assertCurrent(context);
  return { surface: channel === "sms" ? "sms" : "external" };
}

/** Validate the actual bytes before a local file is offered for attachment. */
export async function saveDocumentPdf(file: File, context: DocumentMessageContext): Promise<DeliveredFile> {
  assertCurrent(context);
  if (!file || !/\.pdf$/i.test(file.name) || /[\\/]/.test(file.name) || [...file.name].some((character) => character.charCodeAt(0) < 32))
    throw new Error("Choose a PDF with a valid file name.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertCurrent(context);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
    throw new Error("The invoice export is not a valid PDF. Generate it again before sharing.");
  const saved = await deliverFile({ name: file.name, bytes });
  assertCurrent(context);
  if ("__TAURI_INTERNALS__" in window && !saved.path)
    throw new Error("PDF save cancelled. Nothing was sent or opened.");
  return saved;
}

export interface WhatsAppDocumentDraft {
  status: "draft";
  sent: false;
  path?: string;
  filename: string;
  phone: string;
  text: string;
  attachmentRequired: true;
  draftOpened: boolean;
  surface?: MessageDraftLocation["surface"];
  tabId?: string;
  windowId?: string;
  error?: string;
}

/** A no-key handoff for the dialog and Filey AI. Saving/opening is explicitly
 * separate from attaching and sending; a URL cannot contain a PDF attachment. */
export async function prepareWhatsAppDocument(input: {
  file: File;
  phone: string;
  text: string;
  expectedScope: string;
  signal?: AbortSignal;
}): Promise<WhatsAppDocumentDraft> {
  assertCurrent(input);
  const phone = internationalPhone(input.phone);
  const saved = await saveDocumentPdf(input.file, input);
  const draft: WhatsAppDocumentDraft = {
    status: "draft", sent: false, path: saved.path, filename: input.file.name,
    phone, text: input.text, attachmentRequired: true, draftOpened: false,
  };
  try {
    const location = await openMessageDraft("whatsapp", phone, input.text, input);
    return { ...draft, ...location, draftOpened: true };
  } catch (error) {
    assertCurrent(input);
    if ((error as Error)?.name === "AbortError") throw error;
    return { ...draft, error: error instanceof Error ? error.message : String(error) };
  }
}
