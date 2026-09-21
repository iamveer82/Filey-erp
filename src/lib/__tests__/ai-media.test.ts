import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { requireAgentStorageScope, writeAgentStorage } from "../agentStorage";
import { saveCredential, hasCredential } from "../credentialStore";
import {
  createMediaDraft,
  getMediaConfig,
  saveMediaConfig,
  mediaCredential,
  startMedia,
  refreshMedia,
  getMediaJob,
  listMediaJobs,
  cancelMedia,
  safeMediaUrl,
} from "../aiMedia";
import { loadChats, saveChats, newChat } from "../aiChats";
import { setImageConfig } from "../aiImage";
import { runTool, endTurn } from "../aiTools";
import { setAgentMode } from "../agentMode";

const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock("../aiMediaStore", () => ({
  mediaBlob: async (id: string, scope: string, value?: Blob) => {
    if (value) blobs.set(`${scope}:${id}`, value);
    return blobs.get(`${scope}:${id}`);
  },
}));
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
beforeEach(async () => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg(null);
  setCacheOrg("org-media", "user-media");
  setAgentMode("auto");
  blobs.clear();
  await saveMediaConfig(
    { ...getMediaConfig(), imageProvider: "fal" },
    "image",
    "fixture-image-key",
    requireAgentStorageScope()
  );
  await saveCredential(mediaCredential("video"), "fixture-video-key");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCacheOrg(null);
});
it("prepares both kinds through agent tools without billing; cards survive chat reload", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const image = (await runTool(
    "generate_image",
    { prompt: "A coffee bag" },
    async () => true,
    true,
    "image-draft"
  )) as { state: string };
  const video = (await runTool(
    "create_video_draft",
    { prompt: "A coffee film", duration: 5 },
    async () => true,
    true,
    "video-draft"
  )) as { state: string };
  expect(image.state).toBe("draft");
  expect(video.state).toBe("draft");
  expect(network).not.toHaveBeenCalled();
  const files = [...endTurn("image-draft"), ...endTurn("video-draft")];
  expect(files.every((file) => file.mediaJobId?.startsWith("media-"))).toBe(true);
  const chat = newChat();
  chat.turns = [{ role: "assistant", text: "Review", files }];
  saveChats([chat]);
  expect(loadChats()[0].turns[0].files).toEqual(files);
  expect(JSON.stringify(localStorage)).not.toContain("fixture-image-key");
  expect(JSON.stringify(localStorage)).not.toContain("fixture-video-key");
});
it("submits once on repeated clicks and never follows provider-supplied request URLs", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(
      reply({ request_id: "request-1", status_url: "https://attacker.example/steal" })
    );
  vi.stubGlobal("fetch", request);
  const draft = await createMediaDraft("video", "Coffee film", { duration: 5 });
  const [a, b] = await Promise.all([startMedia(draft.id), startMedia(draft.id)]);
  expect(a).toEqual(b);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe(
    "https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video"
  );
  expect(request.mock.calls[0][1].headers.authorization).toBe("Key fixture-video-key");
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
    num_frames: 81,
    frames_per_second: 16,
  });
  request
    .mockResolvedValueOnce(reply({ status: "COMPLETED" }))
    .mockResolvedValueOnce(reply({ video: { url: "https://v3.fal.media/film.mp4" } }));
  const completed = await refreshMedia(a.id);
  expect(completed.state).toBe("completed");
  expect(request.mock.calls[1][0]).toBe(
    "https://queue.fal.run/fal-ai/wan/requests/request-1/status"
  );
  expect(request.mock.calls[2][0]).toBe(
    "https://queue.fal.run/fal-ai/wan/requests/request-1"
  );
  await startMedia(a.id);
  expect(request).toHaveBeenCalledTimes(3);
});
it("keeps a lost submission uncertain instead of retrying a possibly billable call", async () => {
  const request = vi.fn().mockRejectedValue(new Error("Network lost"));
  vi.stubGlobal("fetch", request);
  const draft = await createMediaDraft("image", "Coffee photo");
  expect((await startMedia(draft.id)).state).toBe("uncertain");
  await startMedia(draft.id);
  await refreshMedia(draft.id);
  expect(request).toHaveBeenCalledTimes(1);
  expect(getMediaJob(draft.id).error).toMatch(/will not resubmit/);
});
it("recognizes a page closed during submission and never resubmits the stored job", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const draft = await createMediaDraft("video", "Interrupted video");
  writeAgentStorage(
    `filey.ai.media.job.${draft.id}`,
    JSON.stringify({ ...draft, state: "submitting" })
  );
  expect(getMediaJob(draft.id).state).toBe("uncertain");
  await startMedia(draft.id);
  expect(getMediaJob(draft.id).state).toBe("uncertain");
  expect(request).not.toHaveBeenCalled();
});
it("reports failed authentication without storing provider-echoed credentials", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(reply({ error: { message: "Bad key fixture-image-key" } }, 401));
  vi.stubGlobal("fetch", request);
  const job = await createMediaDraft("image", "Coffee photo");
  const result = await startMedia(job.id);
  expect(result.state).toBe("failed");
  expect(result.error).toContain("401");
  expect(JSON.stringify(localStorage)).not.toContain("fixture-image-key");
  expect(request).toHaveBeenCalledTimes(1);
});
it("isolates jobs and discards responses across account changes; key removal really disconnects", async () => {
  const job = await createMediaDraft("video", "Coffee film");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      setCacheOrg("different-org", "different-user");
      return reply({ request_id: "request-2" });
    })
  );
  await expect(startMedia(job.id)).rejects.toThrow(/workspace/);
  expect(listMediaJobs()).toEqual([]);
  expect(() => getMediaJob(job.id)).toThrow(/current workspace/);
  await saveMediaConfig(
    getMediaConfig(),
    "video",
    "temporary-key",
    requireAgentStorageScope()
  );
  await saveMediaConfig(getMediaConfig(), "video", "", requireAgentStorageScope());
  expect(hasCredential(mediaCredential("video"))).toBe(false);
  await expect(createMediaDraft("video", "Another film")).rejects.toThrow(/API key/);
});
it("snapshots an OpenAI-compatible image endpoint and keeps bytes outside chat JSON", async () => {
  await saveMediaConfig(
    { ...getMediaConfig(), imageProvider: "openai" },
    "image",
    undefined,
    requireAgentStorageScope()
  );
  setImageConfig({
    baseUrl: "https://images.example/v1",
    apiKey: "fixture-compatible-key",
    model: "custom-image",
  });
  const draft = await createMediaDraft("image", "Coffee bag");
  setImageConfig({
    baseUrl: "https://other.example/v1",
    apiKey: "fixture-other-key",
    model: "other-image",
  });
  const request = vi.fn().mockResolvedValue(reply({ data: [{ b64_json: "aGk=" }] }));
  vi.stubGlobal("fetch", request);
  const result = await startMedia(draft.id);
  expect(result).toMatchObject({ state: "completed", blob: true });
  expect(request.mock.calls[0][0]).toBe("https://images.example/v1/images/generations");
  expect(request.mock.calls[0][1].headers.authorization).toBe(
    "Bearer fixture-compatible-key"
  );
  expect(blobs.size).toBe(1);
  expect(JSON.stringify(localStorage)).not.toContain("aGk=");
});
it("rejects invalid inputs before requests, and cancellation acceptance is not completion", async () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  await expect(createMediaDraft("video", "test", { duration: -1 })).rejects.toThrow(
    /5 or 10/
  );
  await expect(createMediaDraft("image", " ")).rejects.toThrow(/Describe/);
  expect(() => safeMediaUrl("http://example.com/image.png")).toThrow();
  expect(() => safeMediaUrl("https://user:password@example.com/image.png")).toThrow();
  expect(() => safeMediaUrl("https://127.0.0.1/image.png")).toThrow();
  expect(request).not.toHaveBeenCalled();
  const draft = await createMediaDraft("video", "Coffee film");
  request
    .mockResolvedValueOnce(reply({ request_id: "request-3" }))
    .mockResolvedValueOnce(reply({ status: "CANCELLATION_REQUESTED" }, 202));
  await startMedia(draft.id);
  expect((await cancelMedia(draft.id)).state).toBe("queued");
  expect(request.mock.calls[1][1].method).toBe("PUT");
});
