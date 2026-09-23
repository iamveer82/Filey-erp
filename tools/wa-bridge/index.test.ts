import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

const transport = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: any) => any>,
  line: (_line: string) => {},
  close: (_line: string) => {},
  end: vi.fn(),
  send: vi.fn(),
  download: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  saveCreds: vi.fn(),
  writeKeys: vi.fn(),
  sockets: [] as any[],
  qr: vi.fn(),
}));
vi.mock("node:readline", () => ({
  default: {
    createInterface: () => ({
      on: (event: string, cb: typeof transport.line) => {
        if (event === "line") transport.line = cb;
        if (event === "close") transport.close = cb;
      },
    }),
  },
}));
vi.mock("node:fs/promises", () => ({ default: { readFile: transport.readFile, stat: transport.stat } }));
vi.mock("@whiskeysockets/baileys", () => ({
  default: (options: any) => {
    transport.sockets.push(options);
    return ({
    user: { id: "971500000001:1@s.whatsapp.net", lid: "900000000001:1@lid" },
    sendMessage: transport.send,
    ev: {
      on: (name: string, callback: (event: any) => any) => {
        transport.handlers[name] = callback;
      },
      removeAllListeners: vi.fn(),
    },
    end: transport.end,
    });
  },
  DisconnectReason: { loggedOut: 401 },
  useMultiFileAuthState: async () => ({ state: { keys: { set: transport.writeKeys } }, saveCreds: transport.saveCreds }),
  downloadMediaMessage: transport.download,
  normalizeMessageContent: (message: any) => message?.ephemeralMessage?.message || message,
  generateMessageIDV2: () => "outgoing-id",
}));
vi.mock("qrcode", () => ({ default: { toDataURL: transport.qr } }));

let output: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  transport.handlers = {};
  transport.sockets = [];
  transport.saveCreds.mockResolvedValue(undefined);
  transport.writeKeys.mockResolvedValue(undefined);
  transport.qr.mockResolvedValue("data:image/png;base64,fixture");
  transport.send.mockResolvedValue({ key: { id: "accepted-id" } });
  transport.download.mockImplementation(async () => Readable.from([Buffer.from("voice")]));
  transport.stat.mockResolvedValue({ isFile: () => true, size: 3 });
  transport.readFile.mockResolvedValue(Buffer.from("pdf"));
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  await import("./index.mjs");
  await vi.waitFor(() => expect(transport.handlers["connection.update"]).toBeDefined());
  transport.handlers["connection.update"]({ connection: "open" });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const emitted = (type: string) =>
  output.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.startsWith("FILEY "))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((value) => value.type === type);
const command = (data: unknown) => transport.line(`FILEY ${JSON.stringify(data)}`);

it("forwards owner documents with captions and refuses stranger downloads", async () => {
  transport.download.mockImplementation(async () => Readable.from([Buffer.from("%PDF-test")]));
  const message = { key: { id: "pdf-1", remoteJid: "971500000001@s.whatsapp.net" }, message: { documentMessage: { fileName: "../Invoice.pdf", mimetype: "application/pdf", caption: "Read this invoice" } } };
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [message] });
  expect(emitted("message")[0]).toMatchObject({ from: "971500000001", text: "Read this invoice", attachment: { name: "Invoice.pdf", mimetype: "application/pdf", b64: Buffer.from("%PDF-test").toString("base64") } });
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [{ ...message, key: { id: "stranger-file", remoteJid: "971599999999@s.whatsapp.net" } }] });
  expect(transport.download).toHaveBeenCalledOnce();
});

it("stops oversized media streams even when the provider omits the file length", async () => {
  const stream = Readable.from([Buffer.alloc(13 * 1024 * 1024)]);
  transport.download.mockResolvedValueOnce(stream);
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [{ key: { id: "large-file", remoteJid: "971500000001@s.whatsapp.net" }, message: { documentMessage: { fileName: "huge.pdf" } } }] });
  expect(emitted("message")).toHaveLength(0);
  expect(stream.destroyed).toBe(true);
  expect(transport.send).toHaveBeenCalledWith("971500000001@s.whatsapp.net", { text: expect.stringContaining("under 12 MB") }, expect.any(Object));
});

