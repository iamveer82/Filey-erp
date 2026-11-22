/* Live events from connected apps (Composio triggers).
 *
 * The owner turns on an event for an app they connected ("new Gmail message",
 * "new Typeform response"). Composio delivers it to Filey's `composio-webhook`
 * function, which stores it for this person; the app reads it back here. It
 * always runs on Filey's Composio connection: events reach Filey's webhook, so
 * a customer's own Composio key (another project) cannot receive them.
 *
 * Event data is whatever the other app sent. It is shown and handed to the
 * agent as data, never as instructions. */
import { platformCall } from "./integrations";
import { requireModuleAccess } from "./moduleAccess";
import { composioList } from "./composio";

export interface AppEventType {
  slug: string;
  name?: string;
  description?: string;
  instructions?: string;
  /** JSON schema of the settings this event needs (often none). */
  config?: { properties?: Record<string, ConfigField>; required?: string[] };
}

export interface ConfigField {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export interface AppEventOn {
  id: string;
  toolkit: string;
  trigger_slug: string;
  connected_account_id: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface AppEvent {
  id: number;
  toolkit: string;
  trigger_slug: string;
  data: unknown;
  received_at: string;
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  await requireModuleAccess("integrations");
  return platformCall<T>("composio", action, payload);
}

export async function appEventTypes(toolkit: string): Promise<AppEventType[]> {
  const res = await call<{ items?: AppEventType[] }>("trigger_types", { toolkit });
  return (res.items ?? []).filter((t) => typeof t.slug === "string");
}

export async function appEventsOn(): Promise<AppEventOn[]> {
  return (await call<{ items?: AppEventOn[] }>("trigger_list")).items ?? [];
}

/** The signed-in connection for an app, if there is one. */
export async function activeConnection(toolkit: string): Promise<string | null> {
  const list = await composioList();
  const hit = (list.items ?? []).find((c) => c.toolkit?.slug === toolkit && String(c.status ?? "").toUpperCase() === "ACTIVE");
  return hit?.id ?? null;
}

export async function turnOnAppEvent(toolkit: string, slug: string, config: Record<string, unknown> = {}): Promise<string> {
  const account = await activeConnection(toolkit);
  if (!account) throw new Error("Connect the app first, then turn on its events.");
  const res = await call<{ trigger_id?: string }>("trigger_enable", { slug, connected_account_id: account, config });
  if (!res.trigger_id) throw new Error("The app did not confirm the event. Refresh to check.");
  return res.trigger_id;
}

export async function turnOffAppEvent(triggerId: string): Promise<void> {
  await call("trigger_disable", { trigger_id: triggerId });
}

/** Newest first. `since` is the id of the newest event already seen. */
export async function recentAppEvents(opts: { since?: number; toolkit?: string; limit?: number } = {}): Promise<AppEvent[]> {
  const res = await call<{ items?: AppEvent[] }>("events", {
    since: opts.since ?? 0, limit: opts.limit ?? 50, ...(opts.toolkit ? { toolkit: opts.toolkit } : {}),
  });
  return res.items ?? [];
}

/** "GMAIL_NEW_GMAIL_MESSAGE" → "New gmail message" (the app's prefix dropped). */
export function eventName(slug: string, toolkit?: string): string {
  let words = slug.toLowerCase();
  if (toolkit && words.startsWith(`${toolkit.toLowerCase()}_`)) words = words.slice(toolkit.length + 1);
  words = words.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : slug;
}

const SUMMARY_FIELDS = ["subject", "title", "name", "from", "sender", "email", "message_text", "message", "text", "snippet", "preview", "status", "amount", "total"];

/** One line for lists, notifications and automations: the event's name and the
 *  fields people recognise, else the start of the raw data. */
export function describeAppEvent(event: Pick<AppEvent, "toolkit" | "trigger_slug" | "data">): string {
  const name = event.trigger_slug === "CONNECTION_EXPIRED" ? "Signed Filey out" : eventName(event.trigger_slug, event.toolkit);
  const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const parts: string[] = [];
  for (const field of SUMMARY_FIELDS) {
    const value = data[field];
    if (value == null || typeof value === "object") continue;
    const text = String(value).replace(/\s+/g, " ").trim();
    if (text) parts.push(`${field.replace(/_/g, " ")}: ${text.slice(0, 120)}`);
    if (parts.length >= 3) break;
  }
  const detail = parts.length ? parts.join(" · ") : JSON.stringify(event.data ?? {}).slice(0, 200);
  return `${event.toolkit}: ${name}${detail && detail !== "{}" ? ` (${detail})` : ""}`;
}
