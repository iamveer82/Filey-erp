// Instagram automation — shared pure logic (no env, no fetch, no DB).
//
// Everything here is deterministic and unit-tested in instagram-core_test.ts.
// The edge functions wire these helpers to Supabase + graph.instagram.com.

// ── Signature verification ───────────────────────────────────────────────────
// Meta signs every webhook POST as X-Hub-Signature-256: sha256=<hmac-hex>.
export async function verifyHubSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;
  const match = /^sha256=([0-9a-f]{64})$/.exec(signatureHeader.trim().toLowerCase());
  if (!match) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return timingSafeEqualHex(match[1], expected);
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return toHex(new Uint8Array(sig));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison for equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Webhook payload parsing ──────────────────────────────────────────────────
// Two wire shapes exist in the wild:
//   A) Business Login for Instagram ("Instagram API with Instagram Login"):
//      entry.field / entry.value at the top level (comment events)
//      entry.messaging[] for messaging events
//   B) Unified Login / Facebook Login for Business:
//      entry.changes[] = [{ field, value }]
// We normalize both into the same structures.

export interface CommentEvent {
  kind: "comment" | "live_comment";
  /** entry.id — the professional account that owns the comment. */
  ownerId: string;
  commentId: string;
  fromId: string;
  username: string;
  text: string;
  mediaId: string;
  mediaProductType: string; // feed | reels | story | ad | video
}

export interface MessagingEvent {
  kind: "message" | "postback" | "echo" | "other";
  ownerId: string;
  senderId: string;
  mid: string;
  text: string;
  /** Story the person replied to (story reply door), when present. */
  replyToStoryId: string | null;
  replyToStoryUrl: string | null;
  /** Attachment type story_mention, when a story mention arrives as a message. */
  storyMention: boolean;
  postbackPayload: string | null;
  postbackTitle: string | null;
  /** True when this exact message was sent by the account itself. */
  isSelf: boolean;
}

export interface ParsedWebhook {
  comments: CommentEvent[];
  messaging: MessagingEvent[];
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function normalizeCommentValue(
  ownerId: string,
  field: string,
  value: unknown
): CommentEvent | null {
  const v = asRecord(value);
  if (!v) return null;
  const from = asRecord(v.from);
  // Comment events arrive with the comment id in `id` (Business Login) or
  // `comment_id` (Unified Login).
  const commentId = asString(v.id) || asString(v.comment_id);
  if (!commentId) return null;
  const media = asRecord(v.media);
  const kind = field === "live_comments" ? "live_comment" : "comment";
  return {
    kind,
    ownerId,
    commentId,
    fromId: asString(from?.id),
    username: asString(from?.username),
    text: asString(v.text),
    mediaId: asString(media?.id),
    mediaProductType: asString(media?.media_product_type).toLowerCase(),
  };
}

function normalizeMessaging(ownerId: string, item: unknown): MessagingEvent | null {
  const m = asRecord(item);
  if (!m) return null;
  const sender = asRecord(m.sender);
  const senderId = asString(sender?.id);
  if (!senderId) return null;
  const mid = asString(asRecord(m.message)?.mid) || asString(asRecord(m.postback)?.mid) || "";
  const base: Omit<MessagingEvent, "kind"> = {
    ownerId,
    senderId,
    mid,
    text: "",
    replyToStoryId: null,
    replyToStoryUrl: null,
    storyMention: false,
    postbackPayload: null,
    postbackTitle: null,
    isSelf: false,
  };
  if (m.postback) {
    const p = asRecord(m.postback);
    return { ...base, mid, kind: "postback", postbackPayload: asString(p?.payload), postbackTitle: asString(p?.title) };
  }
  const msg = asRecord(m.message);
  if (!msg) {
    // messaging_seen, referrals, replies-to-replies we don't act on.
    return { ...base, kind: "other" };
  }
  if (msg.is_echo === true || msg.is_self === true) {
    return { ...base, kind: "echo", mid: asString(msg.mid), isSelf: true };
  }
  const replyTo = asRecord(msg.reply_to);
  const story = replyTo ? asRecord(replyTo.story) : null;
  const attachments = asArray(msg.attachments);
  const storyMention = attachments.some((a) => {
    const t = asString(asRecord(a)?.type);
    return t === "story_mention";
  });
  return {
    ...base,
    kind: "message",
    mid: asString(msg.mid),
    text: asString(msg.text),
    replyToStoryId: story ? asString(story.id) : null,
    replyToStoryUrl: story ? asString(story.url) : null,
    storyMention,
  };
}

export function parseWebhookBody(body: unknown): ParsedWebhook {
  const out: ParsedWebhook = { comments: [], messaging: [] };
  if (!body || typeof body !== "object") return out;
  for (const entryRaw of asArray((body as Record<string, unknown>).entry)) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;
    const ownerId = asString(entry.id);
    if (!ownerId) continue;
    // Shape A: entry.field / entry.value (Business Login for Instagram)
    const directField = asString(entry.field);
    if (directField === "comments" || directField === "live_comments") {
      const ev = normalizeCommentValue(ownerId, directField, entry.value);
      if (ev) out.comments.push(ev);
    }
    // Shape B: entry.changes[] (Unified Login / Facebook Login for Business)
    for (const changeRaw of asArray(entry.changes)) {
      const change = asRecord(changeRaw);
      const field = change ? asString(change.field) : "";
      if (field === "comments" || field === "live_comments") {
        const ev = normalizeCommentValue(ownerId, field, change!.value);
        if (ev) out.comments.push(ev);
      }
    }
    for (const itemRaw of asArray(entry.messaging)) {
      const ev = normalizeMessaging(ownerId, itemRaw);
      if (ev) out.messaging.push(ev);
    }
  }
  return out;
}

