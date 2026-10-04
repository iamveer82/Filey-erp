import { beforeEach, expect, it, vi } from "vitest";
import { checkHostedEmailConnection, sendEmail } from "../email";
const boundary = vi.hoisted(() => ({ local: true, scope: "email-org:user:email-user", personal: vi.fn(), hosted: vi.fn(), cap: vi.fn(), bump: vi.fn(), log: vi.fn(), session: vi.fn(), header: vi.fn(), authChanged: vi.fn() }));
const client = { auth: { getSession: boundary.session, onAuthStateChange: (callback: unknown) => {
  boundary.authChanged(callback); return { data: { subscription: { unsubscribe: vi.fn() } } };
} }, from: () => ({ insert: (row: unknown) => ({ setHeader: (name: string, value: string) => {
  boundary.header(name, value); return { abortSignal: (signal: AbortSignal) => boundary.log(row, signal) };
} }) }) };
vi.mock("../localEmail", () => ({ sendPersonalEmail: boundary.personal }));
vi.mock("../dataMode", () => ({ isLocalMode: () => boundary.local }));
vi.mock("../supabase", () => ({ get supabase() { return client; }, invokeFn: boundary.hosted }));
vi.mock("../license", () => ({ checkEmailDailyCap: boundary.cap, bumpEmailCount: boundary.bump }));
vi.mock("../api", () => ({ getCacheScope: () => boundary.scope }));
vi.mock("../agentStorage", () => ({ agentStorageScope: () => `${boundary.local ? "local" : "cloud"}:${boundary.scope}`, AGENT_STORAGE_EVENT: "filey:agent-storage" }));
const message = { to: "customer@example.com", subject: "Invoice", html: "<p>Invoice</p>" };
beforeEach(() => {
  vi.resetAllMocks(); boundary.local = true; boundary.scope = "email-org:user:email-user";
  boundary.personal.mockResolvedValue(undefined); boundary.cap.mockResolvedValue(undefined); boundary.bump.mockResolvedValue(undefined);
  boundary.hosted.mockResolvedValue({ data: {}, error: null }); boundary.log.mockResolvedValue({ error: null });
  boundary.session.mockResolvedValue({ data: { session: { access_token: "reviewed-token", user: { id: "email-user" } } }, error: null });
});
it("uses only the personal local sender, with no hosted usage or hosted status/log request", async () => {
  await sendEmail(message);
  expect(boundary.personal).toHaveBeenCalledWith(message);
  expect(boundary.hosted).not.toHaveBeenCalled(); expect(boundary.cap).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled(); expect(boundary.log).not.toHaveBeenCalled();
});
it("does not fall back or charge Filey when local setup or delivery fails", async () => {
  boundary.personal.mockRejectedValueOnce(new Error("Add your own Resend key"));
  await expect(sendEmail(message)).rejects.toThrow("Resend key");
  expect(boundary.personal).toHaveBeenCalledOnce(); expect(boundary.hosted).not.toHaveBeenCalled(); expect(boundary.cap).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled();
});
it("preserves the cloud hosted sender and its existing daily quota enforcement", async () => {
  boundary.local = false;
  await sendEmail(message);
  expect(boundary.cap).toHaveBeenCalledOnce(); expect(boundary.bump).toHaveBeenCalledOnce(); expect(boundary.personal).not.toHaveBeenCalled();
  expect(boundary.hosted).toHaveBeenCalledWith(client, "send-email", {
    body: { ...message, requestId: expect.any(String), attachments: undefined, expected_org_id: "email-org" },
    headers: { Authorization: "Bearer reviewed-token" }, signal: expect.any(AbortSignal),
  }, 0);
  expect(boundary.header).toHaveBeenCalledWith("Authorization", "Bearer reviewed-token");
  expect(boundary.log.mock.calls[0][0]).toMatchObject({ to_email: message.to, user_id: "email-user", org_id: "email-org", status: "sent" });
  expect(boundary.bump.mock.calls[0][0]).toBeTypeOf("function");
});

it.each(["account", "local-mode", "sdk-session"])("rejects a %s change while the hosted quota check is pending", async change => {
  boundary.local = false;
  let resume!: () => void;
  boundary.cap.mockReturnValueOnce(new Promise<void>(resolve => { resume = resolve; }));
  const pending = sendEmail(message);
  await vi.waitFor(() => expect(boundary.cap).toHaveBeenCalledOnce());
  if (change === "account") boundary.scope = "other-org:user:other-user";
  if (change === "local-mode") boundary.local = true;
  if (change === "sdk-session") boundary.session.mockResolvedValue({ data: { session: { access_token: "other-token", user: { id: "other-user" } } }, error: null });
  resume();
  await expect(pending).rejects.toThrow(/workspace changed|account changed/);
  expect(boundary.hosted).not.toHaveBeenCalled(); expect(boundary.personal).not.toHaveBeenCalled(); expect(boundary.log).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled();
});

