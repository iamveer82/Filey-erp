import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { localClient } from "../localdb";
import { agentStorageScope } from "../agentStorage";
import { checkLocalEmailSetup, clearLocalEmailConnection, readLocalEmailConnection, saveLocalEmailConnection, sendPersonalEmail } from "../localEmail";

const boundary = vi.hoisted(() => ({ native: vi.fn(), mobile: vi.fn(), isMobile: vi.fn(), vault: new Map<string, string>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: boundary.native }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: boundary.isMobile }, CapacitorHttp: { request: boundary.mobile } }));
const KEY = "re_personal_fixture_123", ID = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";
const config = { senderEmail: "accounts@company.example", senderName: "Example Company" };
const msg = { to: "customer@example.com", subject: "Invoice", html: "<p>Invoice attached</p>", attachments: [{ filename: "invoice.pdf", content: "JVBERg==" }] };
const sends = () => boundary.native.mock.calls.filter(([command]) => command === "ai_proxy");
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  setCacheOrg(null); setCacheOrg("email-org", "email-owner");
  vi.clearAllMocks(); boundary.vault.clear(); boundary.isMobile.mockReturnValue(false);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
  boundary.native.mockImplementation(async (command, args) => {
    const key = `${args.scope}:${args.name}`;
    if (command === "credential_write") { if (args.value) boundary.vault.set(key, args.value); else boundary.vault.delete(key); return; }
    if (command === "credential_read") return boundary.vault.get(key) ?? null;
    if (command === "ai_proxy") return { status: 200, body: JSON.stringify({ id: ID }) };
    throw new Error(`Unexpected native command ${command}`);
  });
  boundary.mobile.mockResolvedValue({ status: 200, data: { id: ID } });
});
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); setCacheOrg(null); vi.useRealTimers(); vi.restoreAllMocks(); });

it("saves and checks setup without sending, stores no plaintext key, and isolates account and org", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  await saveLocalEmailConnection(config, KEY);
  await checkLocalEmailSetup();
  expect(sends()).toHaveLength(0); expect(boundary.mobile).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  expect(JSON.stringify(localStorage)).not.toContain(KEY);
  expect(readLocalEmailConnection()).toEqual({ ...config, keyStored: true });
  setCacheOrg("email-org", "other-owner");
  expect(readLocalEmailConnection()).toEqual({ senderEmail: "", senderName: "", keyStored: false });
  setCacheOrg("other-org", "email-owner");
  expect(readLocalEmailConnection().keyStored).toBe(false);
  setCacheOrg("email-org", "email-owner");
  await clearLocalEmailConnection();
  expect(readLocalEmailConnection()).toEqual({ senderEmail: "", senderName: "", keyStored: false });
  expect(sends()).toHaveLength(0);
});

it("sends one fixed native request with reviewed bytes and writes only a scoped local receipt", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  await saveLocalEmailConnection(config, KEY);
  const input = structuredClone(msg);
  const pending = sendPersonalEmail(input);
  input.to = "changed@example.com"; input.attachments[0].content = "d3Jvbmc=";
  await pending;
  expect(sends()).toHaveLength(1);
  const request = sends()[0][1];
  expect(request).toMatchObject({ method: "POST", url: "https://api.resend.com/emails", headers: { Authorization: `Bearer ${KEY}` } });
  expect(request.headers["Idempotency-Key"]).toMatch(/^filey-personal\/[a-f0-9-]{36}$/);
  expect(JSON.parse(request.body)).toEqual({ from: "Example Company <accounts@company.example>", to: [msg.to], subject: msg.subject, html: msg.html, attachments: msg.attachments });
  const rows = (await localClient.from("email_messages").select()).data;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ to_email: msg.to, status: "sent", org_id: "email-org", user_id: "email-owner" });
  expect(network).not.toHaveBeenCalled(); expect(boundary.mobile).not.toHaveBeenCalled();
});

it("uses native mobile HTTP without redirects and accepts a valid JSON receipt", async () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); boundary.isMobile.mockReturnValue(true);
  await saveLocalEmailConnection(config, KEY);
  await sendPersonalEmail(msg);
  expect(boundary.mobile).toHaveBeenCalledOnce();
  expect(boundary.mobile.mock.calls[0][0]).toMatchObject({ url: "https://api.resend.com/emails", method: "POST", disableRedirects: true, connectTimeout: 30_000, readTimeout: 60_000, responseType: "text" });
  expect(sends()).toHaveLength(0);
  expect(JSON.stringify(localStorage)).not.toContain(KEY);
});

it("accepts a realistic five-megabyte attachment without regex stack exhaustion", async () => {
  await saveLocalEmailConnection(config, KEY);
  const content = "A".repeat(7_000_000);
  await sendPersonalEmail({ ...msg, attachments: [{ filename: "large-invoice.pdf", content }] });
  expect(sends()).toHaveLength(1);
  expect(JSON.parse(sends()[0][1].body).attachments[0].content).toBe(content);
});

