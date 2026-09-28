import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  single: vi.fn(),
  session: vi.fn(),
}));
vi.mock("../supabase", () => ({
  supabase: {
    auth: { getSession: mock.session },
    from: () => ({ select: () => ({ eq: () => ({ single: mock.single }) }) }),
    storage: { from: () => ({ upload: mock.upload, remove: mock.remove }) },
  },
}));
vi.mock("../dataMode", () => ({ isLocalMode: () => false }));
import { validateTeamAttachments, withTeamAttachments } from "../teamAttachments";
beforeEach(() => {
  vi.resetAllMocks();
  mock.session.mockResolvedValue({ data: { session: { user: { id: "person" } } } });
  mock.single.mockResolvedValue({ data: { org_id: "workspace" } });
  mock.upload.mockResolvedValue({ error: null });
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
