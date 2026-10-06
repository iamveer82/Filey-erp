import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billing, tools } from "../api";
import { requireModuleAccess } from "../moduleAccess";
import { allocateDocumentNumber } from "../documentNumbers";
import * as letters from "../letters";
import { letterRichDocumentToLegacy, letterRichText, type LetterRichDocument } from "../letterRichText";
import { reactToPdfBytes } from "../reactPdf";
import { deliverFile } from "../agentFiles";
import {
  createAgentLetterDraft, exportAgentLetterDraft, getAgentLetter, getAgentLetterContext,
  listAgentLetters, reviseAgentLetterDraft, letterEditableProperties, isLetterArgumentError,
} from "../agentLetters";

const identity = vi.hoisted(() => ({ scope: "letters-org:user:letters-user", epoch: 1, next: 1 }));
vi.mock("../api", () => ({
  getCacheScope: () => identity.scope || null, getCacheIdentity: () => identity.epoch,
  billing: { getCompany: vi.fn() }, tools: { settings: vi.fn() },
}));
vi.mock("../moduleAccess", () => ({ requireModuleAccess: vi.fn(async () => {}) }));
vi.mock("../documentNumbers", () => ({ allocateDocumentNumber: vi.fn() }));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return { sb: () => localClient, supabase: null };
});
vi.mock("../reactPdf", () => ({ reactToPdfBytes: vi.fn() }));
vi.mock("../agentFiles", () => ({ deliverFile: vi.fn() }));
vi.mock("../../components/LetterDocument", () => ({ default: () => null }));

const PDF = new TextEncoder().encode("%PDF-1.7\nLetter regression output\n%%EOF");
const company = { name: "Example Trading", address: "Dubai", email: "", phone: "", trn: "", logo: "letters-user/company/logo.png" };
const settings = [
  { key: "company_letterhead", value: JSON.stringify({ background: "letters-user/company/letterhead.png" }) },
  { key: "company_signature", value: JSON.stringify({ data: "letters-user/company/private-signature.png" }) },
  { key: "company_stamp", value: JSON.stringify({ data: "letters-user/company/private-stamp.png" }) },
  { key: "letter_number_format", value: "LTR-{0001}" },
];
const draftArgs = () => ({ title: "Authorization letter", body: "We authorize the employee for the stated work.",
  blocks: [{ type: "field", label: "Employee email", value: "" }, { type: "signature", label: "Authorized signature" }, { type: "stamp", label: "Company stamp" }] });
const create = () => createAgentLetterDraft(draftArgs());
const stored = () => JSON.parse(localStorage.getItem("localdb:app_settings") || "[]") as { key: string; value: string }[];
const records = () => {
  const row = stored().find(row => row.key === letters.LETTER_SETTING_KEY);
  return row ? JSON.parse(row.value) as letters.LetterRecord[] : [];
};
const aba = () => { identity.scope = "other-org:user:other-user"; identity.epoch++; identity.scope = "letters-org:user:letters-user"; identity.epoch++; };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  identity.scope = "letters-org:user:letters-user";
  identity.epoch++;
  identity.next = 1;
  vi.mocked(requireModuleAccess).mockResolvedValue();
  vi.mocked(billing.getCompany).mockResolvedValue({ ...company } as never);
  vi.mocked(tools.settings).mockResolvedValue(settings as never);
  vi.mocked(allocateDocumentNumber).mockImplementation(async () => `LTR-${String(identity.next++).padStart(4, "0")}`);
  vi.mocked(reactToPdfBytes).mockResolvedValue({ name: "renderer.pdf", bytes: PDF });
  vi.mocked(deliverFile).mockImplementation(async file => ({ name: file.name, path: `C:/Exports/${file.name}` }));
});
afterEach(() => vi.restoreAllMocks());