it.each([
  { status: 403, body: JSON.stringify({ message: `bad key ${KEY}` }) },
  { status: 429, body: JSON.stringify({ message: "quota exceeded" }) },
  { status: 302, body: JSON.stringify({ id: ID }) },
  { status: 200, body: "<html>proxy</html>" },
  { status: 200, body: "{}" },
  { status: 200, body: JSON.stringify({ id: "not-a-receipt" }) },
  { status: 200, body: JSON.stringify({ id: ID, error: KEY }) },
])("does not report a phantom send or expose errors for receipt $status / $body", async response => {
  await saveLocalEmailConnection(config, KEY);
  boundary.native.mockImplementation(async (command, args) => command === "credential_read" ? boundary.vault.get(`${args.scope}:${args.name}`) : response);
  await expect(sendPersonalEmail(msg)).rejects.toThrow(/Resend|confirmed/);
  expect(sends()).toHaveLength(1);
  const rows = (await localClient.from("email_messages").select()).data;
  expect(rows[0].status).toBe("failed"); expect(rows[0].error).not.toContain(KEY);
});

it("redacts thrown native and secure-store errors and never retries", async () => {
  await saveLocalEmailConnection(config, KEY);
  boundary.native.mockRejectedValueOnce(new Error(`credential failure ${KEY}`));
  await expect(sendPersonalEmail(msg)).rejects.toThrow("secure storage");
  expect(sends()).toHaveLength(0);
  boundary.native.mockImplementation(async command => { if (command === "credential_read") return KEY; throw new Error(`Authorization: Bearer ${KEY}`); });
  const error = await sendPersonalEmail(msg).catch(error => error as Error);
  expect(error?.message).toContain("Check your Resend dashboard"); expect(error?.message).not.toContain(KEY);
  expect(sends()).toHaveLength(1);
});

it("bounds an ambiguous send timeout without retrying or accepting its late receipt", async () => {
  await saveLocalEmailConnection(config, KEY);
  let resolve!: (response: unknown) => void;
  boundary.native.mockImplementation(async command => command === "credential_read" ? KEY : new Promise(done => { resolve = done; }));
  vi.useFakeTimers();
  const pending = sendPersonalEmail(msg).catch(error => error as Error);
  await vi.advanceTimersByTimeAsync(60_001);
  expect((await pending)?.message).toContain("Check your Resend dashboard");
  resolve({ status: 200, body: JSON.stringify({ id: ID }) });
  expect(sends()).toHaveLength(1);
  expect((await localClient.from("email_messages").select()).data[0].status).toBe("failed");
});

it("rejects an account change during credential lookup before dispatch or logging", async () => {
  await saveLocalEmailConnection(config, KEY);
  let resume!: (value: string) => void;
  boundary.native.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
  const pending = sendPersonalEmail(msg);
  await vi.waitFor(() => expect(resume).toBeTypeOf("function"));
  setCacheOrg("other-org", "other-user"); resume(KEY);
  await expect(pending).rejects.toThrow(/account changed/);
  expect(sends()).toHaveLength(0);
  expect((await localClient.from("email_messages").select()).data).toEqual([]);
});

it("drops a response after switching to cloud without any local or hosted log", async () => {
  await saveLocalEmailConnection(config, KEY);
  let resume!: (value: unknown) => void;
  boundary.native.mockImplementation(async command => command === "credential_read" ? KEY : new Promise(resolve => { resume = resolve; }));
  const pending = sendPersonalEmail(msg);
  await vi.waitFor(() => expect(sends()).toHaveLength(1));
  localStorage.setItem("filey_data_mode", "cloud"); resume({ status: 200, body: JSON.stringify({ id: ID }) });
  await expect(pending).rejects.toThrow(/account changed/);
  expect((await localClient.from("email_messages").select()).data).toEqual([]);
});

it("requires an installed app in browser local mode, with no fetch or hosted fallback", async () => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  const network = vi.spyOn(globalThis, "fetch");
  await saveLocalEmailConnection(config, KEY);
  await expect(checkLocalEmailSetup()).rejects.toThrow("installed Filey");
  await expect(sendPersonalEmail(msg)).rejects.toThrow("installed Filey");
  expect(network).not.toHaveBeenCalled(); expect(sends()).toHaveLength(0); expect(boundary.mobile).not.toHaveBeenCalled();
});

it.each([
  { ...msg, to: "a@example.com,b@example.com" },
  { ...msg, subject: "Invoice\r\nBcc: other@example.com" },
  { ...msg, attachments: [{ filename: "../invoice.pdf", content: "JVBERg==" }] },
  { ...msg, attachments: [{ filename: "invoice.pdf", content: "https://example.com/file.pdf" }] },
  { ...msg, attachments: [{ filename: "invoice.pdf", content: "%%%" }] },
])("rejects malformed addresses, headers or attachment bytes before any provider call", async invalid => {
  await saveLocalEmailConnection(config, KEY);
  await expect(sendPersonalEmail(invalid)).rejects.toThrow();
  expect(sends()).toHaveLength(0); expect(boundary.mobile).not.toHaveBeenCalled();
});

it("refuses a setup draft from a previous workspace before writing its key or sender", async () => {
  const oldScope = agentStorageScope()!;
  setCacheOrg("other-org", "other-user");
  await expect(saveLocalEmailConnection(config, KEY, oldScope)).rejects.toThrow("account changed");
  expect(boundary.native).not.toHaveBeenCalled();
  expect(readLocalEmailConnection().senderEmail).toBe("");
});