// ── Keyword matching ─────────────────────────────────────────────────────────
export type MatchMode = "exact" | "word" | "contains";

const WORD_SPLIT = /[^\p{L}\p{N}_']+/u;

export function normalizeKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const item of input) {
    const word = String(item ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (word) seen.add(word.slice(0, 60));
    if (seen.size >= 50) break;
  }
  return [...seen];
}

function wordsOf(text: string): string[] {
  return text.trim().toLowerCase().split(WORD_SPLIT).filter(Boolean);
}

/** Bounded Levenshtein for typo tolerance. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > 2) return 3;
  let prev = Array.from({ length: bl + 1 }, (_, j) => j);
  let cur = new Array<number>(bl + 1);
  for (let i = 1; i <= al; i++) {
    cur[0] = i;
    for (let j = 1; j <= bl; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[bl];
}

function fuzzyThreshold(keyword: string): number {
  const len = keyword.length;
  if (len < 4) return 0;      // too short to fuzz
  if (len <= 7) return 1;
  return 2;
}

/** True when `text` matches any keyword under `mode`, after exclusions.
 *  Empty keyword list matches anything (the caller decides if that's legal). */
export function matchesKeywords(
  text: string,
  keywords: string[],
  excludeKeywords: string[],
  mode: MatchMode,
  typoTolerance = false
): boolean {
  const hay = (text ?? "").trim().toLowerCase();
  const excluded = normalizeKeywords(excludeKeywords);
  if (matchesAny(hay, excluded, "word", false)) return false;
  const kws = normalizeKeywords(keywords);
  if (kws.length === 0) return true;
  return matchesAny(hay, kws, mode, typoTolerance);
}

function matchesAny(hay: string, kws: string[], mode: MatchMode, typoTolerance: boolean): boolean {
  if (kws.length === 0) return false;
  if (mode === "contains") return kws.some((k) => hay.includes(k));
  if (mode === "exact") return kws.some((k) => hay === k);
  // word
  const words = wordsOf(hay);
  if (kws.some((k) => words.includes(k))) return true;
  if (!typoTolerance) return false;
  return kws.some((k) => {
    const t = fuzzyThreshold(k);
    if (t === 0) return false;
    return words.some((w) => Math.abs(w.length - k.length) <= t && editDistance(w, k) <= t);
  });
}

// ── Merge tags / variations ──────────────────────────────────────────────────
export interface Persona {
  first_name?: string;
  username?: string;
  name?: string;
}

const TAG = /\{\{\s*(first_name|username|name)\s*\}\}/gi;

