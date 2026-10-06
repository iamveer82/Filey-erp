import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SIGN_DEFAULT, STAMP_DEFAULT } from "../../components/StampSignature";
import { localClient } from "../localdb";
import { requireModuleAccess } from "../moduleAccess";
import { letterRichDocumentToLegacy, type LetterRichDocument } from "../letterRichText";
import {
  blankLetterForm,
  deleteLetter,
  letterDisplayForm,
  loadLetters,
  saveLetter,
  validateLetterForm,
  validateLetterTextStyle,
  LETTER_SETTING_KEY,
  type LetterForm,
  type LetterRecord,
} from "../letters";

const identity = vi.hoisted(() => ({ scope: "org:user:account", userId: "account", generation: 0 }));
vi.mock("../api", () => ({
  getCacheScope: () => identity.scope || null,
  getCacheIdentity: () => identity.generation,
}));
vi.mock("../realtime", () => ({ notifyDataChanged: vi.fn() }));
vi.mock("../moduleAccess", () => ({ requireModuleAccess: vi.fn(async () => {}) }));
vi.mock("../supabase", async () => {
  const { localClient } = await import("../localdb");
  return {
    sb: vi.fn(() =>
      localStorage.getItem("filey_data_mode") !== "cloud"
        ? localClient
        : {
            from: (table: string) => {
              const query = localClient.from(table),
                insert = query.insert.bind(query);
              query.insert = (rows) =>
                insert(
                  Array.isArray(rows)
                    ? rows.map((row) => ({ sync_revision: 1, ...row }))
                    : { sync_revision: 1, ...rows }
                );
              return query;
            },
          }
    ),
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: identity.userId } } },
          error: null,
        }),
      },
    },
  };
});

const form = (number = "LTR-001"): LetterForm => ({
  ...blankLetterForm(number),
  title: "Employment confirmation",
  company_name: "Example Company",
  recipient_name: "Recipient",
  blocks: [
    {
      id: "intro",
      type: "text",
      text: "This confirms the requested details.\nA second paragraph.",
      align: "left",
    },
  ],
});
const record = (number: string, id = crypto.randomUUID()): LetterRecord => ({
  id,
  revision: 1,
  created_at: "2026-10-03T00:00:00.000Z",
  updated_at: "2026-10-03T00:00:00.000Z",
  form: form(number),
  issued_at: null,
  issued_snapshot: null,
});
const cloud = (org = "org", user = "account") => {
  localStorage.setItem("filey_data_mode", "cloud");
  identity.userId = user;
  identity.scope = `${org}:user:${user}`;
  identity.generation++;
};
const seed = async (records: LetterRecord[], extra = {}) => {
  const result = await localClient
    .from("app_settings")
    .insert({
      key: LETTER_SETTING_KEY,
      value: JSON.stringify(records),
      sync_revision: 1,
      ...extra,
    })
    .select("id")
    .single();
  if (result.error) throw result.error;
  return result.data.id as number;
};
const stored = () =>
  JSON.parse(localStorage.getItem("localdb:app_settings") || "[]") as {
    id: number;
    key: string;
    value: string;
    sync_revision?: number;
  }[];
const replaceRecords = (records: LetterRecord[]) => {
  const rows = stored();
  rows[0].value = JSON.stringify(records);
  rows[0].sync_revision = (rows[0].sync_revision ?? 0) + 1;
  localStorage.setItem("localdb:app_settings", JSON.stringify(rows));
};
const raceOnUpdate = (race: () => void) => {
  const from = localClient.from.bind(localClient);
  vi.spyOn(localClient, "from").mockImplementation((table) => {
    const query = from(table),
      update = query.update.bind(query);
    vi.spyOn(query, "update").mockImplementation((value) => {
      race();
      return update(value);
    });
    return query;
  });
};

