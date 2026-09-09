import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: any) => any>,
  line: (_line: string) => {},
  close: (_line: string) => {},
  end: vi.fn(),
  send: vi.fn(),
  download: vi.fn(),
  readFile: vi.fn(),
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
vi.mock("node:fs/promises", () => ({ default: { readFile: transport.readFile } }));
vi.mock("@whiskeysockets/baileys", () => ({
  default: () => ({
    user: { id: "971500000001:1@s.whatsapp.net" },
    sendMessage: transport.send,
    ev: {
      on: (name: string, callback: (event: any) => any) => {
        transport.handlers[name] = callback;
      },
      removeAllListeners: vi.fn(),
    },
    end: transport.end,
  }),
  DisconnectReason: { loggedOut: 401 },
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: vi.fn() }),
  downloadMediaMessage: transport.download,
}));
vi.mock("qrcode-terminal", () => ({ default: { generate: vi.fn() } }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn() } }));

let output: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  transport.handlers = {};
  transport.send.mockResolvedValue({ key: { id: "accepted-id" } });
  transport.download.mockResolvedValue(Buffer.from("voice"));
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

it("forwards a downloaded voice note with its sender, then confirms the reply", async () => {
  const message = {
    key: { id: "voice-1", remoteJid: "971500000001@s.whatsapp.net" },
    pushName: "Owner",
    message: { audioMessage: { mimetype: "audio/ogg" } },
  };
  await transport.handlers["messages.upsert"]({ type: "notify", messages: [message] });
  expect(transport.download).toHaveBeenCalledWith(message, "buffer", {});
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
    })
  );
  expect(transport.send).toHaveBeenCalledWith("971500000001@s.whatsapp.net", {
    text: "Here is the answer",
  });
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

it("closes the phone socket when the desktop process closes its input pipe", () => {
  const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("process-exit"); });
  expect(() => transport.close("")).toThrow("process-exit");
  expect(transport.end).toHaveBeenCalled();
  expect(exit).toHaveBeenCalledWith(0);
});
