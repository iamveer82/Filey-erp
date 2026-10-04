import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import { mediaCredential, getMediaConfig, createMediaDraft, startMedia, refreshMedia } from "../../lib/aiMedia";
import { hasCredential } from "../../lib/credentialStore";
import MediaSettings from "../MediaSettings";
import { VideoJobCard } from "../AgentVideoPanel";
import type { VideoJob } from "../../lib/aiVideo";

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("video-ui", "video-user");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setCacheOrg(null);
});

it("saves the user's video key for this browser session and runs a confirmed provider job without Coin", async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ request_id: "ui-request-1" }), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", request);
  render(<MemoryRouter><MediaSettings /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Video API key"), { target: { value: "fixture-video-own-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Save video settings" }));
  await screen.findByText("Media settings saved. No generation request was sent.");
  expect(hasCredential(mediaCredential("video"))).toBe(true);
  expect(getMediaConfig().videoSource).toBe("byok");
  expect(JSON.stringify(localStorage)).not.toContain("fixture-video-own-key");
  expect(request).not.toHaveBeenCalled();
  const draft = await createMediaDraft("video", "Our coffee packaging", { duration: 5 });
  expect(draft.state).toBe("draft");
  expect(request).not.toHaveBeenCalled();
  const accepted = await startMedia(draft.id);
  expect(accepted.state).toBe("queued");
  expect(request.mock.calls[0][0]).toBe("https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video");
  expect(request.mock.calls[0][1].headers.authorization).toBe("Key fixture-video-own-key");
  request.mockResolvedValueOnce(new Response(JSON.stringify({ status: "COMPLETED" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ video: { url: "https://v3.fal.media/coffee.mp4" } })));
  expect(await refreshMedia(draft.id)).toMatchObject({ state: "completed", outputUrl: "https://v3.fal.media/coffee.mp4" });
  expect(request.mock.calls.every(([url]) => String(url).startsWith("https://queue.fal.run/"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
  await waitFor(() => expect(hasCredential(mediaCredential("video"))).toBe(false));
  await expect(createMediaDraft("video", "Disconnected film")).rejects.toThrow("API key");
});

it("historical Coin drafts cannot expose a Generate action", () => {
  const job = { id: "91000000-0000-4000-8000-000000000001", state: "draft", prompt: "Older film", duration: 5, charge_micros: 1250000, charged_micros: 0, aspect_ratio: "9:16", generate_audio: true, has_reference: false, quote_expires_at: new Date(Date.now() + 600000).toISOString(), created_at: new Date().toISOString(), started_at: null, output_url: null, error: null } satisfies VideoJob;
  render(<MemoryRouter><VideoJobCard id={job.id} initial={job} /></MemoryRouter>);
  expect(screen.queryByRole("button", { name: /Generate/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  expect(screen.getByRole("link", { name: "Set up video API key" })).toHaveAttribute("href", "/settings?section=ai");
  expect(screen.getByText(/older draft cannot be generated with Coin/i)).toBeInTheDocument();
});
