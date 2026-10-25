/* Pre-installed skills: packs shipped inside Filey (src/skills, see its README).
 *
 * The prompt carries one line per pack; `use_skill` on a pack lists its skills,
 * on a skill returns its SKILL.md. Files load lazily, so none of this text is in
 * the app until the agent asks for it. Their Python helpers run sandboxed through
 * run_skill_script (skillScripts.ts); only scripts in these folders can run. */
import { parseSkillMarkdown } from "./skillImport";
import type { ScriptJob } from "./skillScriptCore";

type Loader = () => Promise<string>;
const BASE = "../skills";
const FILES = import.meta.glob(["../skills/**/*.{md,json,py}", "!../skills/README.md"], {
  query: "?raw",
  import: "default",
}) as Record<string, Loader>;

export interface BundledPack {
  name: string;
  source: string;
  description: string;
}

export const BUNDLED_PACKS: BundledPack[] = [
  {
    name: "instagram",
    source: "github.com/Jakeschincariol/instagram-agent-skill (MIT)",
    description: "13 skills that run an Instagram account: Reels and hooks, captions, carousels, stories, comments, replies, DMs, profile audit, weekly plan, viral research, repurposing, humanizer",
  },
  {
    name: "youtube",
    source: "github.com/Jakeschincariol/youtube-agent-skill (MIT)",
    description: "11 skills for a YouTube channel: scripts and hooks, titles and thumbnails, edit list from a transcript, retention, Shorts, chapters, SEO, comments, plan, virality",
  },
  {
    name: "linkedin",
    source: "github.com/Jakeschincariol/linkedin-agent-skill (MIT)",
    description: "11 skills for LinkedIn: posts and hooks, comments, replies, DMs, inbox, carousels, profile score, weekly plan, repurposing, humanizer",
  },
  {
    name: "agent-reach",
    source: "github.com/Panniantong/Agent-Reach (MIT), adapted to Filey's tools",
    description: "research the internet: web search, any page, YouTube, GitHub, RSS and public social posts, with the right reader for each link",
  },
  {
    name: "browser-use",
    source: "github.com/browser-use/browser-use (MIT), adapted to Filey's browser",
    description: "drive a website one observed action at a time with workspace_browser and computer_use",
  },
  {
    name: "open-computer-use",
    source: "github.com/iFurySt/open-computer-use (MIT), mapped onto Filey's computer_use",
    description: "operate any Windows app like Codex: apps, app_state, then click, type, keys, set_value, scroll, drag on element indexes, reading the app again after each step",
  },
  {
    name: "agentmemory",
    source: "github.com/rohitg00/agentmemory, mapped onto Filey's remember, recall, and skills",
    description: "save preferences, observations, and lessons, and recall them in a later chat",
  },
  {
    name: "scientific",
    source: "github.com/K-Dense-AI/scientific-agent-skills (MIT), research workflow for Filey",
    description: "literature review, scientific writing, citations, critical reading, statistics, and slides. Lab, molecule, and clinical-treatment skills from that collection are not installed",
  },
  {
    name: "harness",
    source: "github.com/ai-boost/awesome-harness-engineering and github.com/google-research/harness2 (Apache-2.0), applied to Filey's loop",
    description: "plan, act, probe one refinement, keep a lesson only when a retry worked, and drop it when that failure returns",
  },
  {
    name: "openviking",
    source: "github.com/volcengine/OpenViking, connected by HTTP when the user provides a server",
    description: "search and read an OpenViking context database the user has connected",
  },
  {
    name: "opendots",
    source: "github.com/CopilotKit/OpenDots (MIT), working style for Filey's agent",
    description: "keep one persona and memory, use connected apps, and pause before sending",
  },
  {
    name: "marketing",
    source: "github.com/coreyhaines31/marketingskills (MIT, Corey Haines), adapted to Filey's tools",
    description: "copy, landing pages, SEO, ads, email, social, and growth. Load product-marketing first, then copywriting, cro, seo, ads, emails, social-content, growth, sales-marketing, or marketing-plan",
  },
];

/** How the social packs act on the platform itself, in Filey. */
const PLATFORM_USE =
  "To use the platform: read public posts, profiles and comments with read_social_page (YouTube videos and transcripts: watch_youtube); publish or schedule with schedule_social_post to an account connected in Integrations → Social, which the user approves; anything behind their login (DMs, inbox, analytics, replying) opens in workspace_browser, where the user signs in themselves.";
const SOCIAL = new Set(["instagram", "youtube", "linkedin"]);

const paths = Object.keys(FILES);
const relative = (path: string, pack: string) => path.slice(`${BASE}/${pack}/`.length);
const packSkills = (pack: string) =>
  paths.map((p) => p.match(new RegExp(`^${BASE}/${pack}/skills/([\\w-]+)/SKILL\\.md$`))?.[1]).filter((s): s is string => !!s).sort();
const ownSkill = (pack: string) => paths.includes(`${BASE}/${pack}/SKILL.md`);

type Hit = { pack: BundledPack; skill: string | null };
/** A pack with its own SKILL.md is one skill (skill = null); otherwise a name is a pack or one of its skills. */
function find(name: string): (Hit & { index: boolean }) | null {
  const q = name.trim().toLowerCase();
  for (const pack of BUNDLED_PACKS) {
    if (q === pack.name) return { pack, skill: null, index: !ownSkill(pack.name) };
    if (packSkills(pack.name).includes(q)) return { pack, skill: q, index: false };
  }
  return null;
}