it("persists rich canvas JSON locally and freezes its formatting and company slots on issue", async () => {
  const rich: LetterRichDocument = { type: "doc", content: [
    { type: "heading", attrs: { level: 2, textAlign: "center" }, content: [{ type: "text", text: "Authorization" }] },
    { type: "paragraph", content: [{ type: "text", text: "We authorize the employee to manage the requested services.", marks: [
      { type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Georgia", fontSize: "12.5pt", color: "#334455" } },
    ] }] },
    { type: "companySignature", attrs: { label: "Authorized person", textAlign: "left" } },
  ] };
  const initial = { ...form(), ...letterRichDocumentToLegacy(rich), rich_document: rich };
  const draft = await saveLetter(initial);
  expect((await loadLetters())[0].form.rich_document).toEqual(rich);
  const issued = await saveLetter({ ...draft.form, status: "issued" }, draft.id, draft.revision, draft.updated_at);
  expect(issued.issued_snapshot?.rich_document).toEqual(rich);
  rich.content[1].content![0].text = "Changed external editor buffer";
  expect(letterDisplayForm(issued).rich_document?.content[1].content?.[0].text).toContain("We authorize");
  await expect(saveLetter({ ...issued.form, status: "draft" }, issued.id, issued.revision, issued.updated_at)).rejects.toThrow("Issued letters");
});

it("persists rich JSON in cloud mode and rejects unsupported direct canvas edits without changing saved data", async () => {
  cloud();
  const rich: LetterRichDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Cloud canvas" }] }] };
  const draft = await saveLetter({ ...form(), ...letterRichDocumentToLegacy(rich), rich_document: rich });
  expect((await loadLetters())[0].form.rich_document).toEqual(rich);
  await expect(saveLetter({ ...draft.form, rich_document: { type: "doc", content: [{ type: "image", attrs: { src: "http://tracker" } }] } } as unknown as LetterForm,
    draft.id, draft.revision, draft.updated_at)).rejects.toThrow("Letter document");
  expect((await loadLetters())[0].revision).toBe(draft.revision);
});

it("does not issue an empty rich canvas using stale text in legacy slots", () => {
  const rich: LetterRichDocument = { type: "doc", content: [{ type: "paragraph" }, { type: "companyStamp", attrs: { label: "Stamp" } }] };
  expect(() => validateLetterForm({ ...form(), status: "issued", rich_document: rich })).toThrow("Add letter content");
});

it("saves maximum rich prose plus 89 company marks within the 100-block legacy projection limit", async () => {
  // Force the 50k body boundary through an emoji: safe splitting needs eleven
  // remaining text chunks, leaving precisely 89 slots for company marks.
  const prose = "x".repeat(49_999) + "😀" + "x".repeat(199_910);
  const rich: LetterRichDocument = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: prose }] },
    ...Array.from({ length: 89 }, (_, index) => ({
      type: index % 2 ? "companySignature" as const : "companyStamp" as const,
      attrs: { label: "", textAlign: "left" as const },
    })),
  ] };
  const projection = letterRichDocumentToLegacy(rich);
  expect(projection.body).toHaveLength(49_999);
  expect(projection.blocks).toHaveLength(100);
  expect(projection.blocks.filter(block => block.type === "text")).toHaveLength(11);
  expect(projection.body.length + projection.blocks.reduce((sum, block) => sum + (block.type === "text" ? block.text.length : 0), 0)).toBe(250_000);
  const saved = await saveLetter({ ...form(), ...projection, rich_document: rich });
  expect((await loadLetters())[0].form.rich_document).toEqual(rich);
  expect(saved.form.blocks).toHaveLength(100);
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  identity.scope = "org:user:account";
  identity.userId = "account";
  identity.generation = 0;
  vi.mocked(requireModuleAccess).mockClear().mockResolvedValue();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

