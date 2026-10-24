/* Commands the user types in chat. They run here, not through the model, so
 * /memory, /persona and /new never spend a Coin or wait on a tool. */
import { deleteMemory, listMemories, searchMemories } from "./aiMemory";
import { loadSkills } from "./agentSkills";
import { agentPersonaPrompt, getAgentPersona, setAgentPersona, type AgentPersona } from "./agentPersona";

export type AgentCommand =
  | { kind: "reply"; text: string }
  | { kind: "new"; text: string }
  | { kind: "stop"; text: string };

const NAMES = ["help", "new", "stop", "memory", "forget", "persona", "skills"] as const;

export function agentCommand(text: string): AgentCommand | null {
  const match = text.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!match || !NAMES.includes(match[1].toLowerCase() as (typeof NAMES)[number])) return null;
  const name = match[1].toLowerCase();
  const rest = (match[2] ?? "").trim();
  switch (name) {
    case "help": return { kind: "reply", text: HELP };
    case "new": return { kind: "new", text: "New conversation. Your memory, persona and skills stay." };
    case "stop": return { kind: "stop", text: "Stopped. Anything already saved stays saved." };
    case "memory": return { kind: "reply", text: memoryText() };
    case "forget": return { kind: "reply", text: forgetText(rest) };
    case "persona": return { kind: "reply", text: personaText(rest) };
    case "skills": return { kind: "reply", text: skillsText() };
    default: return null;
  }
}

const HELP = [
  "Commands, answered here without calling the model:",
  "/new — a fresh conversation. Memory, persona and skills stay.",
  "/stop — stop the task that is running.",
  "/memory — what the agent remembers.",
  "/forget <words> — remove the one memory those words match.",
  "/persona — the agent's name, voice and standing workflow.",
  "/persona name <name>",
  "/persona voice <how it should speak>",
  "/persona workflow <what it should do from now on>",
  "/skills — saved procedures.",
].join("\n");

function memoryText(): string {
  const memories = listMemories();
  if (!memories.length) return "Nothing saved yet. Tell the agent a fact that should last, or it will save one when you state a preference.";
  return ["Memory:", ...memories.slice(0, 20).map(m => `- ${m.text}${m.tag ? ` (${m.tag})` : ""}`)].join("\n");
}

function forgetText(rest: string): string {
  if (!rest) return "Say which memory, for example /forget logo.";
  const exact = listMemories().find(m => m.id === rest);
  const hits = exact ? [exact] : searchMemories(rest, 5);
  if (!hits.length) return `No memory matches "${rest}". /memory lists them.`;
  if (hits.length > 1) return `Several memories match. Repeat /forget with more of the wording:\n${hits.map(m => `- ${m.text}`).join("\n")}`;
  deleteMemory(hits[0].id);
  return `Forgotten: ${hits[0].text}`;
}

function personaText(rest: string): string {
  if (!rest) {
    const persona = getAgentPersona();
    return agentPersonaPrompt(persona).replace(/^YOUR PERSONA[^\n]*\n?/, "") || "No persona saved. Set one with /persona name, /persona voice or /persona workflow.";
  }
  const field = rest.match(/^(name|voice|workflow)\s+([\s\S]+)$/i);
  if (!field) return "Use /persona name, /persona voice, or /persona workflow, followed by the text.";
  const key = field[1].toLowerCase() as keyof AgentPersona;
  try {
    const saved = setAgentPersona({ [key]: field[2] });
    return `Saved. ${key === "name" ? `The agent is ${saved.name}.` : key === "voice" ? `Voice: ${saved.voice}` : `Workflow: ${saved.workflow}`}`;
  } catch (error) {
    return error instanceof Error ? error.message : "That could not be saved.";
  }
}

function skillsText(): string {
  const skills = loadSkills().filter(s => s.enabled);
  if (!skills.length) return "No skills saved yet. A procedure the agent works out can be kept with learn_skill, and it loads the next time that work comes up.";
  return ["Skills:", ...skills.map(s => `- ${s.name}: ${s.description}`)].join("\n");
}
