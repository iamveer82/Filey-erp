import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalArgs, redactArgs, runTool, TOOLS } from "../aiTools";
import { setCacheOrg } from "../api";
import { clearLog, logAsText } from "../log";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  setCacheOrg("letter-privacy-test", "fixture-user");
  clearLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  clearLog();
  setCacheOrg(null);
});

const letter = () => ({
  title: "Private authorization title",
  recipient_name: "Private recipient",
  recipient_address: "Private address",
  salutation: "Private salutation",
  body: "Private employee identifier and delegated authority",
  closing: "Private closing",
  signatory_name: "Private signatory",
  signatory_title: "Private role",
  issue_date: "2026-01-01",
  template: "letter-formal",
  show_reference: false,
  text_style: { fontSize: 12, lineSpacing: 1.15 },
  blocks: [
    { type: "text", text: "Private paragraph", align: "left", style: { bold: true } },
    { type: "field", label: "Private contact label", value: "Private contact value", align: "left" },
    { type: "date", label: "Private date label", value: "2027-01-01", align: "right" },
    { type: "signature", label: "Private sign-off label", align: "left" },
  ],
});

describe("letter diagnostics and approval privacy", () => {
  it.each(["create_letter_draft", "revise_letter_draft"])("keeps %s private text out of the actual console and diagnostic log", async name => {
    const args = name === "create_letter_draft" ? letter() : { letter_id: "letter-1", expected_revision: 2, changes: letter() };
    const tool = TOOLS.find(candidate => candidate.name === name)!;
    const execute = vi.spyOn(tool, "run").mockResolvedValue({ ok: true });
    const consoleLog = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await runTool(name, args, undefined, true)).toEqual({ ok: true });
    // Tool execution still receives the exact content, but its observer paths
    // receive only the redacted copy. No document is written by this fixture.
    expect(execute).toHaveBeenCalledWith(args, undefined);
    expect(logAsText()).toContain(`${name} running`);
    expect(logAsText()).not.toContain("Private");
    expect(JSON.stringify(consoleLog.mock.calls)).not.toContain("Private");
  });

  it.each(["create_letter_draft", "revise_letter_draft"])("masks %s content recursively while preserving useful diagnostic metadata", name => {
    const content = letter();
    const args = name === "create_letter_draft" ? content : { letter_id: "letter-1", expected_revision: 2, changes: content };
    const before = structuredClone(args);
    const diagnostic = redactArgs(name, args);
    const redacted = (name === "create_letter_draft" ? diagnostic : diagnostic.changes) as Record<string, unknown>;
    for (const key of ["title", "recipient_name", "recipient_address", "salutation", "body", "closing", "signatory_name", "signatory_title"])
      expect(redacted[key]).toBe("********");
    expect(redacted).toMatchObject({ issue_date: "2026-01-01", template: "letter-formal", show_reference: false,
      text_style: { fontSize: 12, lineSpacing: 1.15 }, blocks: [
        { type: "text", text: "********", align: "left", style: { bold: true } },
        { type: "field", label: "********", value: "********", align: "left" },
        { type: "date", label: "********", value: "********", align: "right" },
        { type: "signature", label: "********", align: "left" },
      ] });
    expect(JSON.stringify(diagnostic)).not.toContain("Private");
    if (name === "revise_letter_draft") expect(diagnostic).toMatchObject({ letter_id: "letter-1", expected_revision: 2 });
    expect(args).toEqual(before);
    // Manual approval still shows exactly what will be saved, never the
    // masked diagnostic copy. The underlying input is untouched either way.
    expect(approvalArgs(name, args)).toEqual(before);
    expect(args).toEqual(before);
  });

  it.each(["create_letter_draft", "revise_letter_draft"])("keeps injected secret keys masked in %s approvals as well as diagnostics", name => {
    const content = { ...letter(), api_key: "private-key", text_style: { fontSize: 12, password: "private-password" },
      blocks: [{ type: "field", label: "Contact", value: "Visible requested value", extra: [[{ token: "private-token", text: "Visible proposal" }]] }] };
    const args = name === "create_letter_draft" ? content : { letter_id: "letter-1", expected_revision: 2, changes: content, credentials: "private-credentials" };
    const original = structuredClone(args);
    const preview = approvalArgs(name, args);
    const approvedContent = (name === "create_letter_draft" ? preview : preview.changes) as Record<string, unknown>;
    expect(approvedContent).toMatchObject({ body: letter().body, api_key: "********", text_style: { fontSize: 12, password: "********" },
      blocks: [{ type: "field", label: "Contact", value: "Visible requested value", extra: [[{ token: "********", text: "Visible proposal" }]] }] });
    if (name === "revise_letter_draft") expect(preview.credentials).toBe("********");
    const combined = `${JSON.stringify(preview)} ${JSON.stringify(redactArgs(name, args))}`;
    for (const secret of ["private-key", "private-password", "private-token", "private-credentials"]) expect(combined).not.toContain(secret);
    expect(args).toEqual(original);
  });

  it("keeps non-letter redaction behavior and requested record IDs unchanged", () => {
    const args = { body: "Requested content", rows: [[{ api_key: "private-key" }]] };
    expect(redactArgs("create_campaign", args)).toEqual({ body: "Requested content", rows: [[{ api_key: "********" }]] });
    expect(redactArgs("get_letter", { letter_id: "letter-1" })).toEqual({ letter_id: "letter-1" });
  });
});