it("saves blank drafts and all ordered block types, but validates content and dates before issue", async () => {
  expect(blankLetterForm("LTR-BLANK")).toMatchObject({
    show_logo: false,
    show_stamp: false,
    show_signature: false,
    use_letterhead: false,
    body: "",
  });
  await saveLetter(blankLetterForm("LTR-BLANK"));
  const value = form();
  value.blocks = [
    {
      id: "field",
      type: "field",
      label: "Employee",
      value: "Example\nDetails",
      align: "center",
    },
    {
      id: "date",
      type: "date",
      label: "Start date",
      value: "2026-10-03",
      align: "right",
    },
    { id: "sig", type: "signature", label: "Authorized signatory", align: "left" },
    { id: "stamp", type: "stamp", label: "Company stamp", align: "right" },
    value.blocks[0],
  ];
  const saved = await saveLetter(value);
  expect((await loadLetters()).find((row) => row.id === saved.id)?.form.blocks).toEqual(
    value.blocks
  );
  expect(() => validateLetterForm({ ...value, status: "issued" })).not.toThrow();
  expect(() =>
    validateLetterForm({
      ...blankLetterForm("LTR-EMPTY"),
      status: "issued",
      title: "Title",
    })
  ).toThrow("content");
  expect(() => validateLetterForm({ ...value, status: "issued", title: "" })).toThrow(
    "title"
  );
  expect(() => validateLetterForm({ ...value, issue_date: "2026-02-30" })).toThrow(
    "valid letter date"
  );
  expect(() =>
    validateLetterForm({
      ...value,
      blocks: [
        { id: "d", type: "date", label: "Date", value: "2026-02-30", align: "left" },
      ],
    })
  ).toThrow("valid date");
  expect(() =>
    validateLetterForm({ ...value, blocks: [value.blocks[0], value.blocks[0]] })
  ).toThrow("unique ID");
  expect(() =>
    validateLetterForm({ ...value, recipient_address: "a\n".repeat(6) })
  ).toThrow("six lines");
  expect(() =>
    validateLetterForm({
      ...value,
      blocks: [{ id: "unknown", type: "html", text: "<script>", align: "left" }],
    } as unknown as LetterForm)
  ).toThrow("block type");
});

it("issues an immutable snapshot of content, branding and existing company assets without expiring URLs", async () => {
  const initial = form();
  const draft = await saveLetter(initial);
  const image = "data:image/png;base64,aGVsbG8=";
  const stampPath = "account/company/stamp-id/stamp.png";
  const signed = `https://example.supabase.co/storage/v1/object/sign/files/${stampPath}?token=PRIVATE_PREVIEW_TOKEN`;
  const issue = {
    ...draft.form,
    status: "issued" as const,
    company_logo: image,
    show_logo: true,
    use_letterhead: true,
    letterhead: { background: image },
    show_stamp: true,
    stamp: { ...STAMP_DEFAULT, data: signed, _previewUrl: signed },
    show_signature: true,
    signature: {
      ...SIGN_DEFAULT,
      data: "account/company/sign-id/sign.png",
      _previewUrl: signed,
    },
  };
  const issued = await saveLetter(issue, draft.id, draft.revision, draft.updated_at);
  expect(issued.created_at).toBe(draft.created_at);
  expect(issued.issued_at).toBe(issued.updated_at);
  expect(issued.issued_snapshot).toEqual(issued.form);
  expect(issued.form.stamp?.data).toBe(stampPath);
  expect(JSON.stringify(stored())).not.toContain("PRIVATE_PREVIEW_TOKEN");
  issue.company_name = "Changed company";
  issue.letterhead.background = "data:image/png;base64,Y2hhbmdlZA==";
  issue.stamp.data = "account/company/new/stamp.png";
  const displayed = letterDisplayForm((await loadLetters())[0]);
  expect(displayed.company_name).toBe(initial.company_name);
  expect(displayed.letterhead?.background).toBe(image);
  expect(displayed.stamp?.data).toBe(stampPath);
  displayed.company_name = "Mutable preview clone";
  expect(issued.issued_snapshot?.company_name).toBe(initial.company_name);
  await expect(
    saveLetter(
      { ...issued.form, body: "Edited" },
      issued.id,
      issued.revision,
      issued.updated_at
    )
  ).rejects.toThrow("cannot be edited");
  await expect(
    saveLetter(
      { ...issued.form, status: "draft" },
      issued.id,
      issued.revision,
      issued.updated_at
    )
  ).rejects.toThrow("cannot be edited");
  expect(await loadLetters()).toEqual([issued]);
  for (const table of [
    "invoice_docs",
    "stock_movements",
    "transactions",
    "crm_customers",
  ])
    expect(localStorage.getItem(`localdb:${table}`)).toBeNull();
});

