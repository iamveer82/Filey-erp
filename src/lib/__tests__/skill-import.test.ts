// Resolving and parsing a skill from a repo — see skillImport.ts.
import { describe, it, expect } from "vitest";
import { skillSourceUrls, parseSkillMarkdown, sourceLabel } from "../skillImport";

describe("skillSourceUrls", () => {
  it("expands a bare owner/repo across the conventional file names", () => {
    const urls = skillSourceUrls("anthropics/skills");
    expect(urls[0]).toBe("https://raw.githubusercontent.com/anthropics/skills/main/SKILL.md");
    expect(urls.some((u) => u.endsWith("/main/README.md"))).toBe(true);
    expect(urls.some((u) => u.includes("/master/"))).toBe(true);
  });

  it("accepts a repo page URL, with or without .git and trailing slash", () => {
    const a = skillSourceUrls("https://github.com/owner/repo");
    const b = skillSourceUrls("https://github.com/owner/repo.git");
    const c = skillSourceUrls("https://github.com/owner/repo/");
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a[0]).toContain("raw.githubusercontent.com/owner/repo/main/SKILL.md");
  });

  it("takes a /blob/ link literally rather than guessing past it", () => {
    // The user pointed at one file; trying other names would ignore them.
    expect(skillSourceUrls("https://github.com/o/r/blob/dev/docs/PLAYBOOK.md")).toEqual([
      "https://raw.githubusercontent.com/o/r/dev/docs/PLAYBOOK.md",
    ]);
  });

  it("passes a non-GitHub URL straight through", () => {
    expect(skillSourceUrls("https://example.com/skill.md")).toEqual([
      "https://example.com/skill.md",
    ]);
  });

  it("rejects what it cannot read as a source", () => {
    expect(skillSourceUrls("")).toEqual([]);
    expect(skillSourceUrls("   ")).toEqual([]);
    expect(skillSourceUrls("not a repo at all")).toEqual([]);
  });
});

describe("parseSkillMarkdown", () => {
  it("prefers frontmatter name and description", () => {
    const md = [
      "---",
      "name: Invoice Chaser",
      "description: How we chase overdue invoices",
      "---",
      "",
      "# Heading that should not win",
      "Step one.",
    ].join("\n");
    const s = parseSkillMarkdown(md, "fallback")!;
    expect(s.name).toBe("Invoice Chaser");
    expect(s.description).toBe("How we chase overdue invoices");
    expect(s.instructions).toContain("Step one.");
    expect(s.instructions).not.toContain("name: Invoice Chaser"); // frontmatter stripped
  });

  it("falls back to the first heading and the first prose line", () => {
    const md = "# Month End\n\n- a list item\n\nClose the books each month.\n";
    const s = parseSkillMarkdown(md, "repo-name")!;
    expect(s.name).toBe("Month End");
    expect(s.description).toBe("Close the books each month.");
  });

  it("falls back to the repo name when there is no heading", () => {
    const s = parseSkillMarkdown("Just do the thing.", "my-repo")!;
    expect(s.name).toBe("my-repo");
    expect(s.description).toBe("Just do the thing.");
  });

  it("returns null for empty or whitespace-only content", () => {
    expect(parseSkillMarkdown("", "x")).toBeNull();
    expect(parseSkillMarkdown("   \n\n ", "x")).toBeNull();
  });

  it("returns null when frontmatter leaves no body", () => {
    expect(parseSkillMarkdown("---\nname: X\n---\n", "x")).toBeNull();
  });

  it("caps a runaway name and description", () => {
    const md = `---\nname: ${"n".repeat(200)}\ndescription: ${"d".repeat(500)}\n---\nbody`;
    const s = parseSkillMarkdown(md, "x")!;
    expect(s.name.length).toBeLessThanOrEqual(80);
    expect(s.description.length).toBeLessThanOrEqual(300);
  });
});

describe("sourceLabel", () => {
  it("names the repo and path for a GitHub raw URL", () => {
    expect(sourceLabel("https://raw.githubusercontent.com/o/r/main/SKILL.md")).toBe(
      "github:o/r/SKILL.md"
    );
  });

  it("falls back to the host elsewhere", () => {
    expect(sourceLabel("https://example.com/a/b.md")).toBe("example.com");
  });
});
