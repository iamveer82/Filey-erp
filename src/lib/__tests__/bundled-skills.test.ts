import { expect, it } from "vitest";
import { bundledSkill, bundledSkillFile, bundledSkillsIndex, isBundledSkill, skillScriptJob } from "../bundledSkills";
import { parseSkillMarkdown } from "../skillImport";
import { skillsIndex } from "../agentSkills";

// Pre-installed: the Instagram, YouTube and LinkedIn packs (MIT) and Agent-Reach rewritten for Filey.
it("offers each pack in one prompt line and lists its skills on demand", async () => {
  expect(bundledSkillsIndex()).toHaveLength(4);
  expect(skillsIndex()).toContain("- instagram (pre-installed):");
  const ig = (await bundledSkill("Instagram")) as { skills: { name: string; description: string }[]; platform: string };
  expect(ig.skills).toHaveLength(13);
  expect(ig.skills.find((s) => s.name === "ig-caption")?.description).toMatch(/^Write the Instagram caption/);
  expect(ig.platform).toContain("schedule_social_post");
  expect(((await bundledSkill("youtube")) as { skills: unknown[] }).skills).toHaveLength(11);
  expect(((await bundledSkill("linkedin")) as { skills: unknown[] }).skills).toHaveLength(11);
});

it("loads one skill with how to run its scripts in Filey, and reads its data files only", async () => {
  const caption = (await bundledSkill("ig-caption")) as { instructions: string };
  expect(caption.instructions).toContain('call run_skill_script with skill "ig-caption"');
  expect(caption.instructions).toContain("Scripts: caption.py");
  expect(caption.instructions).toContain("# ig-caption");
  const reach = (await bundledSkill("agent-reach")) as { instructions: string };
  expect(reach.instructions).toContain("read_social_page");
  expect(reach.instructions).not.toContain("run_skill_script");
  expect(JSON.parse((await bundledSkillFile("yt-script", "hooks.json"))!)).toBeTruthy();
  expect(await bundledSkillFile("ig-reel", "templates/voice.md")).toContain("voice");
  expect(await bundledSkillFile("ig-reel", "../ig-caption/caption.py")).toBeNull();
  expect(await bundledSkillFile("ig-reel", "/etc/passwd")).toBeNull();
  expect(isBundledSkill("li-human")).toBe(true);
  expect(isBundledSkill("invoice-magic")).toBe(false);
});

it("builds a run from a fresh copy of the pack and refuses anything else", async () => {
  const job = await skillScriptJob("yt-script", "hookscore.py", ["hooks.txt"], { "hooks.txt": "Nobody tells you this" });
  expect(job.cwd).toBe("/skills/youtube/skills/yt-script");
  expect(job.files["/skills/youtube/skills/yt-script/hooks.txt"]).toBe("Nobody tells you this");
  expect(job.files["/skills/youtube/skills/yt-edit/deadair.py"]).toContain("def ");
  await expect(skillScriptJob("yt-script", "rm.py", [], {})).rejects.toThrow("no script");
  await expect(skillScriptJob("yt-script", "hookscore.py", [], { "hooks.json": "{}" })).rejects.toThrow("own files");
  await expect(skillScriptJob("yt-script", "hookscore.py", [], { "../x.txt": "" })).rejects.toThrow("plain file name");
  await expect(skillScriptJob("instagram", "x.py", [], {})).rejects.toThrow("not a pre-installed skill with scripts");
});

it("reads folded YAML descriptions in imported skills too", () => {
  const md = "---\nname: demo\ndescription: >-\n  First line\n  second line.\nother: x\n---\n# Body\nText";
  expect(parseSkillMarkdown(md, "x")).toMatchObject({ name: "demo", description: "First line second line." });
});