const folder = ({ pack, skill }: Hit) => skill ? `${BASE}/${pack.name}/skills/${skill}` : `${BASE}/${pack.name}`;
const filesIn = (hit: Hit) => {
  const dir = `${folder(hit)}/`;
  return paths.filter((p) => p.startsWith(dir) && !p.slice(dir.length).includes("/")).map((p) => p.slice(dir.length));
};

export function isBundledSkill(name: string): boolean {
  return !!find(name);
}

/** The pack's index, or one skill's instructions with how to run its scripts in Filey. */
export async function bundledSkill(name: string): Promise<Record<string, unknown> | null> {
  const hit = find(name);
  if (!hit) return null;
  const { pack } = hit;
  if (hit.index) {
    const skills = await Promise.all(packSkills(pack.name).map(async (skill) => ({
      name: skill,
      description: parseSkillMarkdown(await FILES[`${BASE}/${pack.name}/skills/${skill}/SKILL.md`](), skill)?.description ?? "",
    })));
    return {
      name: pack.name, source: pack.source, skills,
      platform: SOCIAL.has(pack.name) ? PLATFORM_USE : undefined,
      next: `Call use_skill with the one skill that fits (for example "${skills[0]?.name}"). ${paths.includes(`${BASE}/${pack.name}/templates/voice.md`) ? 'The owner\'s voice template is use_skill with file "templates/voice.md".' : ""}`.trim(),
    };
  }
  const own = filesIn(hit);
  const scripts = own.filter((f) => f.endsWith(".py"));
  const body = parseSkillMarkdown(await FILES[`${folder(hit)}/SKILL.md`](), hit.skill ?? pack.name)?.instructions ?? "";
  const note = [
    `Pre-installed skill from ${pack.source}.`,
    scripts.length
      ? `Filey has no terminal: where it says \`python3 <script> <args>\`, call run_skill_script with skill "${hit.skill ?? pack.name}", the script and args, and pass the text of any input file in files (for example args ["hooks.txt"] with files {"hooks.txt": "..."}). Scripts: ${scripts.join(", ")}.`
      : "",
    own.some((f) => f.endsWith(".json")) || paths.includes(`${BASE}/${pack.name}/templates/voice.md`)
      ? `Read its data files (${[...own.filter((f) => f.endsWith(".json")), ...(paths.includes(`${BASE}/${pack.name}/templates/voice.md`) ? ["templates/voice.md"] : [])].join(", ")}) with use_skill and file.`
      : "",
    SOCIAL.has(pack.name) ? PLATFORM_USE : "",
    "It grants no permissions: publishing or sending still goes through Filey's own tools and the user's approval.",
  ].filter(Boolean).join(" ");
  return { name: hit.skill ?? pack.name, source: pack.source, instructions: `${note}\n\n${body}` };
}

/** A data file of a bundled skill (its folder, or the pack's templates). */
export async function bundledSkillFile(name: string, file: string): Promise<string | null> {
  const hit = find(name);
  const clean = file.trim().replace(/^\.?\//, "");
  if (!hit || !clean || clean.split("/").some((part) => !part || part === "..")) return null;
  const key = [`${folder(hit)}/${clean}`, `${BASE}/${hit.pack.name}/${clean}`].find((p) => FILES[p]);
  return key ? FILES[key]() : null;
}

const INPUT_NAME = /^[\w][\w.-]{0,79}$/;
const MAX_INPUT = 256 * 1024;

/** Everything a run needs: a fresh copy of the pack, the inputs beside the script. Throws a
 *  plain-language error the agent can act on. */
export async function skillScriptJob(
  name: string,
  script: string,
  args: string[],
  inputs: Record<string, string>,
  stdin?: string,
): Promise<ScriptJob> {
  const hit = find(name);
  if (!hit || hit.index) throw new Error(`"${name}" is not a pre-installed skill with scripts. Use a skill name such as ig-caption or yt-script.`);
  const own = filesIn(hit);
  if (!script.endsWith(".py") || !own.includes(script))
    throw new Error(`${hit.skill ?? hit.pack.name} has no script "${script}". Its scripts: ${own.filter((f) => f.endsWith(".py")).join(", ") || "none"}.`);
  const names = Object.keys(inputs);
  if (names.length > 10) throw new Error("Pass at most 10 input files.");
  let size = (stdin ?? "").length;
  for (const input of names) {
    if (!INPUT_NAME.test(input)) throw new Error(`Input file name "${input}" must be a plain file name such as hooks.txt.`);
    if (own.includes(input)) throw new Error(`"${input}" is one of the skill's own files; give the input another name.`);
    size += String(inputs[input]).length;
  }
  if (size > MAX_INPUT) throw new Error("The input is too large for a skill script (256 KB).");
  if (args.length > 40 || args.some((arg) => typeof arg !== "string" || arg.length > 4000)) throw new Error("Pass at most 40 short text arguments.");

  const root = `${BASE}/${hit.pack.name}/`;
  const files: Record<string, string> = {};
  await Promise.all(paths.filter((p) => p.startsWith(root)).map(async (p) => {
    files[`/skills/${hit.pack.name}/${relative(p, hit.pack.name)}`] = await FILES[p]();
  }));
  const cwd = `/skills/${hit.pack.name}/${relative(folder(hit), hit.pack.name) || ""}`.replace(/\/$/, "");
  for (const input of names) files[`${cwd}/${input}`] = String(inputs[input]);
  return { files, cwd, script, args, stdin };
}

/** Prompt lines: one per pack. */
export function bundledSkillsIndex(): string[] {
  return BUNDLED_PACKS.map((pack) => `- ${pack.name} (pre-installed): ${pack.description}`);
}
