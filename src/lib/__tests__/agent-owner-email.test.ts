// A document the owner asked for must reach them even when WhatsApp is down.
// The WhatsApp file tool falls back to the owner's own email address through
// Resend, and never emails a customer from that fallback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTool } from "../aiTools";
import { bridgeState, sendWaFile } from "../waBridge";
import { sendEmail } from "../email";
import { deliverFile } from "../agentFiles";
import { fileBytes, listFiles } from "../files";
import { getLocalCredential } from "../localAuth";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";

const BYTES = new TextEncoder().encode("%PDF-1.7\nSigned letter\n%%EOF");
const OWNER = "owner@example.test";

vi.mock("../email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email")>()),
  sendEmail: vi.fn(),
}));
vi.mock("../waBridge", () => ({
  hasDesktop: true,
  bridgeState: vi.fn(),
  sendWaFile: vi.fn(),
  sendWa: vi.fn(),
  getBridgeConfig: () => ({ ownerNumber: "971500000001" }),
}));
vi.mock("../agentFiles", () => ({ deliverFile: vi.fn() }));
vi.mock("../files", () => ({ listFiles: vi.fn(), fileBytes: vi.fn() }));
vi.mock("../localAuth", () => ({ getLocalCredential: vi.fn() }));

const call = (name: string, args: Record<string, unknown> = {}) =>
  runTool(name, args, () => true, true, "send-file-turn");

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setDataMode("local");
  setAgentMode("auto");
  setCacheOrg("send-file-org", "send-file-user");
  vi.mocked(getLocalCredential).mockReturnValue({ email: OWNER, userId: "send-file-user" } as never);
  vi.mocked(listFiles).mockResolvedValue([{ id: "f1", name: "LTR-0001-Signed letter.pdf", mime: "application/pdf" }] as never);
  vi.mocked(fileBytes).mockResolvedValue(BYTES);
  vi.mocked(deliverFile).mockResolvedValue({ name: "LTR-0001-Signed letter.pdf", path: "C:/Exports/LTR-0001-Signed letter.pdf" });
  vi.mocked(bridgeState).mockResolvedValue({ state: "connected" });
  vi.mocked(sendWaFile).mockResolvedValue("provider-id");
  vi.mocked(sendEmail).mockResolvedValue();
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sending a document when WhatsApp is unavailable", () => {
  it("emails the file to the owner instead when the bridge is not connected", async () => {
    vi.mocked(bridgeState).mockResolvedValue({ state: "stopped" });

    const result = await call("send_whatsapp_file", { file: "Signed letter", caption: "Your signed letter" });

    expect(result).toMatchObject({ ok: true, via: "email", to: OWNER, file: "LTR-0001-Signed letter.pdf" });
    expect(sendWaFile).not.toHaveBeenCalled();
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.to).toBe(OWNER);
    expect(message.subject).toBe("Your signed letter");
    expect(message.html).toContain("WhatsApp did not deliver it");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments![0].filename).toBe("LTR-0001-Signed letter.pdf");
    expect(atob(message.attachments![0].content)).toContain("%PDF-1.7");
  });

  it("emails the owner when the bridge throws instead of claiming WhatsApp delivered it", async () => {
    vi.mocked(sendWaFile).mockRejectedValueOnce(new Error("sidecar unreachable"));

    const result = await call("send_whatsapp_file", { file: "LTR-0001-Signed letter.pdf" });

    expect(result).toMatchObject({ ok: true, via: "email" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not email when the caller turns the fallback off", async () => {
    vi.mocked(bridgeState).mockResolvedValue({ state: "stopped" });

    const result = await call("send_whatsapp_file", { file: "Signed letter", email_fallback: false });

    expect(result).toMatchObject({ error: expect.stringMatching(/WhatsApp isn't connected/) });
    expect(result).toHaveProperty("hint", expect.stringMatching(/email_owner/));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still uses WhatsApp when it is connected", async () => {
    const result = await call("send_whatsapp_file", { file: "Signed letter", caption: "Here it is" });

    expect(result).toMatchObject({ ok: true, message_id: "provider-id" });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("email_owner", () => {
  it("emails a saved file to the owner with its subject and note", async () => {
    const result = await call("email_owner", {
      file: "Signed letter",
      subject: "Signed letter",
      note: "As requested.",
    });

    expect(result).toMatchObject({ ok: true, to: OWNER, file: "LTR-0001-Signed letter.pdf" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const message = vi.mocked(sendEmail).mock.calls[0][0];
    expect(message.to).toBe(OWNER);
    expect(message.subject).toBe("Signed letter");
    expect(message.html).toContain("As requested.");
    expect(message.attachments![0].filename).toBe("LTR-0001-Signed letter.pdf");
  });

  it("refuses a file it cannot read instead of emailing an empty message", async () => {
    vi.mocked(fileBytes).mockResolvedValue(null);
    vi.mocked(listFiles).mockResolvedValue([]);

    const result = await call("email_owner", { file: "missing.pdf" });

    expect(result).toMatchObject({ error: expect.stringMatching(/No file matching/) });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