it("requires selected assets at issue and refuses temporary URLs rather than storing access tokens", () => {
  const value = { ...form(), status: "issued" as const };
  expect(() => validateLetterForm({ ...value, show_stamp: true })).toThrow(
    "image is missing"
  );
  expect(() => validateLetterForm({ ...value, show_signature: true })).toThrow(
    "image is missing"
  );
  expect(() => validateLetterForm({ ...value, use_letterhead: true })).toThrow(
    "image is missing"
  );
  for (const company_logo of [
    "blob:temporary",
    "https://example.com/logo.png?token=secret",
    "account/company/../secret.png",
    "account/company/a/logo.png?token=secret",
  ])
    expect(() => validateLetterForm({ ...value, company_logo })).toThrow(
      "saved company image"
    );
});

it("serializes concurrent draft saves, detects stale revisions and avoids duplicate document numbers", async () => {
  const [first, other] = await Promise.all([
    saveLetter(form("LTR-A")),
    saveLetter(form("LTR-B")),
  ]);
  expect((await loadLetters()).map((row) => row.id)).toEqual([other.id, first.id]);
  const edit = await saveLetter(
    { ...first.form, body: "Updated" },
    first.id,
    first.revision,
    first.updated_at
  );
  await expect(
    saveLetter(first.form, first.id, first.revision, first.updated_at)
  ).rejects.toThrow("changed or was deleted");
  await expect(deleteLetter(first.id, first.revision, first.updated_at)).rejects.toThrow(
    "changed or was deleted"
  );
  await expect(saveLetter(form("ltr-a"))).rejects.toThrow("already in use");
  await deleteLetter(edit.id, edit.revision, edit.updated_at);
  expect(await loadLetters()).toEqual([other]);
});

it("detects equal-revision sync replacements and creates distinct timestamps for rapid saves", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-03T00:00:00Z"));
  const first = await saveLetter(form());
  const second = await saveLetter(
    { ...first.form, body: "First edit" },
    first.id,
    first.revision,
    first.updated_at
  );
  expect(Date.parse(second.updated_at)).toBe(Date.parse(first.updated_at) + 1);
  const replacement = {
    ...second,
    updated_at: new Date(Date.parse(second.updated_at) + 1).toISOString(),
    form: { ...second.form, body: "Offline version" },
  };
  replaceRecords([replacement]);
  await expect(
    saveLetter(second.form, second.id, second.revision, second.updated_at)
  ).rejects.toThrow("changed or was deleted");
  await expect(
    deleteLetter(second.id, second.revision, second.updated_at)
  ).rejects.toThrow("changed or was deleted");
  expect(await loadLetters()).toEqual([replacement]);
});

it("preserves malformed stored data, duplicate settings, and an issued record with a missing snapshot", async () => {
  await seed([record("LTR-OLD")]);
  // Simulate historical damaged bytes; current mutation APIs reject them.
  const damaged = stored(); damaged[0].value = "{original-invalid-data";
  localStorage.setItem("localdb:app_settings", JSON.stringify(damaged));
  const original = localStorage.getItem("localdb:app_settings");
  await expect(loadLetters()).rejects.toThrow("original data has been preserved");
  await expect(saveLetter(form())).rejects.toThrow("original data has been preserved");
  expect(localStorage.getItem("localdb:app_settings")).toBe(original);
  replaceRecords([
    {
      ...record("LTR-BROKEN"),
      form: { ...form("LTR-BROKEN"), status: "issued" },
      issued_at: "2026-10-03T00:00:00Z",
    },
  ]);
  await expect(loadLetters()).rejects.toThrow("original data has been preserved");
  replaceRecords([]);
  await seed([]);
  await expect(saveLetter(form())).rejects.toThrow("duplicate settings");
});

