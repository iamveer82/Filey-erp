/* The agent's own persona, separate from the orb colour and the vibe in Settings.
 * Name, voice and standing workflow travel with every conversation. They are
 * preferences, never permission to skip an approval or a safety rule. */
import { readAgentStorage, writeAgentStorage } from "./agentStorage";

export interface AgentPersona {
  name: string;
  voice: string;
  /** The standing workflow: what the agent does, in the user's words. */
  workflow: string;
}

const KEY = "filey.agent.persona";
const EMPTY: AgentPersona = { name: "", voice: "", workflow: "" };
const LIMITS = { name: 40, voice: 200, workflow: 800 } as const;

export function getAgentPersona(): AgentPersona {
  try {
    const raw = readAgentStorage(KEY);
    if (!raw) return { ...EMPTY };
    const saved = JSON.parse(raw) as Partial<AgentPersona>;
    return {
      name: typeof saved.name === "string" ? saved.name.slice(0, LIMITS.name) : "",
      voice: typeof saved.voice === "string" ? saved.voice.slice(0, LIMITS.voice) : "",
      workflow: typeof saved.workflow === "string" ? saved.workflow.slice(0, LIMITS.workflow) : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function setAgentPersona(patch: Partial<AgentPersona>): AgentPersona {
  const current = getAgentPersona();
  const next: AgentPersona = { ...current };
  for (const key of ["name", "voice", "workflow"] as const) {
    if (patch[key] === undefined) continue;
    const value = patch[key]!.trim();
    if (value.length > LIMITS[key]) throw new Error(`Keep ${key} within ${LIMITS[key]} characters.`);
    next[key] = value;
  }
  writeAgentStorage(KEY, JSON.stringify(next));
  return next;
}

/** What the model is told. Empty fields stay out, so an unset persona adds one line. */
export function agentPersonaPrompt(persona = getAgentPersona()): string {
  const lines = [
    "YOUR PERSONA — set by the user with /persona. It decides how you introduce yourself and the standing workflow you follow. The current request wins when they differ, and it never overrides a safety rule or an approval.",
  ];
  if (persona.name) lines.push(`Your name is ${persona.name}.`);
  if (persona.voice) lines.push(`Voice: ${persona.voice}`);
  if (persona.workflow) lines.push(`Standing workflow:\n${persona.workflow}`);
  if (!persona.name && !persona.voice && !persona.workflow)
    lines.push("No personal name, voice or workflow is saved yet.");
  return lines.join("\n");
}
