import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  session: vi.fn(),
  storage: vi.fn(),
  scope: "workspace:user:person",
  user: "person",
  local: false,
}));
vi.mock("../supabase", () => ({
  supabase: {},
  sb: () => ({
    auth: { getSession: mock.session },
  }),
}));
vi.mock("../api", () => ({ getCacheScope: () => mock.scope }));
vi.mock("../dataMode", () => ({ isLocalMode: () => mock.local, assertWorkspaceCurrent: () => {} }));
vi.mock("../supabaseConfig", () => ({ supabaseUrl: "https://fixture.invalid", supabaseAnonKey: "fixture-key" }));
vi.mock("@supabase/storage-js", () => ({ StorageClient: class {
  constructor(...args: unknown[]) { mock.storage(...args); }
  from() { return { upload: mock.upload, download: mock.download, remove: mock.remove }; }
} }));
import { readTeamAttachment, validateTeamAttachments, withTeamAttachments } from "../teamAttachments";
beforeEach(() => {
  vi.resetAllMocks();
  mock.scope = "workspace:user:person";
  mock.user = "person";
  mock.local = false;
  mock.session.mockImplementation(async () => ({ data: { session: { user: { id: mock.user }, access_token: "reviewed-token" } } }));
  mock.upload.mockResolvedValue({ error: null });
  mock.download.mockResolvedValue({ data: new Blob(["private attachment"]), error: null });
  mock.remove.mockResolvedValue({ error: null });
});
it("rejects empty, oversized, mislabeled or unsupported files before uploading", () => {
  expect(() =>
    validateTeamAttachments([new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })])
  ).toThrow("Choose images");
  expect(() =>
    validateTeamAttachments([new File(["html"], "invoice.pdf", { type: "text/html" })])
  ).toThrow("Choose images");
  expect(() => validateTeamAttachments([new File([], "empty.pdf")])).toThrow("10 MB");
  expect(() =>
    validateTeamAttachments([new File([new Uint8Array(10485761)], "big.pdf")])
  ).toThrow("10 MB");
  expect(validateTeamAttachments([new File(["photo"], "photo.jpg")])).toEqual([
    "image/jpeg",
  ]);
  expect(() =>
    validateTeamAttachments(Array(6).fill(new File(["pdf"], "invoice.pdf")))
  ).toThrow("5 files");
});
it("publishes only complete uploads and cleans up attempts on upload or workspace failure", async () => {
  const files = [new File(["photo"], "photo.jpg"), new File(["pdf"], "invoice.pdf")],
    send = vi.fn().mockResolvedValue(undefined),
    check = vi.fn();
  mock.upload
    .mockResolvedValueOnce({ error: null })
    .mockResolvedValueOnce({ error: { message: "offline" } });
  await expect(withTeamAttachments(files, send, check)).rejects.toThrow(
    "could not be uploaded"
  );
  expect(send).not.toHaveBeenCalled();
  expect(mock.remove.mock.calls[0][0]).toHaveLength(2);
  await withTeamAttachments(files, send, check);
  expect(send).toHaveBeenCalledWith([
    expect.objectContaining({ name: "photo.jpg", mime: "image/jpeg", size: 5 }),
    expect.objectContaining({ name: "invoice.pdf", size: 3 }),
  ]);
  send.mockClear();
  check.mockImplementation(() => {
    throw new Error("Workspace changed");
  });
  await expect(withTeamAttachments(files, send, check)).rejects.toThrow(
    "Workspace changed"
  );
  expect(send).not.toHaveBeenCalled();
});

it("pins team storage to the reviewed account and refuses another workspace's attachments", async () => {
  const attachment = { path: "workspace/person/photo.jpg", name: "photo.jpg", mime: "image/jpeg", size: 18 };
  expect((await readTeamAttachment(attachment)).size).toBe(18);
  expect(mock.storage).toHaveBeenCalledWith("https://fixture.invalid/storage/v1", {
    apikey: "fixture-key", Authorization: "Bearer reviewed-token",
  }, expect.any(Function));
  mock.download.mockClear();
  await expect(readTeamAttachment({ ...attachment, path: "another-workspace/person/photo.jpg" })).rejects.toThrow("original workspace");
  expect(mock.download).not.toHaveBeenCalled();
});

it.each(["account", "workspace", "mode"])("withholds private attachment bytes after a %s change", async change => {
  mock.download.mockImplementationOnce(async () => {
    if (change === "account") mock.user = "next-person";
    if (change === "workspace") mock.scope = "next-workspace:user:person";
    if (change === "mode") mock.local = true;
    return { data: new Blob(["private attachment"]), error: null };
  });
  await expect(readTeamAttachment({ path: "workspace/person/photo.jpg", name: "photo.jpg", mime: "image/jpeg", size: 18 })).rejects.toThrow("workspace changed");
});

it("does not publish uploaded files under the next signed-in account", async () => {
  const send = vi.fn();
  mock.upload.mockImplementationOnce(async () => {
    // The session may change before the workspace listener updates its cache.
    mock.user = "next-person";
    return { error: null };
  });
  await expect(withTeamAttachments([new File(["private"], "photo.jpg")], send, () => {})).rejects.toThrow("workspace changed");
  expect(send).not.toHaveBeenCalled();
  expect(mock.upload.mock.calls[0][0]).toMatch(/^workspace\/person\//);
});
