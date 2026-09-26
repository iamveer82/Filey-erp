import { localClient, withLocalTransaction } from "./localdb";
import { requireAgentStorageScope } from "./agentStorage";

export const OUTBOX_EVENT = "filey:message-outbox";
const TABLE = "message_outbox"; // Device-only; never pushed as business data.
export type MessageOutcome = "sending" | "accepted" | "observed_sent" | "unknown" | "not_sent";
export interface MessageJob {
  id: string;
  scope: string;
  documentKey: string;
  version: string;
  fileHash: string;
  filename: string;
  recipient: string;
  channel: "whatsapp";
  method: "paired" | "computer";
  text: string;
  at: string;
  outcome: MessageOutcome;
  providerId?: string;
  reviewedAt?: string;
}

// Pairing and duplicate protection belong to the account/org across storage modes.
const owner = (expected?: string) => requireAgentStorageScope(expected).replace(/^(local|cloud):/, "");
const changed = () => window.dispatchEvent(new Event(OUTBOX_EVENT));
/** A status update after sending must not turn a retry into a new document. */
export async function invoiceMessageVersion(invoice: object): Promise<string> {
  const {status: _status, updated_at: _updated, created_at: _created, ...content} = invoice as Record<string,unknown>;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) :
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)])) : value;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(content))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
}
export async function messageJobs(expectedScope?: string): Promise<MessageJob[]> {
  const scope = owner(expectedScope);
  const {data, error} = await localClient.from(TABLE).select("*").eq("scope", scope).order("at", {ascending:false});
  if (error) throw error;
  if (owner(expectedScope) !== scope) throw new Error("Workspace changed while loading message history.");
  return data as MessageJob[];
}

export const blocksMessage = (job: MessageJob) => job.outcome !== "not_sent";
export const canReviewMessage = (job: MessageJob) => job.outcome === "unknown" ||
  (job.outcome === "sending" && Date.now() - Date.parse(job.at) > 360_000);

export async function beginMessage(input: Pick<MessageJob,"documentKey"|"version"|"filename"|"recipient"|"text"|"method"> & {file: File}, expectedScope: string): Promise<MessageJob> {
  const scope = owner(expectedScope);
  if (!input.documentKey || !input.version || !/^\+[1-9]\d{6,14}$/.test(input.recipient)) throw new Error("A document version and international recipient are required.");
  const hash = await crypto.subtle.digest("SHA-256", await input.file.arrayBuffer());
  const {documentKey,version,filename,recipient,text,method} = input;
  const details = {documentKey,version,filename,recipient,text,method};
  const job: MessageJob = {...details, id:crypto.randomUUID(), scope, channel:"whatsapp", at:new Date().toISOString(), outcome:"sending",
    fileHash:Array.from(new Uint8Array(hash), byte=>byte.toString(16).padStart(2,"0")).join("")};
  await withLocalTransaction(async client => {
    if (owner(expectedScope) !== scope) throw new Error("Workspace changed before sending.");
    const previous = await client.from(TABLE).select("*").eq("scope", scope).eq("documentKey", job.documentKey).eq("version", job.version).eq("recipient", job.recipient);
    if (previous.error) throw previous.error;
    if (previous.data.some(blocksMessage)) throw new Error("This invoice already has a send attempt. Check WhatsApp and review it in Comms before sending another copy.");
    const saved = await client.from(TABLE).insert(job);
    if (saved.error) throw saved.error;
  });
  changed();
  return job;
}

/** Completes only the captured job's scope, including after its dialog closes. */
export async function finishMessage(job: MessageJob, outcome: Exclude<MessageOutcome,"sending">, providerId?: string): Promise<void> {
  if (outcome === "accepted" && !providerId) throw new Error("WhatsApp returned no message ID. Check the chat before retrying.");
  const result = await localClient.from(TABLE).update({outcome, providerId}).eq("id",job.id).eq("scope",job.scope).select("id");
  if (result.error) throw result.error;
  if (result.data?.length !== 1) throw new Error("Message history could not be updated. Check WhatsApp before retrying.");
  changed();
}

export async function sendPairedDocument(input: Pick<MessageJob,"documentKey"|"version"|"recipient"|"text"> & {file:File;path:string}, expectedScope:string): Promise<string> {
  const job = await beginMessage({...input,filename:input.file.name,method:"paired"},expectedScope);
  try {
    requireAgentStorageScope(expectedScope);
    const {sendWaFile} = await import("./waBridge");
    requireAgentStorageScope(expectedScope);
    const providerId = await sendWaFile(`${input.recipient.slice(1)}@s.whatsapp.net`,{path:input.path,filename:input.file.name,mimetype:"application/pdf",caption:input.text});
    await finishMessage(job,"accepted",providerId);
    return providerId;
  } catch(error) {
    await finishMessage(job,"unknown");
    throw error;
  }
}

export async function reviewMessageNotSent(job: MessageJob, expectedScope: string): Promise<void> {
  await withLocalTransaction(async client => {
    if (owner(expectedScope) !== job.scope) throw new Error("Workspace changed before reviewing this message.");
    const current = await client.from(TABLE).select("*").eq("id",job.id).eq("scope",job.scope).single();
    if (current.error) throw current.error;
    if (!current.data || !canReviewMessage(current.data)) throw new Error("Only an uncertain or interrupted send can be marked as not sent.");
    const result = await client.from(TABLE).update({outcome:"not_sent",reviewedAt:new Date().toISOString()}).eq("id",job.id).eq("scope",job.scope);
    if (result.error) throw result.error;
  });
  changed();
}
