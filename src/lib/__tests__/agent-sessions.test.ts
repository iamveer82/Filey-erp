import { beforeEach, expect, it } from "vitest";
import { setCacheOrg } from "../api";
import { loadChats, newChat, saveChats } from "../aiChats";
import { getPersona, setPersona } from "../ai";
import { waLogAdd } from "../waLog";
import { searchConversations, whatsappContext } from "../agentSessions";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("session-fixture", "alice");
});

it("recovers channel context after restart, resets it on /new, and preserves searchable history", () => {
  waLogAdd({ dir: "in", from: "971500000001", text: "Use the blue brochure" });
  waLogAdd({ dir: "out", from: "971500000001", text: "The brochure is ready." });
  expect(whatsappContext("971500000001")).toHaveLength(2);
  waLogAdd({ dir: "in", from: "971500000001", text: "/new", sessionStart: true });
  expect(whatsappContext("971500000001")).toEqual([]);
  saveChats([{ ...newChat(), title: "Brochure planning", turns: [{ role: "user", text: "Make a brochure for Acme" }] }]);
  expect(searchConversations("brochure").map(hit => hit.channel).sort()).toEqual(["filey", "whatsapp"]);
  setCacheOrg("session-fixture", "bob");
  expect(searchConversations("brochure")).toEqual([]);
  expect(whatsappContext("971500000001")).toEqual([]);
});

it("keeps interactive cards and widgets in chat history", () => {
  const ui = [
    { title: "Break-even", html: "<div id=x></div>", jsFunctions: "function go(){}", jsExpressions: ["go()"] },
    { kind: "view" as const, view: "bar" as const, title: "Sales", labels: ["Jan"], series: [{ name: "AED", values: [5] }] },
    { kind: "view", view: "nope" },
  ];
  saveChats([{ ...newChat(), turns: [{ role: "user", text: "chart it" }, { role: "assistant", text: "Here", ui: ui as never }] }]);
  const saved = loadChats()[0].turns[1].ui;
  expect(saved).toHaveLength(2);
  expect(saved?.[0]).toMatchObject({ title: "Break-even", jsExpressions: ["go()"] });
  expect(saved?.[1]).toMatchObject({ kind: "view", view: "bar", series: [{ name: "AED", values: [5] }] });
});

it("keeps personal settings per account while preserving them between local and cloud", () => {
  localStorage.setItem("filey.ai.persona", JSON.stringify({ userName: "Unknown previous user", role: "private role", orbColor: "#FFD600" }));
  expect(getPersona().userName).toBe("");
  setPersona({ userName: "Alice", assistantName: "Atlas", role: "Accountant", botShape: "nuage", botMotion: "orbit" });
  localStorage.setItem("filey_data_mode", "cloud");
  expect(getPersona().assistantName).toBe("Atlas");
  expect(getPersona()).toMatchObject({ botShape: "nuage", botMotion: "orbit" });
  setCacheOrg("session-fixture", "bob");
  expect(getPersona().userName).toBe("");
  expect(getPersona().role).toBe("");
  expect(getPersona()).toMatchObject({ botShape: "cercle", botMotion: "playful" });
  setCacheOrg(null);
  expect(() => setPersona({ userName: "Anonymous" })).toThrow("Sign in");
});