it("does not report failed local persistence as a saved letter", async () => {
  await saveLetter(form("LTR-OLD"));
  const original = localStorage.getItem("localdb:app_settings"),
    setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value
  ) {
    if (key === "localdb:app_settings") throw new Error("Disk is full");
    setItem.call(this, key, value);
  });
  await expect(saveLetter(form("LTR-NEW"))).rejects.toThrow("Disk is full");
  expect(localStorage.getItem("localdb:app_settings")).toBe(original);
});

it("isolates organizations and denies offline cloud, missing accounts and revoked module access", async () => {
  cloud();
  const first = await saveLetter(form());
  cloud("other-org");
  expect(await loadLetters()).toEqual([]);
  await saveLetter(form("LTR-OTHER"));
  cloud();
  expect(await loadLetters()).toEqual([first]);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await expect(saveLetter(form())).rejects.toThrow("Connect to the internet");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(requireModuleAccess).mockRejectedValue(new Error("Module denied"));
  await expect(loadLetters()).rejects.toThrow("Module denied");
  await expect(deleteLetter(first.id, first.revision, first.updated_at)).rejects.toThrow(
    "Module denied"
  );
  identity.scope = "";
  await expect(loadLetters()).rejects.toThrow("Sign in");
});

it("merges a known cloud CAS miss and rejects a concurrent edit of the same letter", async () => {
  cloud();
  const first = record("LTR-FIRST"),
    other = record("LTR-OTHER");
  await seed([first], { user_id: identity.userId, org_id: "org" });
  let raced = false;
  raceOnUpdate(() => {
    if (!raced) {
      raced = true;
      replaceRecords([other, first]);
    }
  });
  const saved = await saveLetter(form("LTR-NEW"));
  expect((await loadLetters()).map((row) => row.id)).toEqual([
    saved.id,
    other.id,
    first.id,
  ]);
  vi.restoreAllMocks();
  raceOnUpdate(() =>
    replaceRecords([
      { ...first, revision: 2, form: { ...first.form, body: "Other window" } },
    ])
  );
  await expect(
    saveLetter(first.form, first.id, first.revision, first.updated_at)
  ).rejects.toThrow("changed or was deleted");
  expect((await loadLetters())[0].form.body).toBe("Other window");
});

it("uses a short revision filter and refuses cloud settings whose revisions cannot be verified", async () => {
  cloud();
  const first = record("LTR-LARGE");
  first.form.letterhead = { background: `data:image/png;base64,${"a".repeat(100000)}` };
  await seed([first], { user_id: identity.userId, org_id: "org" });
  const from = localClient.from.bind(localClient),
    filters: [string, unknown][] = [];
  vi.spyOn(localClient, "from").mockImplementation((table) => {
    const query = from(table),
      eq = query.eq.bind(query);
    vi.spyOn(query, "eq").mockImplementation((column, value) => {
      filters.push([column, value]);
      return eq(column, value);
    });
    return query;
  });
  await saveLetter(
    { ...first.form, body: "Updated" },
    first.id,
    first.revision,
    first.updated_at
  );
  expect(filters).toContainEqual(["sync_revision", 1]);
  expect(filters.some(([column]) => column === "value")).toBe(false);
  await localClient
    .from("app_settings")
    .update({ sync_revision: null })
    .eq("key", LETTER_SETTING_KEY);
  const original = localStorage.getItem("localdb:app_settings");
  await expect(saveLetter(form())).rejects.toThrow("update the cloud database");
  expect(localStorage.getItem("localdb:app_settings")).toBe(original);
});

