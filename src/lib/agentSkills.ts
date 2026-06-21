/* Agent skills — reusable instruction packs (workflows/procedures/personas) the
 * agent loads on demand. The skill's name + description sit in the system prompt
 * (cheap); the agent calls the `use_skill` tool to pull the full instructions
 * only when relevant — progressive disclosure, like Claude skills.
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  createdAt: number;
}

const KEY = "filey.agent.skills";

export function loadSkills(): Skill[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as Skill[]) : [];
  } catch {
    console.error("Failed to parse agent skills");
    return [];
  }
}

export function saveSkills(skills: Skill[]): void {
  localStorage.setItem(KEY, JSON.stringify(skills));
}

export function addSkill(
  s: Omit<Skill, "id" | "createdAt" | "enabled"> & { enabled?: boolean }
): Skill {
  const skill: Skill = {
    id: `skill_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    createdAt: Date.now(),
    enabled: s.enabled ?? true,
    name: s.name,
    description: s.description,
    instructions: s.instructions,
  };
  saveSkills([...loadSkills(), skill]);
  return skill;
}

export function updateSkill(id: string, patch: Partial<Skill>): void {
  saveSkills(loadSkills().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export function removeSkill(id: string): void {
  saveSkills(loadSkills().filter((s) => s.id !== id));
}

/** Find an enabled skill by name (case-insensitive, exact then partial). */
export function findSkill(name: string): Skill | undefined {
  const q = name.trim().toLowerCase();
  const on = loadSkills().filter((s) => s.enabled);
  return on.find((s) => s.name.toLowerCase() === q) || on.find((s) => s.name.toLowerCase().includes(q));
}

/** Short index of enabled skills for the system prompt. "" when none. */
export function skillsIndex(): string {
  const on = loadSkills().filter((s) => s.enabled);
  if (!on.length) return "";
  return [
    "AVAILABLE SKILLS — reusable procedures you can follow. Call the `use_skill` tool with the skill name to load its full instructions when the task matches:",
    ...on.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}
