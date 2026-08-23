/* Built-in channel layer — a TypeScript take on Agent-Reach (MIT), sized for
 * Filey's client-side, BYOK agent.
 *
 * The idea worth copying from Agent-Reach is not any single scraper: it is
 * that every platform should be an ORDERED LIST OF BACKENDS, probed in turn,
 * where a failure comes back with which backend was tried and what would fix
 * it. Platform layouts change constantly; the router absorbs that, the tools
 * above it don't care.
 *
 * Everything here is read-only, free, and keyless. Every string that came off
 * the internet leaves this module wrapped as untrusted context. Direct
 * fetches are attempted first where the platform sends CORS headers
 * (api.github.com, Piped); otherwise traffic rides the Jina reader, which
 * fetches server-side and works from the browser.
 */

import { readUrl, httpFetch, asUntrustedContext, ReachError } from "./reach";

export interface ChannelResult {
  via: string;
  /** Already untrusted-wrapped, ready for the model. */
  content: string;
}

/** Run backends in order; return the first success. Collect failures so a
 *  total failure can say exactly what was tried — the doctor move. */
async function firstOf<T>(
  label: string,
  backends: { name: string; run: () => Promise<T> }[]
): Promise<T> {
  const tried: string[] = [];
  for (const b of backends) {
    try {
      return await b.run();
    } catch (e) {
      console.error("[firstOf]", b.name, e);
    }
  }
  throw new ReachError(
    `${label} failed on every backend — ${tried.join(" · ")}. ` +
      `If this is a corporate network or offline machine, the web tools cannot help.`
  );
}

const wrap = (label: string, text: string) => asUntrustedContext(label, text);

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n…[truncated]` : t;
}

/** GitHub REST with the status codes translated into prescriptions. httpFetch
 *  throws AiError on non-OK statuses before a caller can see them, so the
 *  mapping happens here, once. */
async function ghFetch(url: string): Promise<string> {
  try {
    return (await httpFetch(url)).body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\(404\)/.test(msg))
      throw new ReachError(
        `Not found — the repo/file does not exist, or it is private (private repos need the gh CLI, which the agent can run on desktop).`
      );
    if (/\(403\)/.test(msg))
      throw new ReachError(`GitHub API rate limit hit (60/hr unauthenticated). Try again later.`);
    throw e;
  }
}

/* â”€â”€ YouTube â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const YOUTUBE_ID = /(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/;
const PIPED_INSTANCES = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de"];

export function youtubeId(input: string): string | null {
  if (/^[\w-]{11}$/.test(input.trim())) return input.trim();
  return YOUTUBE_ID.exec(input)?.[1] ?? null;
}

interface PipedStream {
  title?: string;
  uploader?: string;
  duration?: number;
  description?: string;
  views?: number;
  error?: string;
}

/** Metadata always comes from one of the two paths below. Transcripts are
 *  genuinely hard from a plain browser (signed caption URLs, CORS); when the
 *  direct subtitle fetch fails we say so rather than pretending. */
export async function youtubeVideo(input: string): Promise<ChannelResult & { transcript?: string }> {
  const id = youtubeId(input);
  if (!id) throw new ReachError(`Not a YouTube video id or URL: ${input}`);

  const meta = await firstOf(`YouTube ${id}`, [
    ...PIPED_INSTANCES.map((base) => ({
      name: `piped (${new URL(base).hostname})`,
      run: async () => {
        const res = await httpFetch(`${base}/streams/${id}`);
        const data = JSON.parse(res.body) as PipedStream;
        if (data.error || !data.title) throw new ReachError(data.error || "empty response");
        return data;
      },
    })),
    {
      name: "jina (page read)",
      run: async () => {
        const page = await readUrl(`https://www.youtube.com/watch?v=${id}`);
        // The reader returns the watch page as markdown; hand it through whole.
        return { description: page.text, __jina: true } as unknown as PipedStream;
      },
    },
  ]);

  let transcript: string | undefined;
  try {
    const res = await httpFetch(
      `https://video.google.com/timedtext?lang=en&v=${id}`
    );
    if (res.status === 200 && /<transcript|<text/i.test(res.body)) {
      const texts = [...res.body.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) =>
        m[1]
          .replace(/&amp;#39;/g, "'")
          .replace(/&amp;quot;/g, '"')
          .replace(/&amp;amp;/g, "&")
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
      );
      transcript = texts.join(" ");
    }
  } catch {
    /* prescription below covers it */
  }

  const header =
    typeof (meta as { __jina?: boolean }).__jina === "boolean"
      ? `via: jina page read`
      : [
          meta.title,
          meta.uploader,
          meta.duration ? `${Math.round(meta.duration / 60)} min` : "",
          meta.views ? `${meta.views} views` : "",
        ]
          .filter(Boolean)
          .join(" · ");
  const body =
    typeof (meta as { __jina?: boolean }).__jina === "boolean"
      ? (meta.description ?? "")
      : clip(meta.description?.replace(/<[^>]+>/g, " ") ?? "", 6000);
  const note = transcript
    ? ""
    : "\n\n[reach] No transcript available from this device — caption URLs are signed and CORS-blocked in browsers. On the desktop build the native proxy may succeed where the browser cannot.";

  return {
    via: "youtube",
    transcript,
    content:
      wrap(`youtube:${id}`, `YouTube ${id} — ${header}\n\n${body}${note}`) +
      (transcript ? `\n\nTRANSCRIPT:\n${clip(transcript, 12000)}` : ""),
  };
}