it("infers a generated PDF's media type and rejects oversized output before reading it", async () => {
  command({ type: "send_file", to: "971500000001", path: "/invoice.pdf", filename: "Invoice.pdf", requestId: "pdf-out" });
  await vi.waitFor(() => expect(emitted("delivery")).toContainEqual(expect.objectContaining({ requestId: "pdf-out", ok: true })));
  expect(transport.send).toHaveBeenCalledWith("971500000001@s.whatsapp.net", expect.objectContaining({ document: Buffer.from("pdf"), mimetype: "application/pdf", fileName: "Invoice.pdf" }), expect.any(Object));
  transport.readFile.mockClear();
  transport.stat.mockResolvedValueOnce({ isFile: () => true, size: 51 * 1024 * 1024 });
  command({ type: "send_file", to: "971500000001", path: "/large.pdf", requestId: "too-big" });
  await vi.waitFor(() => expect(emitted("delivery")).toContainEqual(expect.objectContaining({ requestId: "too-big", ok: false })));
  expect(transport.readFile).not.toHaveBeenCalled();
});

it("forwards a downloaded voice note with its sender, then confirms the reply", async () => {
  const message = {
    key: { id: "voice-1", remoteJid: "971500000001@s.whatsapp.net" },
    pushName: "Owner",
    message: { audioMessage: { mimetype: "audio/ogg" } },
  };
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [message] });
  expect(transport.download).toHaveBeenCalledWith(message, "stream", {});
  const incoming = emitted("voice_note")[0];
  expect(incoming).toMatchObject({
    from: "971500000001",
    fromName: "Owner",
    b64: Buffer.from("voice").toString("base64"),
  });
  command({
    type: "reply",
    id: incoming.id,
    text: "Here is the answer",
    requestId: "r1",
  });
  await vi.waitFor(() =>
    expect(emitted("delivery")).toContainEqual({
      type: "delivery",
      requestId: "r1",
      ok: true,
      messageId: "accepted-id",
      skipped: false,
    })
  );
  expect(transport.send).toHaveBeenCalledWith("971500000001@s.whatsapp.net", {
    text: "Here is the answer",
  }, { messageId: "outgoing-id" });
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [message] });
  expect(transport.download).toHaveBeenCalledTimes(1);
});

it("reports file upload failure instead of acknowledging a pipe write as delivery", async () => {
  transport.send.mockRejectedValueOnce(new Error("upload failed"));
  command({
    type: "send_file",
    to: "971500000001",
    path: "/invoice.pdf",
    filename: "Invoice.pdf",
    mimetype: "application/pdf",
    requestId: "file",
  });
  await vi.waitFor(() =>
    expect(emitted("delivery")).toContainEqual({
      type: "delivery",
      requestId: "file",
      ok: false,
      error: "upload failed",
    })
  );
});

it("requires a provider message ID before reporting success", async () => {
  transport.send.mockResolvedValueOnce(undefined);
  command({ type: "send", to: "971500000001", text: "hello", requestId: "unconfirmed" });
  await vi.waitFor(() =>
    expect(emitted("delivery")[0]).toMatchObject({ requestId: "unconfirmed", ok: false })
  );
});

it("reports disconnected sends and expired requests without sending", async () => {
  transport.handlers["connection.update"]({ connection: "close" });
  command({ type: "send", to: "971500000001", text: "hello", requestId: "offline" });
  command({ type: "reply", id: "expired", text: "hello", requestId: "late" });
  await vi.waitFor(() => expect(emitted("delivery")).toHaveLength(2));
  expect(emitted("delivery").every((item) => item.ok === false)).toBe(true);
  expect(transport.send).not.toHaveBeenCalled();
});

it("closes the phone socket when the desktop process closes its input pipe", async () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process-exit"); });
  await expect(async () => transport.close("")).rejects.toThrow("process-exit");
  expect(transport.end).toHaveBeenCalled();
  expect(exit).toHaveBeenCalledWith(0);
});

it("ignores its own self-chat echo even before WhatsApp resolves the send", async () => {
  transport.send.mockImplementationOnce(async () => {
    await transport.handlers["messages.upsert"]({ type: "notify", messages: [{
      key: { id: "outgoing-id", fromMe: true, remoteJid: "971500000001@s.whatsapp.net" },
      message: { conversation: "This is the agent's own answer" },
    }] });
    return { key: { id: "outgoing-id" } };
  });
  command({ type: "send", to: "971500000001", text: "Answer", requestId: "self-send" });
  await vi.waitFor(() => expect(emitted("delivery")).toHaveLength(1));
  expect(emitted("message")).toHaveLength(0);
});