it("bounds known CAS retries and never repeats a write after an unknown response", async () => {
  cloud();
  const first = record("LTR-FIRST");
  await seed([first], { user_id: identity.userId, org_id: "org" });
  let changes = 0;
  raceOnUpdate(() => replaceRecords([{ ...first, revision: ++changes + 1 }]));
  await expect(saveLetter(form("LTR-NEW"))).rejects.toThrow("another window");
  expect(changes).toBe(3);
  vi.restoreAllMocks();
  const from = localClient.from.bind(localClient);
  let attempts = 0;
  vi.spyOn(localClient, "from").mockImplementation((table) => {
    const query = from(table),
      update = query.update.bind(query);
    vi.spyOn(query, "update").mockImplementation((value) => {
      attempts++;
      update(value);
      vi.spyOn(query, "maybeSingle").mockImplementation(
        () =>
          Promise.resolve({
            data: null,
            error: new Error("Network outcome unknown"),
          }) as never
      );
      return query;
    });
    return query;
  });
  await expect(saveLetter(form("LTR-UNKNOWN"))).rejects.toThrow(
    "Network outcome unknown"
  );
  expect(attempts).toBe(1);
});

it("rejects delayed operations after a workspace or account switch", async () => {
  let finish!: () => void;
  vi.mocked(requireModuleAccess).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  const loading = loadLetters();
  identity.scope = "next:user:account";
  finish();
  await expect(loading).rejects.toThrow("workspace changed");
  cloud();
  identity.userId = "different-account";
  await expect(loadLetters()).rejects.toThrow("cloud account changed");
});

it("rejects both active and queued saves after switching away and back to the same workspace", async () => {
  let finish!: () => void;
  vi.mocked(requireModuleAccess).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const outcomes = Promise.allSettled([
    saveLetter(form("LTR-ACTIVE")),
    saveLetter(form("LTR-QUEUED")),
  ]);
  await vi.waitFor(() => expect(requireModuleAccess).toHaveBeenCalledTimes(1));
  const originalScope = identity.scope;
  identity.scope = "other-org:user:account";
  identity.generation++;
  identity.scope = originalScope;
  identity.generation++;
  finish();
  const results = await outcomes;
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason.message).toContain("workspace changed");
  }
  expect(stored()).toEqual([]);
  expect(requireModuleAccess).toHaveBeenCalledTimes(1);
  const current = await saveLetter(form("LTR-CURRENT"));
  expect(await loadLetters()).toEqual([current]);
});

it("rejects a delayed read after workspace ABA even when the scope string matches again", async () => {
  await saveLetter(form("LTR-PRIVATE"));
  let finish!: () => void;
  vi.mocked(requireModuleAccess).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const loading = loadLetters();
  const originalScope = identity.scope;
  identity.scope = "other-org:user:account";
  identity.generation++;
  identity.scope = originalScope;
  identity.generation++;
  finish();
  await expect(loading).rejects.toThrow("workspace changed");
  expect((await loadLetters())[0].form.number).toBe("LTR-PRIVATE");
});

it.each(["local", "cloud"])("honors a cancelled caller guard after permission lookup before a %s save writes", async (mode) => {
  if (mode === "cloud") cloud();
  let cancelled = false;
  const assertCurrent = vi.fn(() => {
    if (cancelled) throw new Error("This agent request was cancelled.");
  });
  let finish!: () => void;
  vi.mocked(requireModuleAccess).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  const saving = saveLetter(form("LTR-CANCELLED"), undefined, undefined, undefined, assertCurrent);
  await vi.waitFor(() => expect(requireModuleAccess).toHaveBeenCalledTimes(1));
  cancelled = true;
  finish();
  await expect(saving).rejects.toThrow("request was cancelled");
  expect(assertCurrent.mock.calls.length).toBeGreaterThan(1);
  expect(stored()).toEqual([]);
});

it("honors a stale caller guard immediately before a cloud update executes", async () => {
  cloud();
  const original = await saveLetter(form("LTR-ORIGINAL"));
  const bytes = localStorage.getItem("localdb:app_settings");
  let stale = false;
  raceOnUpdate(() => { stale = true; });
  await expect(saveLetter(
    { ...original.form, body: "Must not be saved" },
    original.id,
    original.revision,
    original.updated_at,
    () => { if (stale) throw new Error("The originating request changed."); }
  )).rejects.toThrow("originating request changed");
  expect(localStorage.getItem("localdb:app_settings")).toBe(bytes);
  expect(await loadLetters()).toEqual([original]);
});