describe("letter context and draft preparation", () => {
  it("provides company context and availability without private images or credentials", async () => {
    const context = await getAgentLetterContext({});
    expect(context).toMatchObject({ company: { name: "Example Trading", email: "", phone: "" },
      assets_available: { letterhead: true, logo: true, signature: true, stamp: true },
      defaults: { show_signature: false, show_stamp: false, show_reference: false, show_logo: false }, navigation: "/letters" });
    expect(JSON.stringify(context)).not.toContain("letters-user/company/");
    expect(requireModuleAccess).toHaveBeenCalledExactlyOnceWith("letters");
    expect(records()).toEqual([]);
  });

  it("saves a numbered editable draft while keeping missing facts blank and saved marks unused", async () => {
    const saved = await create();
    expect(saved).toMatchObject({ ok: true, number: "LTR-0001", revision: 1, status: "draft", navigation: "/letters",
      url: `#/letters?letter=${encodeURIComponent(saved.id)}`,
      field_names_needing_completion: expect.arrayContaining(["recipient_name", "signatory_name", "signatory_title", "blocks.0.value"]) });
    expect(records()[0]).toMatchObject({ id: saved.id, issued_at: null, issued_snapshot: null,
      form: { company_name: "Example Trading", company_email: "", recipient_name: "", signatory_name: "",
        use_letterhead: true, show_company_header: false, show_logo: false, show_reference: false, show_signature: false, show_stamp: false } });
    expect(records()[0].form).not.toHaveProperty("signature");
    expect(records()[0].form).not.toHaveProperty("stamp");
    expect(allocateDocumentNumber).toHaveBeenCalledExactlyOnceWith("letter", [], { letter: "LTR-{0001}" });
  });

  it("retains ordered editable blocks, date fields and per-block formatting with generated IDs", async () => {
    const saved = await createAgentLetterDraft({ title: "Custom letter", blocks: [
      { type: "text", text: "Approved wording", align: "center", style: { bold: true, fontSize: 12 } },
      { type: "date", label: "Valid until", value: "2027-03-01", align: "right" },
      { type: "field", label: "Employee name", value: "" },
    ], text_style: { fontSize: 11, lineSpacing: 1.15, paragraphSpacing: 0 } });
    const form = records().find(record => record.id === saved.id)!.form;
    expect(form.blocks.map(block => block.type)).toEqual(["text", "date", "field"]);
    expect(new Set(form.blocks.map(block => block.id)).size).toBe(3);
    expect(form.blocks[0]).toMatchObject({ text: "Approved wording", align: "center", style: { bold: true, fontSize: 12 } });
    expect(form.text_style).toMatchObject({ lineSpacing: 1.15, paragraphSpacing: 0 });
  });

  it("does not duplicate the letterhead logo unless explicitly requested", async () => {
    const requested = await createAgentLetterDraft({ title: "Logo requested", show_logo: true });
    expect(records().find(record => record.id === requested.id)!.form.show_logo).toBe(true);
    vi.mocked(tools.settings).mockResolvedValue([]);
    const plain = await createAgentLetterDraft({ title: "Plain company header" });
    expect(records().find(record => record.id === plain.id)!.form).toMatchObject({ use_letterhead: false, show_company_header: true, show_logo: true });
  });

  it("lists/reads saved IDs and content without exposing company image references", async () => {
    const saved = await create();
    await createAgentLetterDraft({ title: "Other letter" });
    expect(await listAgentLetters({ query: "authorization", status: "draft", limit: 1 })).toMatchObject({ count: 1,
      letters: [expect.objectContaining({ id: saved.id, revision: 1 })] });
    const read = await getAgentLetter({ letter_id: saved.id });
    expect(read).toMatchObject({ form: { body: draftArgs().body, blocks: [expect.objectContaining({ type: "field" }),
      expect.objectContaining({ type: "signature" }), expect.objectContaining({ type: "stamp" })] } });
    expect(JSON.stringify(read)).not.toContain("letters-user/company/");
    expect(((read.form as Record<string, unknown>).blocks as Record<string, unknown>[])[0]).not.toHaveProperty("id");
    await expect(getAgentLetter({ letter_id: "Authorization letter" })).rejects.toThrow("exact ID");
  });
});