export function applyMergeTags(template: string, persona: Persona): string {
  const out = (template ?? "").replace(TAG, (_all, raw: string) => {
    const key = raw.toLowerCase() as "first_name" | "username" | "name";
    return (persona[key] ?? "").trim();
  });
  // Drop any space left dangling before a blank merge — Zernio parity.
  return out.replace(/[ \t]+([,.!?;:\n]|$)/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

export function pickVariation(
  variations: string[] | null | undefined,
  rng: () => number = Math.random
): string | null {
  const list = (variations ?? []).filter((v) => typeof v === "string" && v.trim());
  if (!list.length) return null;
  return list[Math.floor(rng() * list.length)] ?? list[list.length - 1];
}

/** The DM body for one send: base message, rotated variation, merge tags applied. */
export function composeDmBody(
  automation: { dm_message: string; dm_message_variations?: string[] | null },
  persona: Persona,
  rng: () => number = Math.random
): string {
  const variant = pickVariation(automation.dm_message_variations, rng);
  return applyMergeTags(variant ?? automation.dm_message, persona);
}

export function composePublicReply(
  automation: { comment_reply?: string | null; comment_reply_variations?: string[] | null },
  persona: Persona,
  rng: () => number = Math.random
): string | null {
  const variant = pickVariation(automation.comment_reply_variations, rng);
  const base = variant ?? (automation.comment_reply ?? "").trim();
  if (!base) return null;
  return applyMergeTags(base, persona);
}

// ── Automation validation (create & update share this) ───────────────────────
export interface AutomationInput {
  name: string;
  trigger_type: "comment" | "live_comment" | "story_reply" | "story_mention";
  keywords: string[];
  exclude_keywords: string[];
  match_mode: MatchMode;
  typo_tolerance: boolean;
  platform_post_id: string | null;
  dm_message: string;
  dm_message_variations: string[];
  buttons: { title: string; url: string }[];
  dm_delay_seconds: number;
  comment_reply: string | null;
  comment_reply_variations: string[];
  comment_reply_delay_seconds: number;
  public_reply_policy: "after_dm" | "always";
  follow_gate: boolean;
  also_match_in_dms: boolean;
  repeat_mode: "once" | "every_comment";
  cooldown_hours: number | null;
  dedupe_same_text_hours: number | null;
  is_active: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v.trim() : fallback;
const boundedInt = (
  v: unknown,
  min: number,
  max: number,
  fallback: number
): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
};
const strArray = (v: unknown, max: number, maxLen: number): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s.slice(0, maxLen));
    if (out.length >= max) break;
  }
  return out;
};

export type ValidationResult =
  | { ok: true; value: AutomationInput }
  | { ok: false; errors: string[] };