it.each([
  null,
  {},
  { id: 0 },
  { id: -1 },
  { id: "not-an-id" },
  { id: true },
  { id: [1] },
  { id: NaN },
  { id: Infinity },
  { id: 1.5 },
  { id: Number.MAX_SAFE_INTEGER + 1 },
])("does not report or repeat a committed cloud insert with an invalid acknowledgement %j", async (acknowledgement) => {
  cloud();
  const from = localClient.from.bind(localClient);
  let inserts = 0;
  vi.spyOn(localClient, "from").mockImplementation((table) => {
    const query = from(table), insert = query.insert.bind(query);
    vi.spyOn(query, "insert").mockImplementation((values) => {
      inserts++;
      insert(values);
      const single = query.single.bind(query);
      vi.spyOn(query, "single").mockImplementation(() => (async () => {
        const saved = await single();
        expect(saved.error).toBeNull();
        return { ...saved, data: acknowledgement };
      })() as never);
      return query;
    });
    return query;
  });
  await expect(saveLetter(form("LTR-UNCERTAIN"))).rejects.toThrow("save could not be confirmed");
  expect(inserts).toBe(1);
  const verified = await loadLetters();
  expect(verified).toHaveLength(1);
  expect(verified[0].form.number).toBe("LTR-UNCERTAIN");
});

it.each([
  {},
  { id: 0 },
  { id: -1 },
  { id: "not-an-id" },
  { id: true },
  { id: [1] },
  { id: NaN },
  { id: Infinity },
  { id: 1.5 },
  { id: Number.MAX_SAFE_INTEGER + 1 },
  { id: 999999 },
  { id: "999999" },
])("does not report or repeat a committed cloud update with a malformed or wrong-ID acknowledgement %j", async (acknowledgement) => {
  cloud();
  const original = await saveLetter(form("LTR-REVISION"));
  const settingId = stored()[0].id;
  const from = localClient.from.bind(localClient);
  let updates = 0;
  vi.spyOn(localClient, "from").mockImplementation((table) => {
    const query = from(table), update = query.update.bind(query);
    vi.spyOn(query, "update").mockImplementation((values) => {
      updates++;
      update(values);
      const maybeSingle = query.maybeSingle.bind(query);
      vi.spyOn(query, "maybeSingle").mockImplementation(() => (async () => {
        const saved = await maybeSingle();
        expect(saved.error).toBeNull();
        expect(saved.data.id).toBe(settingId);
        return { ...saved, data: acknowledgement };
      })() as never);
      return query;
    });
    return query;
  });
  await expect(saveLetter(
    { ...original.form, body: "Committed but not confirmed" },
    original.id,
    original.revision,
    original.updated_at
  )).rejects.toThrow("save could not be confirmed");
  expect(updates).toBe(1);
  const verified = await loadLetters();
  expect(verified).toHaveLength(1);
  expect(verified[0]).toMatchObject({
    id: original.id,
    revision: original.revision + 1,
    form: { body: "Committed but not confirmed" },
  });
  expect(stored()[0].id).toBe(settingId);
});

it("keeps legacy style/reference defaults readable and gives new letters explicit prose defaults without a printed reference", async () => {
  const blank = blankLetterForm("LTR-NEW");
  expect(blank).toMatchObject({
    show_reference: false,
    show_company_header: true,
    text_style: { font: "modern", fontSize: 11, lineSpacing: 1.5, paragraphSpacing: 16 },
    title_style: { font: "modern", fontSize: 18, bold: true },
  });
  const legacy = form("LTR-LEGACY");
  delete legacy.show_reference;
  delete legacy.show_company_header;
  delete legacy.text_style;
  delete legacy.title_style;
  await seed([{ ...record(legacy.number), form: legacy }]);
  expect((await loadLetters())[0].form).toEqual(legacy);
  await saveLetter(
    legacy,
    (await loadLetters())[0].id,
    1,
    (await loadLetters())[0].updated_at
  );
  for (const key of ["show_reference", "show_company_header"] as const) {
    expect(() => validateLetterForm({ ...legacy, [key]: false })).not.toThrow();
    for (const value of [null, "false", 0])
      expect(() =>
        validateLetterForm({ ...legacy, [key]: value } as unknown as LetterForm)
      ).toThrow("display options");
  }
  await expect(
    saveLetter({ ...blank, number: "", show_reference: false })
  ).rejects.toThrow("Letter number");
});

