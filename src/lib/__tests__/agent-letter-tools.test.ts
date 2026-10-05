import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, crm, setCacheOrg, suppliers, tools as settings } from "../api";
import { aiAgent, setAiConfig } from "../ai";
import { endTurn, isToolArgumentRejection, runTool } from "../aiTools";
import { setAgentMode } from "../agentMode";
import { setCapabilityEnabled } from "../capabilities";
import { setDataMode } from "../dataMode";
import { allocateDocumentNumber } from "../documentNumbers";
import { supabase } from "../supabase";
import { reactToPdfBytes } from "../reactPdf";
import { deliverFile } from "../agentFiles";
import * as letters from "../letters";

const fixture = vi.hoisted(() => ({ next: 1 }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return { sb: () => localClient, supabase: {
    rpc: vi.fn(async () => ({ data: { allowed: true, admin: false, modules: ["letters"] }, error: null, status: 200 })),
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: "letter-tool-user" } } }, error: null })) },
  } };
});
vi.mock("../documentNumbers", () => ({ allocateDocumentNumber: vi.fn() }));
vi.mock("../reactPdf", () => ({ reactToPdfBytes: vi.fn() }));
vi.mock("../agentFiles", () => ({ deliverFile: vi.fn() }));
vi.mock("../../components/LetterDocument", () => ({ default: () => null }));
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const PDF = new TextEncoder().encode("%PDF-1.7\nLetter tool integration\n%%EOF");
const input = (title = "Authorization letter") => ({ title, recipient_name: "Fixture Officer",
  blocks: [{ type: "text", text: "We authorize Fixture Operator to collect the requested company documents." },
    { type: "field", label: "Employee email", value: "" }, { type: "field", label: "Mobile number", value: "" }] });
const call = (name: string, args: Record<string, unknown> = {}, turnId?: string, confirm?: () => boolean | Promise<boolean>) =>
  runTool(name, args, confirm, true, turnId);
const saved = () => letters.loadLetters();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setDataMode("local");
  setCacheOrg(null);
  setCacheOrg("letter-tool-org", "letter-tool-user");
  setAgentMode("accept_edits");
  fixture.next = 1;
  vi.spyOn(billing, "getCompany").mockResolvedValue({ name: "Fixture Company", address: "Dubai", email: "", phone: "", logo: "" } as never);
  vi.spyOn(settings, "settings").mockResolvedValue([]);
  vi.mocked(allocateDocumentNumber).mockImplementation(async () => `LTR-TOOL-${fixture.next++}`);
  vi.mocked(reactToPdfBytes).mockResolvedValue({ name: "renderer.pdf", bytes: PDF });
  vi.mocked(deliverFile).mockImplementation(async file => ({ name: file.name, path: `C:/Exports/${file.name}` }));
  vi.mocked(supabase!.rpc).mockResolvedValue({ data: { allowed: true, admin: false, modules: ["letters"] }, error: null, status: 200 } as never);
});
afterEach(() => {
  for (const turn of ["letters-a", "letters-b", "letter-repeat", "letter-provider"]) endTurn(turn);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCacheOrg(null);
});

