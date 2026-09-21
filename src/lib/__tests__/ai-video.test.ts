import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { supabase } from "../supabase";
import { quoteVideo, startVideo, type VideoJob } from "../aiVideo";
import { saveChats, loadChats, newChat } from "../aiChats";
import { createGuard } from "../agentGuard";
import { TOOLS, runTool, endTurn } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
const job = {
  id: "91000000-0000-4000-8000-000000000001",
  state: "draft",
  charge_micros: 1250000,
  duration: 5,
} as VideoJob;
const invoke = vi.fn();
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("org-a", "user-a");
  setAgentMode("auto");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "user-a" } } },
    error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  invoke.mockReset().mockResolvedValue({ data: { job }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  setCacheOrg(null);
});
it("video tools only prepare a quote; no agent tool can submit paid generation", async () => {
  const result = await runTool(
    "create_video_draft",
    { prompt: "Coffee brand film", duration: 5 },
    async () => true,
    true,
    "video-turn"
  );
  expect(result).toMatchObject({ pending_action: "video_approval", price_usd: 1.25 });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0][1].body.action).toBe("quote");
  expect(TOOLS.some((t) => /start_video|generate_video/.test(t.name))).toBe(false);
  const files = endTurn("video-turn");
  expect(files).toEqual([{ name: "Brand video", videoJobId: job.id }]);
  const chat = newChat();
  chat.turns = [{ role: "assistant", text: "Review this quote", files }];
  saveChats([chat]);
  expect(loadChats()[0].turns[0].files?.[0].videoJobId).toBe(job.id);
});
it("a user click sends only the stored quote identity and amount, with no retry on lost response", async () => {
  invoke.mockResolvedValue({
    error: { context: { json: async () => ({ error: "Connection lost" }) } },
  });
  await expect(startVideo(job)).rejects.toThrow("Connection lost");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]).toEqual([
    "ai-video",
    { body: { action: "start", id: job.id, charge_micros: 1250000 } },
  ]);
});
it("workspace changes discard a response and invalid attachments never leave the device", async () => {
  await expect(
    quoteVideo(
      { prompt: "test", duration: 5, aspect_ratio: "9:16", generate_audio: true },
      new File(["x"], "file.pdf", { type: "application/pdf" })
    )
  ).rejects.toThrow("JPG");
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockImplementation(async () => {
    setCacheOrg("org-b", "user-a");
    return { data: { job }, error: null };
  });
  await expect(startVideo(job)).rejects.toThrow("workspace changed");
});
it("job progress is re-read while duplicate video drafts remain suppressed", () => {
  const guard = createGuard();
  guard.after("get_video_job", { id: job.id }, { state: "queued" });
  expect(guard.before("get_video_job", { id: job.id })).toEqual({});
  guard.after("create_video_draft", { prompt: "test", duration: 5 }, { job_id: job.id });
  expect(
    guard.before("create_video_draft", { prompt: "test", duration: 5 }).short
  ).toBeTruthy();
});