it("validates structured text formatting with bounded point sizes, spacing, booleans and approved fonts/colors", () => {
  const style = {
    font: "classic" as const,
    align: "center" as const,
    fontSize: 12.5,
    bold: true,
    italic: false,
    underline: true,
    color: "#aB23EF",
    lineSpacing: 1.25,
    paragraphSpacing: 0,
  };
  expect(() => validateLetterTextStyle(style)).not.toThrow();
  expect(() => validateLetterTextStyle({})).not.toThrow();
  expect(() => validateLetterTextStyle(undefined)).not.toThrow();
  expect(() =>
    validateLetterTextStyle({ fontSize: 8, lineSpacing: 1, paragraphSpacing: 0 })
  ).not.toThrow();
  expect(() =>
    validateLetterTextStyle({ fontSize: 36, lineSpacing: 2.5, paragraphSpacing: 32 })
  ).not.toThrow();
  for (const invalid of [
    null,
    "bold",
    [],
    new Date(),
    { font: "Arial" },
    { align: "justify" },
    { fontSize: "12" },
    { fontSize: NaN },
    { fontSize: Infinity },
    { fontSize: 7.9 },
    { fontSize: 36.1 },
    { lineSpacing: 0.9 },
    { lineSpacing: 2.6 },
    { paragraphSpacing: -1 },
    { paragraphSpacing: 32.1 },
    { bold: 1 },
    { italic: "false" },
    { underline: null },
    { color: "red" },
    { color: "#abc" },
    { color: "url(secret)" },
    { css: "position:absolute" },
  ])
    expect(() => validateLetterTextStyle(invalid)).toThrow("formatting");
  const value = form();
  for (const key of ["text_style", "title_style"] as const)
    expect(() => validateLetterForm({ ...value, [key]: { fontSize: 200 } })).toThrow(
      "formatting"
    );
  expect(() =>
    validateLetterForm({
      ...value,
      blocks: [{ ...value.blocks[0], style: { color: "bad" } }],
    })
  ).toThrow("formatting");
});

it("persists form/title/block formatting and hidden reference/header with the frozen issued content", async () => {
  const value = form("LTR-STYLED");
  value.show_reference = false;
  value.show_company_header = false;
  value.text_style = {
    font: "classic",
    align: "right",
    fontSize: 10,
    lineSpacing: 2,
    paragraphSpacing: 8,
    color: "#112233",
  };
  value.title_style = {
    font: "mono",
    align: "center",
    fontSize: 24,
    bold: true,
    underline: true,
  };
  value.blocks[0].style = { fontSize: 14, italic: true, bold: false, color: "#445566" };
  const draft = await saveLetter(value);
  expect(draft.form).toEqual(value);
  const issued = await saveLetter(
    { ...draft.form, status: "issued" },
    draft.id,
    draft.revision,
    draft.updated_at
  );
  value.text_style.fontSize = 30;
  value.blocks[0].style.color = "#000000";
  const display = letterDisplayForm((await loadLetters())[0]);
  expect(display).toEqual(issued.issued_snapshot);
  expect(display.text_style?.fontSize).toBe(10);
  expect(display.title_style?.align).toBe("center");
  expect(display.blocks[0].style?.color).toBe("#445566");
  expect(display.show_reference).toBe(false);
  expect(display.show_company_header).toBe(false);
});