it("rejects a session lookup that completes for a different account before even reading quota", async () => {
  boundary.local = false;
  let resume!: (value: unknown) => void;
  boundary.session.mockReturnValueOnce(new Promise(resolve => { resume = resolve; }));
  const pending = sendEmail(message);
  boundary.scope = "other-org:user:other-user";
  resume({ data: { session: { access_token: "other-token", user: { id: "other-user" } } }, error: null });
  await expect(pending).rejects.toThrow("workspace changed");
  expect(boundary.cap).not.toHaveBeenCalled(); expect(boundary.hosted).not.toHaveBeenCalled();
});

it("holds reviewed content and JWT through an allowed same-account token refresh and retry", async () => {
  boundary.local = false;
  boundary.hosted.mockImplementationOnce(async () => {
    boundary.session.mockResolvedValue({ data: { session: { access_token: "refreshed-token", user: { id: "email-user" } } }, error: null });
    return { data: null, error: { context: { status: 503 } } };
  });
  const input = { ...message, attachments: [{ filename: "invoice.pdf", content: "JVBERg==" }] };
  const pending = sendEmail(input);
  input.to = "edited@example.com"; input.attachments[0].content = "d3Jvbmc=";
  await pending;
  expect(boundary.hosted).toHaveBeenCalledTimes(2);
  const first = boundary.hosted.mock.calls[0][2], next = boundary.hosted.mock.calls[1][2];
  expect(first).toEqual(next);
  expect(first.headers.Authorization).toBe("Bearer reviewed-token");
  expect(first.body).toMatchObject({ to: message.to, attachments: [{ filename: "invoice.pdf", content: "JVBERg==" }] });
});

it("does not retry a hosted action after its account changes during backoff", async () => {
  boundary.local = false;
  boundary.hosted.mockResolvedValueOnce({ data: null, error: { context: { status: 503 } } });
  const pending = sendEmail(message);
  await vi.waitFor(() => expect(boundary.hosted).toHaveBeenCalledOnce());
  boundary.scope = "other-org:user:other-user";
  window.dispatchEvent(new Event("filey:agent-storage"));
  await expect(pending).rejects.toThrow("workspace changed");
  expect(boundary.hosted).toHaveBeenCalledOnce(); expect(boundary.log).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled();
});

it("drops a late cloud receipt without writing any next-account or local history/counter", async () => {
  boundary.local = false;
  let resume!: (value: unknown) => void;
  boundary.hosted.mockReturnValueOnce(new Promise(resolve => { resume = resolve; }));
  const pending = sendEmail(message);
  await vi.waitFor(() => expect(boundary.hosted).toHaveBeenCalledOnce());
  boundary.local = true; boundary.scope = "other-org:user:other-user";
  resume({ data: { id: "accepted" }, error: null });
  await expect(pending).rejects.toThrow("workspace changed");
  expect(boundary.log).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled(); expect(boundary.personal).not.toHaveBeenCalled();
});

it("pins an already dispatched history write and suppresses the counter after a late account switch", async () => {
  boundary.local = false;
  let resume!: (value: unknown) => void;
  boundary.log.mockReturnValueOnce(new Promise(resolve => { resume = resolve; }));
  const pending = sendEmail(message);
  await vi.waitFor(() => expect(boundary.log).toHaveBeenCalledOnce());
  expect(boundary.header).toHaveBeenCalledWith("Authorization", "Bearer reviewed-token");
  expect(boundary.log.mock.calls[0][0]).toMatchObject({ user_id: "email-user", org_id: "email-org" });
  boundary.scope = "other-org:user:other-user";
  window.dispatchEvent(new Event("filey:agent-storage"));
  expect(boundary.log.mock.calls[0][1].aborted).toBe(true);
  resume({ error: null });
  await expect(pending).rejects.toThrow("workspace changed");
  expect(boundary.bump).not.toHaveBeenCalled(); expect(boundary.log).toHaveBeenCalledOnce();
});

it("binds cloud status to the reviewed workspace and never checks hosted status in local mode", async () => {
  await expect(checkHostedEmailConnection()).rejects.toThrow("cloud workspace");
  expect(boundary.hosted).not.toHaveBeenCalled();
  boundary.local = false;
  boundary.hosted.mockResolvedValue({ data: { configured: true, from: "Filey <mail@gofiley.com>" }, error: null });
  await expect(checkHostedEmailConnection()).resolves.toMatchObject({ configured: true });
  expect(boundary.hosted.mock.calls[0][2]).toMatchObject({ body: { action: "status", expected_org_id: "email-org" }, headers: { Authorization: "Bearer reviewed-token" } });
  expect(boundary.cap).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled();
});
it("retains the cloud quota failure and never silently switches to a personal sender", async () => {
  boundary.local = false; boundary.cap.mockRejectedValueOnce(new Error("Daily email limit reached"));
  await expect(sendEmail(message)).rejects.toThrow("Daily email limit");
  expect(boundary.hosted).not.toHaveBeenCalled(); expect(boundary.personal).not.toHaveBeenCalled(); expect(boundary.bump).not.toHaveBeenCalled();
});