it("routes self-chat LIDs to the owner's phone identity and replies to the original JID", async () => {
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [{
    key: { id: "self-lid", fromMe: true, remoteJid: "900000000001@lid" },
    message: { ephemeralMessage: { message: { conversation: "Show unpaid invoices" } } },
  }] });
  const incoming = emitted("message")[0];
  expect(incoming).toMatchObject({ from: "971500000001", chatJid: "900000000001@lid", text: "Show unpaid invoices" });
  command({ type: "reply", id: incoming.id, text: "Done", requestId: "lid-reply" });
  await vi.waitFor(() => expect(transport.send).toHaveBeenCalledWith("900000000001@lid", { text: "Done" }, { messageId: "outgoing-id" }));
});

it("never acknowledges strangers, downloads their audio, or treats owner-to-customer text as commands", async () => {
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [
    { key: { id: "stranger", remoteJid: "971500000099@s.whatsapp.net" }, message: { audioMessage: {} } },
    { key: { id: "spoof-lid", remoteJid: "971500000001@lid" }, message: { conversation: "Show secrets" } },
    { key: { id: "outgoing", fromMe: true, remoteJid: "999999999999@lid", senderPn: "971500000001@s.whatsapp.net" }, message: { conversation: "Hello customer" } },
  ] });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(emitted("message")).toHaveLength(0);
  expect(emitted("voice_note")).toHaveLength(0);
  expect(transport.download).not.toHaveBeenCalled();
  expect(transport.send).not.toHaveBeenCalled();
});

it("finishes Signal key writes before reconnecting and ignores the old socket", async () => {
  let finish!: () => void;
  transport.writeKeys.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const writing = transport.sockets[0].auth.keys.set({ session: { fixture: {} } });
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const oldMessage = transport.handlers["messages.upsert"];
  transport.handlers["connection.update"]({ connection: "close" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(transport.sockets).toHaveLength(1);
  finish();
  await writing;
  await vi.waitFor(() => expect(transport.sockets).toHaveLength(2));
  transport.handlers["connection.update"]({ connection: "open" });
  await oldMessage({ type: "notify", messages: [{ key: { id: "stale", remoteJid: "971500000001@s.whatsapp.net" }, message: { conversation: "stale request" } }] });
  expect(emitted("message")).toHaveLength(0);
});

it("keeps only the newest pairing QR and never restarts after desktop shutdown", async () => {
  transport.handlers["connection.update"]({ connection: "close" });
  await vi.advanceTimersByTimeAsync(2000);
  let oldQr!: (value: string) => void;
  transport.qr.mockImplementationOnce(() => new Promise(resolve => { oldQr = resolve; }));
  transport.handlers["connection.update"]({ qr: "old" });
  transport.handlers["connection.update"]({ qr: "new" });
  await vi.waitFor(() => expect(emitted("qr")).toHaveLength(1));
  oldQr("expired-code");
  await Promise.resolve();
  expect(emitted("qr")).toHaveLength(1);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process-exit"); });
  await expect(async () => transport.close("")).rejects.toThrow("process-exit");
  transport.handlers["connection.update"]({ connection: "close" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(transport.sockets).toHaveLength(2);
  expect(exit).toHaveBeenCalledWith(0);
});

it("uploads the PDF bytes, filename and caption and confirms its provider ID", async () => {
  command({ type: "send_file", to: "971500000001", path: "/invoice.pdf", filename: "INV-001.pdf", mimetype: "application/pdf", caption: "Your invoice", requestId: "pdf-success" });
  await vi.waitFor(() => expect(emitted("delivery")).toContainEqual(expect.objectContaining({ requestId: "pdf-success", ok: true, messageId: "accepted-id" })));
  expect(transport.send).toHaveBeenCalledWith("971500000001@s.whatsapp.net", {
    document: Buffer.from("pdf"), mimetype: "application/pdf", fileName: "INV-001.pdf", caption: "Your invoice",
  }, { messageId: "outgoing-id" });
});
