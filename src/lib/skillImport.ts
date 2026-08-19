/* Importing a skill from a repo or a URL.
 *
 * A skill is instructions, not code — so "install a skill from GitHub" is a
 * fetch and a parse, with no execution and no dependency to audit. That is the
 * whole reason this is safe enough to offer: the worst an imported file can do
 * is describe a procedure badly. It cannot reach a tool the owner has not
 * already enabled, because the gates live in runTool rather than in the prompt.
 *
 * The fetching is left to the caller so everything here stays pure and testable
 * without a network.
 */

/** A skill file, as found in a repo. */
export interface ParsedSkill {
  name: string;
  description: string;
  instructions: string;
}

/** The file names a skill is conventionally kept under, best first. */
const CANDIDATES = ["SKILL.md", "AGENTS.md", "AGENT.md", "README.md"];
const BRANCHES = ["main", "master"];

/** github.com/owner/repo → the raw URLs worth trying, in order.
 *
 * Accepts the forms people actually paste: a bare `owner/repo`, a repo page, a
 * `/blob/` link to one file, and a raw URL already. A `/blob/` or raw link is
 * taken literally — the user pointed at a specific file and guessing past it
 * would be rude. */
export function skillSourceUrls(ref: string): string[] {
  const s = ref.trim();
  if (!s) return [];

  // Already raw, or some other host entirely: use it as given.
  if (/^https?:\/\//i.test(s) && !/^https?:\/\/(www\.)?github\.com\//i.test(s)) {
    return [s];
  }

  const blob = s.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i
  );
  if (blob) {
    const [, owner, repo, branch, path] = blob;
    return [`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`];
  }

  const repoMatch = s
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!repoMatch) return [];

  const [, owner, repo] = repoMatch;
  return BRANCHES.flatMap((b) =>
    CANDIDATES.map((f) => `https://raw.githubusercontent.com/${owner}/${repo}/${b}/${f}`)
  );
}

/** Strip and read YAML-ish frontmatter. Only the two keys a skill needs — a
 *  real YAML parser is a dependency for something this shallow. */
function frontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

/** First heading, used as a name when frontmatter has none. */
function firstHeading(body: string): string {
  return body.match(/^#{1,3}\s+(.+)$/m)?.[1].trim() ?? "";
}

/** First real prose line, used as a description when frontmatter has none. */
function firstProse(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[#>\-*|`![]/.test(line)) continue; // headings, quotes, lists, code, images
    return line.slice(0, 200);
  }
  return "";
}

/**
 * Turn a fetched markdown file into a skill.
 *
 * `fallbackName` is normally the repo name — a skill with no name is
 * unaddressable, since `use_skill` looks them up by name.
 */
export function parseSkillMarkdown(md: string, fallbackName: string): ParsedSkill | null {
  const text = (md ?? "").trim();
  if (!text) return null;

  const { meta, body } = frontmatter(text);
  const name = (meta.name || firstHeading(body) || fallbackName).trim().slice(0, 80);
  if (!name) return null;

  const description = (
    meta.description ||
    firstProse(body) ||
    `Imported skill: ${name}`
  ).slice(0, 300);

  const instructions = body.trim();
  if (!instructions) return null;

  return { name, description, instructions };
}

/** A short label for where a skill came from, for provenance in the UI. */
export function sourceLabel(url: string): string {
  const raw = url.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/(.+)$/i
  );
  if (raw) return `github:${raw[1]}/${raw[2]}/${raw[3]}`;
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
}