describe("letter tools use the real permission and action gates", () => {
  it("allows reads in Plan mode while blocking creation and PDF output", async () => {
    setAgentMode("plan");
    expect(await call("get_letter_context")).toMatchObject({ company: { name: "Fixture Company" } });
    expect(await call("list_letters")).toMatchObject({ count: 0, letters: [] });
    expect(await call("create_letter_draft", input())).toMatchObject({ error: expect.stringContaining("Plan mode") });
    expect(await call("export_letter_pdf", { letter_id: "fixture-id" })).toMatchObject({ error: expect.stringContaining("Plan mode") });
    expect(await saved()).toEqual([]);
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
    expect(deliverFile).not.toHaveBeenCalled();
  });

  it("requires manual approval and saves exactly one draft once approved", async () => {
    setAgentMode("manual");
    const refuse = vi.fn(() => false), approve = vi.fn(() => true);
    expect(await call("create_letter_draft", input(), undefined, refuse)).toMatchObject({ error: expect.stringContaining("did not approve") });
    expect(await saved()).toEqual([]);
    expect(await call("create_letter_draft", input(), undefined, approve)).toMatchObject({ ok: true, status: "draft", revision: 1 });
    expect(refuse).toHaveBeenCalledOnce();
    expect(approve).toHaveBeenCalledOnce();
    expect(await saved()).toHaveLength(1);
  });

  it("blocks all letter tools when Company letters is disabled", async () => {
    setCapabilityEnabled("letters", false);
    for (const [name, args] of [
      ["get_letter_context", {}], ["list_letters", {}], ["get_letter", { letter_id: "fixture-id" }],
      ["create_letter_draft", input()], ["revise_letter_draft", { letter_id: "fixture-id", expected_revision: 1, changes: { title: "Edit" } }],
      ["export_letter_pdf", { letter_id: "fixture-id" }],
    ] as const) expect(await call(name, args)).toMatchObject({ error: expect.stringContaining("turned off") });
    expect(billing.getCompany).not.toHaveBeenCalled();
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
    expect(await saved()).toEqual([]);
  });

  it("permits company context for a cloud letter member without Settings administrator rights", async () => {
    setDataMode("cloud");
    expect(await call("get_letter_context")).toMatchObject({ company: { name: "Fixture Company" } });
    expect(supabase!.rpc).toHaveBeenCalledWith("filey_module_access");
  });

  it("denies a cloud member without letters permission before any company data read", async () => {
    setDataMode("cloud");
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: { allowed: true, admin: false, modules: ["customers"] }, error: null, status: 200 } as never);
    expect(await call("get_letter_context")).toMatchObject({ error: expect.stringContaining("access to letters") });
    expect(billing.getCompany).not.toHaveBeenCalled();
    expect(settings.settings).not.toHaveBeenCalled();
  });
});