describe("draft boundaries and optimistic revisions", () => {
  it("changes only requested fields and explicitly preserves empty/false/zero formatting choices", async () => {
    const saved = await create();
    const original = records()[0].form;
    const revised = await reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: saved.revision,
      changes: { closing: "", show_logo: false, show_reference: false, text_style: { fontSize: 11, paragraphSpacing: 0 } } });
    expect(revised).toMatchObject({ id: saved.id, number: saved.number, revision: 2 });
    expect(records()[0].form).toMatchObject({ ...original, closing: "", show_logo: false, text_style: { fontSize: 11, paragraphSpacing: 0 } });
    await expect(reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: 1, changes: { title: "Stale overwrite" } })).rejects.toThrow("changed");
    expect(records()[0].form.title).toBe(original.title);
  });

  it("never edits or reissues an issued letter", async () => {
    const saved = await create(), record = records()[0];
    const issued = await letters.saveLetter({ ...record.form, status: "issued" }, record.id, record.revision, record.updated_at);
    const before = JSON.stringify(records());
    await expect(reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: issued.revision, changes: { body: "Changed" } })).rejects.toThrow("Issued letters cannot be edited");
    expect(JSON.stringify(records())).toBe(before);
  });

  it("rejects privileged fields, supplied IDs, malformed content and unknown formatting before reserving a number", async () => {
    for (const args of [
      { title: "Letter", status: "issued" }, { title: "Letter", number: "MY-NUMBER" }, { title: "Letter", company_logo: "https://example.test/logo.png" },
      { title: "Letter", signature: { data: "private" } }, { title: "Letter", show_signature: true },
      { title: "Letter", blocks: [{ type: "text", text: "Text", id: "model-id" }] },
      { title: "Letter", blocks: [{ type: "field", label: "Contact" }] },
      { title: "Letter", blocks: [{ type: "stamp", label: "Stamp", value: "https://example.test/image" }] },
      { title: "Letter", text_style: { fontSize: 11, unexpected: "ignored" } },
      { title: "Letter", issue_date: "2026-02-31" }, { title: "Letter", blocks: [{ type: "date", label: "Until", value: "2026-02-31" }] },
    ]) await expect(createAgentLetterDraft(args)).rejects.toThrow();
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
    expect(letterEditableProperties).not.toHaveProperty("company_logo");
    expect(letterEditableProperties).not.toHaveProperty("status");
  });

  it("reports missing image setup instead of quietly exporting unbranded output", async () => {
    vi.mocked(tools.settings).mockResolvedValue([]);
    await expect(createAgentLetterDraft({ title: "Letter", use_letterhead: true })).rejects.toThrow("Add company letterhead");
    expect(records()).toEqual([]);
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
  });

  it("does not claim a successful write without a valid saved acknowledgement", async () => {
    vi.spyOn(letters, "saveLetter").mockResolvedValue({ id: "", revision: 1 } as never);
    await expect(create()).rejects.toThrow("save could not be confirmed");
  });

  it("marks safe argument corrections while preserving uncertain save failures", async () => {
    const invalid = await createAgentLetterDraft({ title: "Letter", issue_date: "2026-02-31" }).catch(error => error);
    expect(isLetterArgumentError(invalid)).toBe(true);
    const saved = await create();
    const stale = await reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: 10, changes: { title: "Changed" } }).catch(error => error);
    expect(isLetterArgumentError(stale)).toBe(true);
    const failure = new Error("Write response was lost");
    vi.spyOn(letters, "saveLetter").mockRejectedValueOnce(failure);
    const uncertain = await reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: saved.revision, changes: { title: "Changed" } }).catch(error => error);
    expect(uncertain).toBe(failure);
    expect(isLetterArgumentError(uncertain)).toBe(false);
    expect(isLetterArgumentError(new Error("Enter a valid letter"))).toBe(false);
  });

  it("preserves unmentioned format properties and allows an explicit full content rewrite", async () => {
    const saved = await createAgentLetterDraft({ title: "Letter", body: "Old introduction", blocks: [{ type: "text", text: "Old authorization" }],
      text_style: { fontSize: 11, lineSpacing: 1.15, paragraphSpacing: 6 } });
    await reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: saved.revision,
      changes: { body: "", blocks: [{ type: "text", text: "Replacement authorization" }], text_style: { fontSize: 12 } } });
    expect(records()[0].form).toMatchObject({ body: "", text_style: { fontSize: 12, lineSpacing: 1.15, paragraphSpacing: 6 },
      blocks: [expect.objectContaining({ text: "Replacement authorization" })] });
    expect(JSON.stringify(records()[0].form)).not.toContain("Old authorization");
  });

  it("refuses malformed stored company assets before allocating or saving", async () => {
    vi.mocked(tools.settings).mockResolvedValue([{ key: "company_letterhead", value: JSON.stringify({ background: "https://unverified.test/company.png" }) }] as never);
    await expect(create()).rejects.toThrow("saved company image");
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });
});

