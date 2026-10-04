# Images and videos in Filey AI

Open Filey AI → Images and videos, or ask the agent for an image/video. Both
paths create a review card in the conversation. **Generate** sends one request
to the selected provider with the customer's own API key. Preparing a draft
does not send a generation request. These requests never deduct Coin. New video
generation only uses the customer's key; there is no Filey-funded video option.

These changes are local and unpublished. Web, Edge Function and desktop
publishing remain on hold.

Settings → AI has independent image and video connections:

- Images: OpenAI-compatible `/images/generations` endpoints, or fal FLUX Schnell
  and FLUX Dev. Custom image APIs must support that protocol; a chat-only model
  does not become an image model by entering its ID.
- Videos: fal Wan 2.2, silent 720p, approximately 5 or 10 seconds. Optional JPG,
  PNG or WebP reference photo under 2 MB. Save your own fal key, prepare a video
  draft, then click Generate on its card. fal bills your provider account at its
  current rates; a valid key and sufficient provider balance are required.

Keys are scoped to the account/workspace. Desktop uses the existing OS vault;
the web/mobile app keeps keys only in memory until reload/sign-out. Separate
image and video keys can be removed in their respective settings. Neither the
model nor chat history receives these credentials. fal supports browser requests;
other image providers need CORS support on web, or Filey's desktop native proxy.
No media request or polling traffic goes through Supabase in BYOK mode.

OpenAI-compatible images are stored in device IndexedDB and shown inline with a
download button. fal output links appear as images or inline video players with
native controls and `playsInline`; download/open the original to keep a copy
before provider links expire. Media history is device/workspace-local, not
cross-device cloud storage. Removing browser site data removes local outputs.

Job metadata and chat references survive a reload. Queue status resumes on the
same device after its key is entered again. Paid submissions are not retried.
A durable pre-submit state and cross-tab lock prevent duplicate Generate clicks.
Interrupted/ambiguous submissions direct the user to provider history and cannot
be automatically resubmitted. Cancellation acceptance is not reported as proof
that a running provider request stopped or was refunded.

**Previous Filey video requests** contains legacy managed-job history only.
Existing jobs can be viewed, refreshed or canceled where supported, and old
drafts can be discarded. New managed quotes and submissions are disabled in the
app and server, including stale-client requests. Saved credit-video settings
now resolve to the customer's own-key path. Existing provider callbacks can
still reconcile previously submitted jobs and their existing holds. See
[Videos in Filey AI](ai-video.md) for the legacy compatibility boundary.

Verification uses mocked provider calls and an isolated browser fixture; no
customer records or paid generation are needed. Real provider generation still
requires the customer's valid, funded key. Web/Edge publishing and a desktop
rebuild are required to distribute these changes once the hold is lifted.

Provider references:

- [fal queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [FLUX Schnell API](https://fal.ai/models/fal-ai/flux/schnell/api)
- [Wan 2.2 API](https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/api)

Historical BYOK validation: 1,647 tests passed in the full app suite, plus the
new desktop binary-download regression test; TypeScript, production web build,
changed-file lint and native cargo check passed. Isolated browser checks covered
390px/1280px settings, image generation with synthetic provider responses,
inline video playback, persisted media after reload and removing a BYOK key.
No live provider generation was performed.