describe("validated letter writes and output ownership", () => {
  it("rejects status, private asset URLs and supplied block IDs before saving", async () => {
    const write = vi.spyOn(letters, "saveLetter");
    for (const extra of [{ status: "issued" }, { signature: { data: "private-image" } }, { show_stamp: true },
      { company_logo: "https://untrusted.test/logo.png" }, { blocks: [{ type: "text", text: "Text", id: "model-id" }] }])
      expect(await call("create_letter_draft", { ...input(), ...extra })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    expect(write).not.toHaveBeenCalled();
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
  });

  it("marks safe helper preflights but leaves uncertain save failures unsafe to repeat", async () => {
    const invalid = await call("create_letter_draft", { title: "Letter", blocks: [{ type: "field", label: "Name" }] });
    expect(invalid).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    expect(isToolArgumentRejection(invalid)).toBe(true);
    const create = await call("create_letter_draft", input()) as { id: string; revision: number };
    expect(await call("revise_letter_draft", { letter_id: create.id, expected_revision: 999, changes: { title: "Stale" } })).toMatchObject({ code: "invalid_arguments", retry_safe: true });
    vi.spyOn(letters, "saveLetter").mockRejectedValueOnce(new Error("Letter save acknowledgement unavailable"));
    const uncertain = await call("revise_letter_draft", { letter_id: create.id, expected_revision: create.revision, changes: { title: "Changed" } });
    expect(uncertain).toMatchObject({ error: expect.stringContaining("acknowledgement"), retry_safe: false });
    expect(isToolArgumentRejection(uncertain)).toBe(false);
  });

  it("keeps concurrent exports with their originating turn even when they finish in reverse order", async () => {
    const first = await call("create_letter_draft", input("First letter")) as { id: string };
    const second = await call("create_letter_draft", input("Second letter")) as { id: string };
    let finishFirst!: () => void;
    const held = new Promise<void>(resolve => { finishFirst = resolve; });
    vi.mocked(reactToPdfBytes).mockImplementation(async (_node, name) => {
      if (name.includes("First letter")) await held;
      return { name: `${name}.pdf`, bytes: PDF };
    });
    const exportingFirst = call("export_letter_pdf", { letter_id: first.id }, "letters-a");
    await vi.waitFor(() => expect(reactToPdfBytes).toHaveBeenCalledOnce());
    expect(await call("export_letter_pdf", { letter_id: second.id }, "letters-b")).toMatchObject({ ok: true });
    finishFirst();
    expect(await exportingFirst).toMatchObject({ ok: true });
    expect(endTurn("letters-a")).toEqual([expect.objectContaining({ documentKey: `letter:${first.id}`, name: expect.stringContaining("First letter") })]);
    expect(endTurn("letters-b")).toEqual([expect.objectContaining({ documentKey: `letter:${second.id}`, name: expect.stringContaining("Second letter") })]);
  });

  it("replaces only the same document's prior output while retaining another exported letter", async () => {
    const first = await call("create_letter_draft", input("First letter")) as { id: string };
    const second = await call("create_letter_draft", input("Second letter")) as { id: string };
    await call("export_letter_pdf", { letter_id: first.id }, "letter-repeat");
    await call("export_letter_pdf", { letter_id: second.id }, "letter-repeat");
    await call("export_letter_pdf", { letter_id: first.id }, "letter-repeat");
    const outputs = endTurn("letter-repeat");
    expect(outputs).toHaveLength(2);
    expect(outputs.filter(output => output.documentKey === `letter:${first.id}`)).toHaveLength(1);
    expect(outputs.some(output => output.documentKey === `letter:${second.id}`)).toBe(true);
  });
});

it("completes the real context→draft→read-back chat workflow using a scripted provider", async () => {
  setAgentMode("accept_edits");
  setAiConfig({ provider: "openai", baseUrl: "https://example.test/v1", model: "letter-fixture", apiKey: "fixture-only" });
  const customers = vi.spyOn(crm, "customers").mockResolvedValue([]), vendors = vi.spyOn(suppliers, "list").mockResolvedValue([]);
  const requests: { messages: { role: string; content: string }[]; tools: { function: { name: string } }[] }[] = [];
  const toolCall = (name: string, args: Record<string, unknown>) => ({ role: "assistant", content: "", tool_calls: [
    { id: `letter-call-${requests.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
  ] });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as typeof requests[number];
    requests.push(request);
    const lastTool = [...request.messages].reverse().find(message => message.role === "tool");
    const observed = lastTool ? JSON.parse(lastTool.content) as { id: string; url: string; status: string } : null;
    const message = requests.length === 1 ? toolCall("get_letter_context", {})
      : requests.length === 2 ? toolCall("create_letter_draft", input())
        : requests.length === 3 ? toolCall("get_letter", { letter_id: observed!.id })
          : { role: "assistant", content: `Saved an editable draft. [Open letter](${observed!.url})` };
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }));
  const response = await aiAgent([{ role: "user", text: "Make an authorization letter for Fixture Operator to collect our company documents. Their email and mobile are unknown; save a draft." }],
    { isOwner: true, turnId: "letter-provider", maxRounds: 6 });
  expect(requests).toHaveLength(4);
  expect(requests[0].tools.map(tool => tool.function.name)).toEqual(expect.arrayContaining(["get_letter_context", "create_letter_draft", "get_letter"]));
  const records = await saved();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ form: { status: "draft", recipient_name: "Fixture Officer", company_name: "Fixture Company", show_signature: false, show_stamp: false },
    issued_at: null, issued_snapshot: null });
  expect(records[0].form.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Employee email", value: "" }), expect.objectContaining({ label: "Mobile number", value: "" })]));
  expect(response).toContain(`#/letters?letter=${encodeURIComponent(records[0].id)}`);
  expect(customers).not.toHaveBeenCalled();
  expect(vendors).not.toHaveBeenCalled();
  expect(deliverFile).not.toHaveBeenCalled();
});
