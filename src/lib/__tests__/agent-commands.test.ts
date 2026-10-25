import { beforeEach, describe, expect, it } from "vitest";
import { setCacheOrg } from "../api";
import { agentCommand } from "../agentCommands";
import { addMemory, clearMemories } from "../aiMemory";
import { getAgentPersona } from "../agentPersona";
import { agentStorageKey } from "../agentStorage";

describe("the agent's own commands", () => {
  beforeEach(() => {
    localStorage.setItem("filey_data_mode", "local");
    setCacheOrg("test-org", "test-user");
    clearMemories();
    const key = agentStorageKey("filey.agent.persona");
    if (key) localStorage.removeItem(key);
  });

  it("leaves an ordinary message for the model", () => {
    expect(agentCommand("make an invoice")).toBeNull();
    expect(agentCommand("/not-a-command")).toBeNull();
  });

  it("saves a persona and a standing workflow without calling the model", () => {
    expect(agentCommand("/persona name Ada")?.text).toContain("Ada");
    expect(agentCommand("/persona voice Short and warm.")?.text).toContain("Short and warm");
    expect(agentCommand("/persona workflow Letters go out on the company letterhead.")?.text).toContain("letterhead");
    expect(getAgentPersona()).toEqual({
      name: "Ada",
      voice: "Short and warm.",
      workflow: "Letters go out on the company letterhead.",
    });
    expect(agentCommand("/persona")?.text).toContain("Standing workflow:");
  });

  it("shows and removes one memory", () => {
    addMemory("No logo on invoices", "preference");
    expect(agentCommand("/memory")?.text).toContain("No logo on invoices");
    expect(agentCommand("/forget logo")?.text).toContain("Forgotten");
    expect(agentCommand("/memory")?.text).toContain("Nothing saved yet");
  });

  it("starts fresh and stops as commands, and lists the rest", () => {
    expect(agentCommand("/new")).toMatchObject({ kind: "new" });
    expect(agentCommand("/stop")).toMatchObject({ kind: "stop" });
    expect(agentCommand("/help")?.text).toContain("/persona workflow");
    expect(agentCommand("/skills")?.text).toContain("No skills saved yet");
  });
});