export function validateAutomationInput(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["The request body must be an object."] };
  const input = raw;

  const name = str(input.name);
  if (!name || name.length > 120) errors.push("Give the automation a name (1–120 characters).");

  const trigger = str(input.trigger_type);
  if (!["comment", "live_comment", "story_reply", "story_mention"].includes(trigger))
    errors.push("Choose a trigger: comment, live_comment, story_reply or story_mention.");

  const mode = str(input.match_mode, "word");
  if (!["exact", "word", "contains"].includes(mode))
    errors.push("Match mode must be exact, word or contains.");

  const dm = str(input.dm_message);
  if (!dm || dm.length > 1000)
    errors.push("The DM message is required and must be at most 1000 characters.");

  const keywords = normalizeKeywords(input.keywords);
  const excludeKeywords = normalizeKeywords(input.exclude_keywords);
  const storyMention = trigger === "story_mention";
  if (!storyMention && input.also_match_in_dms && keywords.length === 0)
    errors.push("\u201cAlso fire on inbound DMs\u201d needs at least one keyword.");

  const postId = str(input.platform_post_id);
  if (postId && !/^\d{5,25}$/.test(postId))
    errors.push("The post id must be the numeric Instagram media id.");

  const dmVariations = strArray(input.dm_message_variations, 5, 1000)
    .filter((v) => v);
  for (const v of dmVariations)
    if (v.length > 1000) errors.push("DM variations must be at most 1000 characters.");

  const replyVariations = strArray(input.comment_reply_variations, 5, 1000);

  const buttons: { title: string; url: string }[] = [];
  if (Array.isArray(input.buttons)) {
    for (const rawBtn of input.buttons.slice(0, 4)) {
      if (!isRecord(rawBtn)) continue;
      const title = str(rawBtn.title);
      const url = str(rawBtn.url);
      // Meta's Instagram button title limit is 20 characters.
      if (!title || title.length > 20)
        errors.push("Each button needs a title of at most 20 characters.");
      else if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url) || url.length > 500 || /[<>"'`]/.test(url))
        errors.push(`Button \u201c${title}\u201d needs a full http(s) URL.`);
      else if (buttons.length < 3) buttons.push({ title: title.slice(0, 20), url });
    }
  }
  if (Array.isArray(input.buttons) && input.buttons.length > 3)
    errors.push("At most 3 buttons in one DM.");
  // With buttons, Meta's button template caps the text at 640 chars.
  if (buttons.length > 0 && dm.length > 640)
    errors.push("With buttons, the DM message must be at most 640 characters.");

  const commentReply = str(input.comment_reply) || null;
  if (commentReply && commentReply.length > 1000)
    errors.push("The public reply must be at most 1000 characters.");

  const policy = str(input.public_reply_policy, "after_dm");
  if (!["after_dm", "always"].includes(policy))
    errors.push("public_reply_policy must be after_dm or always.");

  const repeat = str(input.repeat_mode, "once");
  if (!["once", "every_comment"].includes(repeat))
    errors.push("repeat_mode must be once or every_comment.");

  // Delays need a queue that doesn't exist yet — reject rather than silently drop.
  if (Number(input.dm_delay_seconds ?? 0) !== 0 || Number(input.comment_reply_delay_seconds ?? 0) !== 0)
    errors.push("Delayed sends aren't supported yet — the DM and the public reply go out instantly.");

  const cooldown = input.cooldown_hours == null ? null : boundedInt(input.cooldown_hours, 1, 720, 24);
  const dedupe = input.dedupe_same_text_hours == null ? null : boundedInt(input.dedupe_same_text_hours, 0, 720, 24);
  if (repeat === "every_comment" && cooldown != null && cooldown < 1)
    errors.push("Cooldown must be at least 1 hour.");

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      trigger_type: trigger as AutomationInput["trigger_type"],
      keywords,
      exclude_keywords: excludeKeywords,
      match_mode: mode as MatchMode,
      typo_tolerance: input.typo_tolerance === true,
      platform_post_id: postId || null,
      dm_message: dm,
      dm_message_variations: dmVariations,
      buttons,
      dm_delay_seconds: boundedInt(input.dm_delay_seconds, 0, 86400, 0),
      comment_reply: commentReply,
      comment_reply_variations: replyVariations,
      comment_reply_delay_seconds: boundedInt(input.comment_reply_delay_seconds, 0, 86400, 0),
      public_reply_policy: policy as AutomationInput["public_reply_policy"],
      follow_gate: input.follow_gate === true,
      also_match_in_dms: input.also_match_in_dms === true,
      repeat_mode: repeat as AutomationInput["repeat_mode"],
      cooldown_hours: repeat === "every_comment" ? cooldown : null,
      dedupe_same_text_hours: dedupe,
      is_active: input.is_active !== false,
    },
  };
}

/** Hex sha256 of a string (used for same-text dedupe). */
export async function sha256Hex(input: string): Promise<string> {
  const sig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Public tracked-link URL for a button. */
export function buildTrackedUrl(base: string, linkId: string): string {
  const url = new URL(base);
  url.searchParams.set("id", linkId);
  return url.toString();
}

// ── Follow-gate payload ──────────────────────────────────────────────────────
export const FOLLOW_GATE_PREFIX = "filey_follow_gate:";

export function followGatePayload(automationId: string): string {
  return `${FOLLOW_GATE_PREFIX}${automationId}`;
}

export function parseFollowGatePayload(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const trimmed = payload.trim();
  return trimmed.startsWith(FOLLOW_GATE_PREFIX) ? trimmed.slice(FOLLOW_GATE_PREFIX.length) : null;
}
