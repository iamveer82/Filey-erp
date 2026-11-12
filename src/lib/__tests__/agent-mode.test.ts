import { agentStorageKey } from "../agentStorage";
import { setCacheOrg } from "../api";
import { beforeEach, describe, expect, it } from "vitest";
import { isCapabilityEnabled } from "../capabilities";
import { computerControlPreapproved, engineModeNote, gateFor, getAgentMode, grantsFullAccess, setAgentMode, modeSystemNote, fullAccessPreapproved, grantDesktopFullAccess } from "../agentMode";

beforeEach(() => { localStorage.clear(); localStorage.setItem("filey_data_mode", "local"); setCacheOrg("test-org", "test-user"); });

// One read tool, one plain write, one money/outbound tool — the three kinds the
// modes have to tell apart.
const READ = "get_stats";
const WRITE = "create_invoice_draft";
const SENSITIVE = "send_invoice";

describe("agent mode gate", () => {
  it("defaults to accept_edits: edits run, money asks", () => {
    expect(getAgentMode()).toBe("accept_edits");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("run");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("auto runs everything, sensitive included, except sending documents and invoices", () => {
    setAgentMode("auto");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("run");
    expect(gateFor("send_whatsapp", true)).toBe("run");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("manual asks before any change but never before a read", () => {
    setAgentMode("manual");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("ask");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("plan blocks every change and still allows reads", () => {
    setAgentMode("plan");
    expect(gateFor(READ)).toBe("run");
    expect(gateFor(WRITE)).toBe("block");
    expect(gateFor(SENSITIVE, true)).toBe("block");
  });

  it("a sensitive tool is gated even when it belongs to no capability group", () => {
    setAgentMode("accept_edits");
    expect(gateFor("some_unlisted_tool", true)).toBe("ask");
    expect(gateFor("some_unlisted_tool")).toBe("run");
  });

  it("survives a junk stored value rather than widening permissions", () => {
    localStorage.setItem(agentStorageKey("filey.agent.mode")!, "god");
    expect(getAgentMode()).toBe("accept_edits");
    expect(gateFor(SENSITIVE, true)).toBe("ask");
  });

  it("tells the model about the restrictive modes only", () => {
    expect(modeSystemNote("plan")).toContain("PLAN MODE");
    expect(modeSystemNote("manual")).toContain("MANUAL MODE");
    expect(modeSystemNote("accept_edits")).toBe("");
    expect(modeSystemNote("auto")).toContain("run_shell");
  });

  it("pre-approves desktop computer use in Auto and Accept edits, not Manual or Plan", () => {
    expect(computerControlPreapproved("auto")).toBe(true);
    expect(computerControlPreapproved("accept_edits")).toBe(true);
    expect(computerControlPreapproved("manual")).toBe(false);
    expect(computerControlPreapproved("plan")).toBe(false);
  });

  it("treats only Full access as in-app pre-approval", () => {
    expect(fullAccessPreapproved("accept_edits")).toBe(false);
    expect(fullAccessPreapproved("manual")).toBe(false);
    expect(fullAccessPreapproved("plan")).toBe(false);
    setAgentMode("auto");
    expect(fullAccessPreapproved()).toBe(true);
  });

  it("still asks before sending a document or invoice out in Auto mode", () => {
    for (const tool of ["send_invoice", "send_invoice_whatsapp", "email_invoice", "share_document_link", "send_whatsapp_file"]) {
      expect(gateFor(tool, true, "auto"), tool).toBe("ask");
      expect(fullAccessPreapproved("auto", tool), tool).toBe(false);
    }
    expect(gateFor("send_whatsapp", true, "auto")).toBe("run");
    expect(fullAccessPreapproved("auto", "send_whatsapp")).toBe(true);
  });

  it("hears the owner grant full access in plain words, and nothing weaker", () => {
    for (const text of ["You have full permissions, finish it", "I give you full access", "do it without asking",
      "go ahead without approval", "don't ask me for permission", "you've got full control now"])
      expect(grantsFullAccess(text), text).toBe(true);
    for (const text of ["Do I have full access to reports?", "ask me before sending", "what permissions do you have?",
      "full permissions are needed for this folder?"])
      expect(grantsFullAccess(text), text).toBe(false);
  });

  it("still asks in Full access before a command that could wipe data", () => {
    for (const command of ["format D:", "rm -rf ~/projects", "del /s /q C:\\Users", "Remove-Item -Recurse -Force C:\\data",
      "reg delete HKLM\\Software\\X", "git push --force origin main", "DROP TABLE invoices"])
      expect(fullAccessPreapproved("auto", "terminal", { action: command }), command).toBe(false);
    for (const command of ["npm install", "git status", "Remove-Item .\\build\\temp.txt", "dir C:\\Users"])
      expect(fullAccessPreapproved("auto", "terminal", { action: command }), command).toBe(true);
  });

  it("tells the engine the mode at the top of each turn", () => {
    expect(engineModeNote("auto")).toContain("without asking");
    expect(engineModeNote("accept_edits")).toContain("never ask for permission in chat");
    expect(engineModeNote("plan")).toContain("Plan");
  });

  it("grants Full access and computer use without enabling optional agent computers", () => {
    grantDesktopFullAccess();
    expect(getAgentMode()).toBe("auto");
    expect(isCapabilityEnabled("computer")).toBe(true);
    expect(isCapabilityEnabled("agent_computers")).toBe(false);
  });
});
