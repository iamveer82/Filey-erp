// Every section of the app needs a way in for the agent.
//
// A section the agent cannot read is a section it cannot answer about; a
// section it cannot write is a section it cannot work in. That gap was
// invisible to CI: the old tests checked that every APP_MAP tool EXISTS and
// that every tool is REACHABLE, but nothing said a section must have a write
// path. Purchase Orders shipped a write with no read, Follow-ups wrote to one
// store while its read tool listed another, and Settings, Team and the Comms
// log had no tools at all — all of it green.
//
// So the rule is derived from the app itself: for every section the user can
// open, the agent must have at least one tool that reads it and at least one
// that writes it, and every tool the app map names must be one the model can
// actually be offered.
import { describe, expect, it } from "vitest";
import { APP_MAP, APP_MAP_EXEMPT } from "../appMap";
import { TOOLS } from "../aiTools";
import { CORE_TOOLS, TOOLSETS } from "../toolsets";
import { MODULES } from "../../modules/registry";
import { isWriteTool } from "../capabilities";

const tool = (name: string) => TOOLS.find((t) => t.name === name);
const offered = new Set<string>([
  ...CORE_TOOLS,
  ...Object.values(TOOLSETS).flatMap((set) => set.tools),
]);

/** Sections that hold no records of their own, or that only ever show
 *  computed reports — nothing there to write. */
const NO_RECORDS = new Set([
  "agent",       // the chat the agent is in
  "overview",    // a dashboard of other sections
  "browser",     // the browser panel, not a record
  "helpdesk",    // shares the projects toolset
  "reports",     // computed read-only reports
]);

/** Every tool the areas of a section name, reads and writes together. */
function sectionTools(page: string): string[] {
  return [...new Set(APP_MAP.filter((a) => a.page === page).flatMap((a) => a.tools))];
}

describe("the agent is connected to every section", () => {
  it("gives every section a read and a write", () => {
    const gaps: string[] = [];
    for (const section of MODULES) {
      if (NO_RECORDS.has(section.id) || APP_MAP_EXEMPT.includes(section.id)) continue;
      const page = section.to.replace(/^\//, "");
      const names = sectionTools(page);
      if (!names.length) {
        gaps.push(`${section.label}: no tools at all`);
        continue;
      }
      if (!names.some((n) => !isWriteTool(n))) gaps.push(`${section.label}: no read tool`);
      if (!names.some((n) => isWriteTool(n))) gaps.push(`${section.label}: no write tool`);
    }
    expect(gaps, gaps.join("; ")).toEqual([]);
  });

  it("offers every tool the app map names", () => {
    const unreachable = APP_MAP.flatMap((a) => a.tools).filter((name) => !offered.has(name));
    expect(
      unreachable,
      "these tools are in the app map but the model is never offered them"
    ).toEqual([]);
  });

  it("gates a write so a role without the module cannot run it", () => {
    // A write the model can reach but the user's role cannot is worse than
    // no write: the agent says it did something it was not allowed to do.
    for (const name of ["update_cheque_status", "post_journal_entry", "post_team_message"]) {
      expect(tool(name)?.sensitive, `${name} must be sensitive`).toBe(true);
    }
  });
});