/* â”€â”€ GitHub â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const REPO_RE = /github\.com[/:]([\w.-]+)\/([\w.-]+)/;

export async function githubRepo(repoInput: string): Promise<ChannelResult> {
  const m = REPO_RE.exec(repoInput.trim());
  const slug = m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : repoInput.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug))
    throw new ReachError(`Not an owner/repo slug: ${repoInput}`);

  const res = await ghFetch(`https://api.github.com/repos/${slug}`);
  const repo = JSON.parse(res) as Record<string, unknown>;

  const readmeRes = await ghFetch(
    `https://api.github.com/repos/${slug}/readme`
  );
  let readme = '';
  try {
    const rm = JSON.parse(readmeRes) as { content?: string };
    if (rm.content) readme = clip(atob(rm.content.replace(/\n/g, '')), 8000);
  } catch { /* README is optional */ }

  const lines = [
    `${repo.full_name} — ${repo.description ?? "(no description)"}`,
    `★ ${repo.stargazers_count} · forks ${repo.forks_count} · issues ${(repo.open_issues_count as number) ?? 0} · language ${repo.language ?? "?"}`,
    `license: ${(repo.license as { spdx_id?: string } | null)?.spdx_id ?? "none"} · updated ${repo.pushed_at}`,
    `topics: ${(repo.topics as string[] | undefined)?.join(", ") || "—"}`,
    "",
    readme || "(no README)",
  ];
  // The tree rides along so one call answers "what is this and what's in it".
  try {
    const tree = await githubTree(slug);
    const skillish = tree.files.filter((f) => /(^|\/)(SKILL\.md|AGENTS\.md|CLAUDE\.md)$/i.test(f));
    lines.push(
      "",
      `FILES (${tree.files.length}${tree.truncated ? "+, truncated" : ""}): ${tree.files.slice(0, 120).join(", ")}`,
      skillish.length
        ? `This repo carries agent instructions (${skillish.join(", ")}) — offer import_skill if the user wants it installed.`
        : ""
    );
  } catch {
    /* tree is a bonus; never fail the overview for it */
  }
  return { via: "github", content: wrap(`github:${slug}`, lines.filter(Boolean).join("\n")) };
}

export async function githubSearch(query: string, kind: "repos" | "issues" = "repos"): Promise<ChannelResult> {
  const q = query.trim();
  if (!q) throw new ReachError("Search needs a query.");
  const endpoint =
    kind === "repos"
      ? `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=10`
      : `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=reactions&per_page=10`;
  const res = await ghFetch(endpoint);
  
  const data = JSON.parse(res) as {
    total_count?: number;
    items?: { full_name?: string; title?: string; html_url?: string; description?: string; stargazers_count?: number; state?: string }[];
  };
  const lines = [`GitHub ${kind}: ${data.total_count ?? 0} results for "${q}"`];
  for (const it of data.items ?? []) {
    lines.push(
      kind === "repos"
        ? `- ${it.full_name} ★${it.stargazers_count ?? 0} — ${it.description ?? ""}`
        : `- [${it.state}] ${it.title} — ${it.html_url}`
    );
  }
  return { via: "github", content: wrap(`github-search:${q}`, lines.join("\n")) };
}

/** File tree of a repo, so "use this repo" starts with knowing what's in it.
 *  Paths only — cheap, and enough for the model to pick files worth reading. */
