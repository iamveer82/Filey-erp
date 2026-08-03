// Zernio — social posting and scheduling across 16 platforms and 7 ad networks
// through one REST API (https://docs.zernio.com).
//
// This is the outbound counterpart to lib/campaigns: campaigns reach customers
// you already have by email, this publishes to an audience. Both are marketing,
// but the risk profile is different — a social post is public and effectively
// permanent, so every write here is gated behind the agent's confirm step and
// nothing posts without an explicit action.
//
// The API key is a credential for the user's own connected accounts. It lives
// in device-local storage exactly like the AI model key and the Jina key, and
// is never synced, never committed, and never sent anywhere but zernio.com.

import { aiFetch } from "./ai";

const STORE_KEY = "filey_zernio_config";
const BASE = "https://zernio.com/api/v1";

export interface ZernioConfig {
  apiKey: string;
  enabled: boolean;
  /** Default profile to post from when a call doesn't name one. */
  profileId?: string;
}

const DEFAULTS: ZernioConfig = { apiKey: "", enabled: false };

export function getZernioConfig(): ZernioConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ZernioConfig>) };
  } catch {
    console.error("Failed to parse Zernio config from localStorage");
    return { ...DEFAULTS };
  }
}

export function setZernioConfig(patch: Partial<ZernioConfig>): ZernioConfig {
  const next = { ...getZernioConfig(), ...patch };
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  return next;
}

export function zernioReady(cfg: ZernioConfig = getZernioConfig()): boolean {
  return cfg.enabled && !!cfg.apiKey.trim();
}

export class ZernioError extends Error {}

async function call<T>(
  path: string,
  init: RequestInit = {},
  cfg: ZernioConfig = getZernioConfig()
): Promise<T> {
  if (!zernioReady(cfg))
    throw new ZernioError(
      "Social publishing is off. Add your Zernio key in Integrations → Social publishing."
    );
  const res = await aiFetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.apiKey.trim()}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string>),
    },
  });
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ZernioError(
      `Zernio returned something that isn't JSON: ${text.slice(0, 200)}`
    );
  }
}

export interface ZernioAccount {
  id: string;
  platform: string;
  /** Handle or page name as shown on the platform. */
  username?: string;
  displayName?: string;
  profileId?: string;
  status?: string;
}

export interface ZernioProfile {
  id: string;
  name: string;
}

export interface ZernioPost {
  id: string;
  status: string;
  content?: string;
  scheduledAt?: string;
  publishedAt?: string;
  accountIds?: string[];
  error?: string;
}

/** The accounts the user has connected. Read-only, safe to call on load. */
export async function listAccounts(profileId?: string): Promise<ZernioAccount[]> {
  const q = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const data = await call<{ accounts?: ZernioAccount[] } | ZernioAccount[]>(
    `/accounts${q}`
  );
  return Array.isArray(data) ? data : (data.accounts ?? []);
}

export async function listProfiles(): Promise<ZernioProfile[]> {
  const data = await call<{ profiles?: ZernioProfile[] } | ZernioProfile[]>("/profiles");
  return Array.isArray(data) ? data : (data.profiles ?? []);
}

export async function listPosts(limit = 20): Promise<ZernioPost[]> {
  const data = await call<{ posts?: ZernioPost[] } | ZernioPost[]>(
    `/posts?limit=${Math.max(1, Math.min(100, limit))}`
  );
  return Array.isArray(data) ? data : (data.posts ?? []);
}

/** Quota and spend, so the UI can show what a plan has left. */
export async function usageStats(): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("/usage-stats");
}

export interface CreatePostInput {
  /** Which connected accounts to publish to. At least one. */
  accountIds: string[];
  content: string;
  /** Publicly reachable media URLs. Upload via presignMedia first if local. */
  mediaUrls?: string[];
  /** ISO 8601. Omit to publish immediately. */
  scheduledAt?: string;
}

/**
 * Create or schedule a post.
 *
 * Deliberately not wrapped in any "post to everything" convenience: the caller
 * names the accounts. A social post is public and effectively permanent, and an
 * accidental broadcast is not something an undo button fixes.
 */
export async function createPost(input: CreatePostInput): Promise<ZernioPost> {
  if (!input.accountIds?.length)
    throw new ZernioError("Pick at least one account to post to.");
  if (!input.content.trim() && !input.mediaUrls?.length)
    throw new ZernioError("A post needs text or media.");
  return call<ZernioPost>("/posts", {
    method: "POST",
    body: JSON.stringify({
      accountIds: input.accountIds,
      content: input.content,
      ...(input.mediaUrls?.length ? { mediaUrls: input.mediaUrls } : {}),
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
    }),
  });
}

/** Delete a post that hasn't gone out yet. Published posts are not deletable
 *  through the API — that is the platform's business, not ours. */
export async function deletePost(postId: string): Promise<void> {
  await call<void>(`/posts/${encodeURIComponent(postId)}`, { method: "DELETE" });
}

/** Per-platform caption limits, so a post can be checked before it is sent
 *  rather than failing at the platform. Conservative where a platform varies by
 *  account tier — better to warn early than to have a caption silently cut. */
export const PLATFORM_LIMITS: Record<string, number> = {
  twitter: 280,
  x: 280,
  bluesky: 300,
  mastodon: 500,
  threads: 500,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  pinterest: 500,
  reddit: 40000,
  tiktok: 2200,
  youtube: 5000,
  telegram: 4096,
  discord: 2000,
  whatsapp: 4096,
  google_business: 1500,
};

/** Which of the chosen accounts a caption is too long for. */
export function overLimit(
  content: string,
  accounts: Pick<ZernioAccount, "id" | "platform">[]
): { platform: string; limit: number; over: number }[] {
  const len = content.trim().length;
  const seen = new Set<string>();
  const out: { platform: string; limit: number; over: number }[] = [];
  for (const a of accounts) {
    const key = (a.platform || "").toLowerCase();
    const limit = PLATFORM_LIMITS[key];
    if (!limit || seen.has(key)) continue;
    seen.add(key);
    if (len > limit) out.push({ platform: key, limit, over: len - limit });
  }
  return out;
}