describe("workspace, role and cancellation safety", () => {
  it("checks letters role before reading company data or generating a number", async () => {
    vi.mocked(requireModuleAccess).mockRejectedValue(new Error("Letters access denied"));
    await expect(create()).rejects.toThrow("access denied");
    expect(billing.getCompany).not.toHaveBeenCalled();
    expect(tools.settings).not.toHaveBeenCalled();
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });

  it("rejects a signed-out workspace and an already canceled task before reads", async () => {
    identity.scope = "";
    await expect(listAgentLetters({})).rejects.toThrow("Sign in");
    identity.scope = "letters-org:user:letters-user";
    const controller = new AbortController(); controller.abort();
    await expect(createAgentLetterDraft(draftArgs(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(requireModuleAccess).not.toHaveBeenCalled();
  });

  it("revokes A→B→A while awaiting module permission before any business read", async () => {
    vi.mocked(requireModuleAccess).mockImplementationOnce(async () => { aba(); });
    await expect(getAgentLetterContext({})).rejects.toMatchObject({ name: "AbortError" });
    expect(billing.getCompany).not.toHaveBeenCalled();
  });

  it("revokes workspace changes during company lookup and does not reserve or save", async () => {
    vi.mocked(billing.getCompany).mockImplementationOnce(async () => { aba(); return company as never; });
    await expect(create()).rejects.toMatchObject({ name: "AbortError" });
    expect(allocateDocumentNumber).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });

  it("checks the execution epoch inside the actual queued save before mutation", async () => {
    let reads = 0;
    vi.mocked(requireModuleAccess).mockImplementation(async () => { if (++reads === 3) aba(); });
    await expect(create()).rejects.toMatchObject({ name: "AbortError" });
    expect(records()).toEqual([]);
  });

  it("rejects a canceled queued create and an A→B→A revision before the actual write", async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.mocked(requireModuleAccess).mockImplementation(async () => { if (++calls === 3) controller.abort(); });
    await expect(createAgentLetterDraft(draftArgs(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(records()).toEqual([]);
    vi.mocked(requireModuleAccess).mockResolvedValue();
    const saved = await create(), before = JSON.stringify(records());
    calls = 0;
    vi.mocked(requireModuleAccess).mockImplementation(async () => { if (++calls === 3) aba(); });
    await expect(reviseAgentLetterDraft({ letter_id: saved.id, expected_revision: saved.revision, changes: { title: "Stale edit" } })).rejects.toMatchObject({ name: "AbortError" });
    expect(JSON.stringify(records())).toBe(before);
  });
});

describe("letter PDF outputs", () => {
  it("uses the saved draft renderer, produces a turn-scoped output and changes no status", async () => {
    const saved = await create(), before = JSON.stringify(records());
    const exported = await exportAgentLetterDraft({ letter_id: saved.id });
    expect(exported).toMatchObject({ result: { ok: true, id: saved.id, status: "draft", file: "LTR-0001-Authorization letter.pdf" },
      output: { documentKey: `letter:${saved.id}`, path: "C:/Exports/LTR-0001-Authorization letter.pdf" } });
    const [node] = vi.mocked(reactToPdfBytes).mock.calls[0];
    expect((node as ReactElement<{ form: letters.LetterForm }>).props.form).toEqual(records()[0].form);
    expect(JSON.stringify(records())).toBe(before);
  });

  it("exports the original immutable issued snapshot without changing its status", async () => {
    await create();
    const draft = records()[0], issued = await letters.saveLetter({ ...draft.form, status: "issued" }, draft.id, draft.revision, draft.updated_at);
    const before = JSON.stringify(records());
    expect(await exportAgentLetterDraft({ letter_id: issued.id })).toMatchObject({ result: { ok: true, status: "issued" } });
    const [node] = vi.mocked(reactToPdfBytes).mock.calls[0];
    expect((node as ReactElement<{ form: letters.LetterForm }>).props.form).toEqual(issued.issued_snapshot);
    expect(JSON.stringify(records())).toBe(before);
  });

  it("does not deliver a canceled or stale render, nor claim an invalid PDF was exported", async () => {
    const saved = await create();
    vi.mocked(reactToPdfBytes).mockImplementationOnce(async () => { aba(); return { name: "letter.pdf", bytes: PDF }; });
    await expect(exportAgentLetterDraft({ letter_id: saved.id })).rejects.toMatchObject({ name: "AbortError" });
    expect(deliverFile).not.toHaveBeenCalled();
    vi.mocked(reactToPdfBytes).mockResolvedValueOnce({ name: "letter.pdf", bytes: new Uint8Array() });
    await expect(exportAgentLetterDraft({ letter_id: saved.id })).rejects.toThrow("could not be generated");
    expect(deliverFile).not.toHaveBeenCalled();
  });

  it("reports save failure and revokes a blob created after the workspace changes", async () => {
    const saved = await create();
    vi.mocked(deliverFile).mockResolvedValueOnce({ name: "letter.pdf" });
    await expect(exportAgentLetterDraft({ letter_id: saved.id })).rejects.toThrow("could not be saved");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.mocked(deliverFile).mockImplementationOnce(async file => { aba(); return { name: file.name, url: "blob:obsolete-letter" }; });
    await expect(exportAgentLetterDraft({ letter_id: saved.id })).rejects.toMatchObject({ name: "AbortError" });
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:obsolete-letter");
  });
});

describe("Word canvas agent revisions", () => {
  const richDocument = (): LetterRichDocument => ({ type: "doc", content: [
    { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Authorization letter", marks: [{ type: "bold" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "Recipient and address" }] },
    { type: "paragraph", content: [{ type: "text", text: "Original authorized responsibilities", marks: [
      { type: "italic" }, { type: "textStyle", attrs: { fontFamily: "Lora", fontSize: "12.5pt", color: "#112233" } },
    ] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First responsibility" }] }] }] },
    { type: "companySignature", attrs: { label: "Authorized signature", textAlign: "right" } },
  ] });
  const saveRich = (rich = richDocument()) => letters.saveLetter({ ...letters.blankLetterForm("LTR-WORD"),
    title: "Authorization letter", company_name: "Example Trading", recipient_name: "Old separate recipient", salutation: "Old separate salutation",
    closing: "Old separate closing", signatory_name: "Old separate signer", signatory_title: "Old separate role",
    ...letterRichDocumentToLegacy(rich), rich_document: rich });

  it("reads full canvas prose and editing guidance without exposing company assets", async () => {
    const draft = await saveRich();
    const read = await getAgentLetter({ letter_id: draft.id });
    expect(read).toMatchObject({ editing_mode: "document", document_text: letterRichText(draft.form.rich_document!),
      editing_guidance: expect.stringContaining("complete new body") });
    expect(read.field_names_needing_completion).not.toContain("recipient_name");
    expect(JSON.stringify(read)).not.toContain("letters-user/company/");
    expect(read.form).not.toHaveProperty("rich_document");
  });

  it("finds canvas wording without matching obsolete separate recipient fields", async () => {
    const draft = await saveRich();
    expect(await listAgentLetters({ query: "First responsibility" })).toMatchObject({ count: 1, letters: [{ id: draft.id, recipient_name: "" }] });
    expect(await listAgentLetters({ query: "Old separate recipient" })).toMatchObject({ count: 0, letters: [] });
  });

  it("makes explicit body rewrites visible without stale prose or duplicate titles, retaining company slots", async () => {
    const draft = await saveRich();
    await reviseAgentLetterDraft({ letter_id: draft.id, expected_revision: draft.revision,
      changes: { body: "Authorization letter\nWe authorize the employee for the updated eDAS responsibilities." } });
    const saved = records()[0];
    expect(saved.form.rich_document).toBeDefined();
    const text = letterRichText(saved.form.rich_document!);
    expect(text).toContain("updated eDAS responsibilities");
    expect(text.split("Authorization letter")).toHaveLength(2);
    expect(text).not.toContain("Original authorized responsibilities");
    expect(text).not.toContain("Old separate");
    expect(saved.form.rich_document!.content.filter(node => node.type === "companySignature")).toEqual([
      { type: "companySignature", attrs: { label: "Authorized signature", textAlign: "right" } },
    ]);
    expect(saved.form).toMatchObject({ recipient_name: "", recipient_address: "", salutation: "", closing: "", signatory_name: "", signatory_title: "" });
  });

  it("drops old projected text chunks when replacing a canvas longer than the legacy body limit", async () => {
    const rich = richDocument();
    rich.content.splice(1, 0, { type: "paragraph", content: [{ type: "text", text: "Original prefix ".repeat(4000) + "OLD_TAIL_MUST_BE_REMOVED" }] });
    const draft = await saveRich(rich);
    expect(draft.form.body).toHaveLength(50_000);
    expect(draft.form.blocks.some(block => block.type === "text")).toBe(true);
    await reviseAgentLetterDraft({ letter_id: draft.id, expected_revision: draft.revision,
      changes: { body: "Authorization letter\nEntirely replacement wording." } });
    const saved = records()[0];
    expect(letterRichText(saved.form.rich_document!)).toBe("Authorization letter\nEntirely replacement wording.\n");
    expect(JSON.stringify(saved.form)).not.toContain("OLD_TAIL_MUST_BE_REMOVED");
    expect(saved.form.blocks.every(block => block.type === "signature" || block.type === "stamp")).toBe(true);
  });

  it("retains the exact rich AST and marks for metadata-only revisions", async () => {
    const draft = await saveRich(), rich = structuredClone(draft.form.rich_document);
    await reviseAgentLetterDraft({ letter_id: draft.id, expected_revision: draft.revision,
      changes: { title: "New dashboard title", show_reference: true, issue_date: "2026-10-08" } });
    expect(records()[0].form.rich_document).toEqual(rich);
    expect(records()[0].form).toMatchObject({ title: "New dashboard title", show_reference: true, issue_date: "2026-10-08" });
  });

  it("refuses ambiguous separate prose or style edits before saving or losing rich formatting", async () => {
    const draft = await saveRich(), before = JSON.stringify(records());
    const save = vi.spyOn(letters, "saveLetter");
    for (const changes of [{ recipient_name: "Replacement" }, { recipient_address: "New address" }, { salutation: "Dear person," },
      { closing: "New closing" }, { signatory_name: "New signer" }, { signatory_title: "New role" },
      { text_style: { fontSize: 14 } }, { title_style: { bold: false } }]) {
      const error = await reviseAgentLetterDraft({ letter_id: draft.id, expected_revision: draft.revision, changes }).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("Word canvas");
      expect(isLetterArgumentError(error)).toBe(true);
      expect(JSON.stringify(records())).toBe(before);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("requires complete replacement body for rich block rewrites so removed wording cannot survive in the mirror", async () => {
    const draft = await saveRich(), before = JSON.stringify(records()), save = vi.spyOn(letters, "saveLetter");
    await expect(reviseAgentLetterDraft({ letter_id: draft.id, expected_revision: draft.revision, changes: { blocks: [] } })).rejects.toThrow("complete updated body");
    expect(save).not.toHaveBeenCalled();
    expect(JSON.stringify(records())).toBe(before);
    await reviseAgentLetterDraft({ letter_id: draft.id, expected_revision: draft.revision, changes: { body: "Authorization letter\nReplacement complete letter.", blocks: [] } });
    expect(letterRichText(records()[0].form.rich_document!)).toBe("Authorization letter\nReplacement complete letter.");
    expect(JSON.stringify(records()[0].form)).not.toContain("Original authorized responsibilities");
  });
});
