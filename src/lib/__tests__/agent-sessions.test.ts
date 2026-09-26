import { beforeEach, expect, it } from "vitest";
import { setCacheOrg } from "../api";
import { newChat, saveChats } from "../aiChats";
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

it("keeps personal settings per account while preserving them between local and cloud", () => {
  localStorage.setItem("filey.ai.persona", JSON.stringify({ userName: "Unknown previous user", role: "private role", orbColor: "#FFD600" }));
  expect(getPersona().userName).toBe("");
  setPersona({ userName: "Alice", assistantName: "Atlas", role: "Accountant" });
  localStorage.setItem("filey_data_mode", "cloud");
  expect(getPersona().assistantName).toBe("Atlas");
  setCacheOrg("session-fixture", "bob");
  expect(getPersona().userName).toBe("");
  expect(getPersona().role).toBe("");
  setCacheOrg(null);
  expect(() => setPersona({ userName: "Anonymous" })).toThrow("Sign in");
});
