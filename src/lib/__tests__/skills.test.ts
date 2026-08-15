import { beforeEach, describe, expect, it } from "vitest";
import { addSkill, loadSkills } from "../agentSkills";
import { seedDefaultSkills } from "../defaultSkills";

beforeEach(() => localStorage.clear());

/* Skills are looked up by name, so the same name twice is a bug — the agent
 * re-learning something must sharpen the entry, not stack a copy behind it. */
describe("addSkill", () => {
  it("rewrites the skill that already owns the name, keeping its id", () => {
    const first = addSkill({ name: "run-a-repo", description: "v1", instructions: "old" });
    const second = addSkill({ name: "Run-A-Repo", description: "v2", instructions: "new" });

    expect(loadSkills()).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(loadSkills()[0].instructions).toBe("new");
  });

  it("still appends a genuinely new name", () => {
    addSkill({ name: "one", description: "", instructions: "" });
    addSkill({ name: "two", description: "", instructions: "" });
    expect(loadSkills()).toHaveLength(2);
  });
});

describe("seedDefaultSkills", () => {
  it("seeds once, and a second call changes nothing", () => {
    seedDefaultSkills();
    const after = loadSkills().length;
    expect(after).toBeGreaterThan(0);
    seedDefaultSkills();
    expect(loadSkills()).toHaveLength(after);
  });

  it("leaves skills the owner wrote alone", () => {
    addSkill({ name: "my-own-thing", description: "mine", instructions: "mine" });
    seedDefaultSkills();
    expect(loadSkills().find((s) => s.name === "my-own-thing")?.instructions).toBe("mine");
  });
});
