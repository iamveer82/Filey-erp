// Every tool that can reach OUTSIDE the business must be `sensitive`.
//
// `sensitive` is what makes runTool consult an approval gate at all. A tool that
// emails, messages or publishes without it is one an injected prompt — or an
// unattended timer — can fire on its own. The WhatsApp spam incident was the
// gate logic rather than a missing flag, but nothing stopped the next outbound
// tool from shipping unflagged, and a reviewer will not notice one absent line
// in a 3000-line tool table.
//
// The rule is derived, not hand-listed: the email / channels / social
// capability groups ARE the set of tools that leave the building, so membership
// there implies `sensitive` unless the tool is named below with a reason.
import { describe, it, expect } from "vitest";
import { TOOLS } from "../aiTools";
import { CAPABILITIES } from "../capabilities";

/** Capability groups whose tools have effects outside the org. */
const OUTBOUND_GROUPS = ["email", "channels", "social"];

/** Tools inside those groups that legitimately need no approval, each with the
 *  reason it is safe. Adding a name here is a deliberate act — it should be
 *  obvious to a reviewer that the entry is a claim needing justification. */
const EXEMPT: Record<string, string> = {
  connect_whatsapp: "shows a pairing QR to the owner; sends nothing to anyone",
  list_social_accounts: "read-only: lists the user's own connected accounts",
  list_social_posts: "read-only: lists the user's own posts",
};

describe("outbound tools carry the sensitive flag", () => {
  const outbound = CAPABILITIES.filter((c) => OUTBOUND_GROUPS.includes(c.id)).flatMap(
    (c) => c.tools
  );

  it("covers a non-trivial set (the groups still exist and are populated)", () => {
    expect(outbound.length).toBeGreaterThan(5);
  });

  it.each(outbound)("%s is sensitive, or exempt for a stated reason", (name) => {
    const tool = TOOLS.find((t) => t.name === name);
    // A capability listing a tool that does not exist is its own bug: the
    // capability toggle silently gates nothing.
    expect(tool, `${name} is listed in a capability but not in TOOLS`).toBeDefined();

    if (EXEMPT[name]) {
      expect(tool!.sensitive ?? false).toBe(false); // exemptions must stay honest
      return;
    }
    expect(
      tool!.sensitive,
      `${name} reaches outside the org, so it must be marked \`sensitive: true\` ` +
        `in aiTools.ts — or added to EXEMPT here with the reason it is safe.`
    ).toBe(true);
  });

  // Tools that reach the owner's machine, credentials or the raw network. These
  // sit in no capability group, so `isWriteTool` is false for them and the agent
  // modes treat them as reads — which means the tool's OWN flags are the only
  // thing standing between an injected instruction and a shell command. Both
  // flags, or the mode system silently waves them through, Plan mode included.
  const POWER_TOOLS = ["run_shell", "browser", "http_fetch", "save_secret"];

  it.each(POWER_TOOLS)("%s is owner-only AND sensitive", (name) => {
    const tool = TOOLS.find((t) => t.name === name);
    expect(tool, `${name} is missing from TOOLS`).toBeDefined();
    expect(tool!.ownerOnly, `${name} must be ownerOnly`).toBe(true);
    expect(tool!.sensitive, `${name} must be sensitive`).toBe(true);
  });

  it.each(["recall_secret", "list_secrets"])("%s is at least owner-only", (name) => {
    // These read credentials rather than writing or spending, so they are not
    // required to be sensitive — but they must never be reachable by a customer.
    expect(TOOLS.find((t) => t.name === name)?.ownerOnly).toBe(true);
  });

  it("every capability's tools all exist in TOOLS", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const missing = CAPABILITIES.flatMap((c) =>
      c.tools.filter((t) => !names.has(t)).map((t) => `${c.id}/${t}`)
    );
    expect(missing).toEqual([]);
  });
});