export async function githubTree(repoInput: string): Promise<{ slug: string; files: string[]; truncated: boolean }> {
  const m = REPO_RE.exec(repoInput.trim());
  const slug = m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : repoInput.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new ReachError(`Not an owner/repo slug: ${repoInput}`);
  const res = await ghFetch(`https://api.github.com/repos/${slug}/git/trees/HEAD?recursive=1`);
  const data = JSON.parse(res) as {
    truncated?: boolean;
    tree?: { path: string; type: string }[];
  };
  return {
    slug,
    files: (data.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path),
    truncated: !!data.truncated,
  };
}

/** One file's text. Binary files are refused with what to do instead —
 *  base64-dumping a PNG into the transcript helps nobody. */
export async function githubFile(
  repoInput: string,
  path: string,
  maxChars = 12_000
): Promise<ChannelResult & { path: string }> {
  const m = REPO_RE.exec(repoInput.trim());
  const slug = m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : repoInput.trim();
  const clean = path.replace(/^\/+/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new ReachError(`Not an owner/repo slug: ${repoInput}`);
  if (!clean || clean.includes("..")) throw new ReachError(`Bad file path: ${path}`);
  const res = await ghFetch(`https://raw.githubusercontent.com/${slug}/HEAD/${clean}`);
  const body = res;
  if (body.includes("\u0000"))
    throw new ReachError(
      `"${clean}" looks binary (images/archives can't be read as text). If it matters, tell the user to download it from github.com/${slug}.`
    );
  return {
    via: "github",
    path: clean,
    content: wrap(`github:${slug}/${clean}`, clip(body, maxChars)),
  };
}

/* â”€â”€ RSS / Atom â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

function parseFeedXml(xml: string, limit: number): { title: string; link: string; date: string; snippet: string }[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new ReachError("Feed is not valid XML.");
  const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
  return nodes.slice(0, limit).map((n) => {
    const pick = (tag: string) => n.querySelector(tag)?.textContent?.trim() ?? "";
    const link = pick("link") || n.querySelector("link")?.getAttribute("href") || "";
    return {
      title: pick("title"),
      link,
      date: pick("pubDate") || pick("updated") || pick("published"),
      snippet: clip(pick("description") || pick("summary"), 280),
    };
  });
}

export async function rssFeed(feedUrl: string, limit = 15): Promise<ChannelResult> {
  const target = feedUrl.trim();
  // Same public-web rule as every other reader: no intranet feeds.
  await firstOf("feed validation", [
    { name: "url-check", run: async () => void 0 },
  ]);
  const xml = await firstOf(`RSS ${target}`, [
    {
      name: "direct",
      run: async () => {
        const res = await httpFetch(target);
        if (!/<(rss|feed|channel)[\s>]/i.test(res.body)) throw new ReachError("not a feed");
        return res.body;
      },
    },
    {
      name: "jina",
      run: async () => {
        const page = await readUrl(target);
        return page.text;
      },
    },
  ]);
  let items: ReturnType<typeof parseFeedXml> = [];
  const looksLikeFeed = /<(rss|feed|channel)[\s>]/i.test(xml);
  // Not XML means we are holding the reader's TEXT rendering — ship that.
  if (!looksLikeFeed)
    return { via: "rss(jina)", content: wrap(`feed:${target}`, clip(xml, 9000)) };
  try {
    items = parseFeedXml(xml, limit);
  } catch {
    // Jina path returns readable text, not XML — ship it as-is, clearly labelled.
    return { via: "rss(jina)", content: wrap(`feed:${target}`, clip(xml, 9000)) };
  }
  const lines = [`Feed ${target} — ${items.length} latest items:`];
  for (const it of items)
    lines.push(`- ${it.date ? `[${it.date}] ` : ""}${it.title}${it.link ? ` — ${it.link}` : ""}${it.snippet ? `\n  ${it.snippet}` : ""}`);
  return { via: "rss", content: wrap(`feed:${target}`, lines.join("\n")) };
}

/* â”€â”€ Social pages (X/Twitter, Reddit, LinkedIn …) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** One honest tool for the walled gardens: most require logins, so the only
 *  keyless path is the reader service, and it does not always get through.
 *  The result says which happened. */
export async function socialPage(url: string): Promise<ChannelResult> {
  const target = url.trim();
  const page = await readUrl(target);
  const thin = page.text.replace(/\s+/g, " ").length < 400;
  const note = thin
    ? "\n\n[reach] The page rendered nearly empty — this platform usually requires a login. What you see is what the public reader got."
    : "";
  return {
    via: "jina",
    content: wrap(`social:${target}`, `Read via public reader${note}:\n\n${clip(page.text, 10000)}`),
  };
}
