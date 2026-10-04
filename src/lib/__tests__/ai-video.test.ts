import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { supabase } from "../supabase";
import { quoteVideo, startVideo, getVideo, cancelVideo, type VideoJob } from "../aiVideo";
import { saveChats, loadChats, newChat } from "../aiChats";
import { createGuard } from "../agentGuard";
import { TOOLS, runTool, endTurn } from "../aiTools";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";
import { writeAgentStorage } from "../agentStorage";
import { saveCredential } from "../credentialStore";
import { getMediaConfig, mediaCredential } from "../aiMedia";
const job = {
  id: "91000000-0000-4000-8000-000000000001",
  state: "draft",
  charge_micros: 1250000,
  duration: 5,
} as VideoJob;
const invoke = vi.fn();
beforeEach(async () => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("org-a", "user-a");
  writeAgentStorage("filey.ai.media.config", JSON.stringify({ videoSource: "credits" }));
  setAgentMode("auto");
  await saveCredential(mediaCredential("video"), "fixture-owned-video-key");
  vi.spyOn(supabase!.auth, "getSession").mockResolvedValue({
    data: { session: { user: { id: "user-a" }, access_token: "fixture-user-a-token" } },
    error: null,
  } as never);
  vi.spyOn(supabase!, "functions", "get").mockReturnValue({ invoke } as never);
  invoke.mockReset().mockResolvedValue({ data: { job }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  setCacheOrg(null);
});
it("retired Coin video settings prepare an own-key draft without a hosted quote or charge", async () => {
  expect(getMediaConfig().videoSource).toBe("byok");
  const result = await runTool(
    "create_video_draft",
    { prompt: "Coffee brand film", duration: 5 },
    async () => true,
    true,
    "video-turn"
  );
  expect(result).toMatchObject({ pending_action: "media_approval", billing: "user_provider", state: "draft" });
  expect(result).not.toHaveProperty("price_usd");
  expect(invoke).not.toHaveBeenCalled();
  expect(TOOLS.some((t) => /start_video|generate_video/.test(t.name))).toBe(false);
  const files = endTurn("video-turn");
  expect(files).toEqual([{ name: "Brand video", mediaJobId: expect.stringMatching(/^media-/) }]);
  const chat = newChat();
  chat.turns = [{ role: "assistant", text: "Review this quote", files }];
  saveChats([chat]);
  expect(loadChats()[0].turns[0].files?.[0].mediaJobId).toBe(files[0].mediaJobId);
});
it("obsolete Coin quote and Generate entry points never dispatch a provider or wallet request", async () => {
  await expect(quoteVideo({ prompt: "test", duration: 5, aspect_ratio: "9:16", generate_audio: true })).rejects.toThrow("own API key");
  await expect(startVideo(job)).rejects.toThrow("cannot be generated with Coin");
  expect(invoke).not.toHaveBeenCalled();
});
it("historical jobs can still be read and canceled with pinned account auth and no automatic retries", async () => {
  await getVideo(job.id);
  await cancelVideo(job.id);
  expect(invoke.mock.calls.map((call) => call[1].body.action)).toEqual(["get", "cancel"]);
  expect(invoke.mock.calls.every((call) => call[1].headers.Authorization === "Bearer fixture-user-a-token")).toBe(true);
  invoke.mockClear().mockResolvedValue({ error: { context: { json: async () => ({ error: "Connection lost" }) } } });
  await expect(cancelVideo(job.id)).rejects.toThrow("Connection lost");
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("historical job responses are discarded after a workspace switch", async () => {
  invoke.mockImplementation(async () => {
    setCacheOrg("org-b", "user-a");
    return { data: { job }, error: null };
  });
  await expect(getVideo(job.id)).rejects.toThrow("workspace changed");
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
