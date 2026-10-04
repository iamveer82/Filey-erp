# Videos in Filey AI

New videos use the customer's own fal API key. Filey does not provide a
Coin-funded video model. The chat model and Coin wallet are separate from video
generation. These changes are local and unpublished; web, Edge Function and
desktop publishing remain on hold.

## Create a video

1. Sign in and open Settings → AI → Video generation. Save your own fal key.
   The supported model is Wan 2.2: silent 720p video, approximately 5 or 10 seconds.
2. Open Filey AI → Images and videos, choose Video, and describe the scene.
   Select portrait, landscape or square. You can attach a JPG, PNG or WebP
   reference photo under 2 MB. The agent can also prepare this draft in chat.
3. Review the card, then click **Generate**. Only this click submits generation;
   preparing a draft does not contact the generation provider. The agent cannot
   approve the card on your behalf.
4. Follow the card's status. A finished video plays inline. Download or open the
   original to keep a copy before its provider link expires.

fal bills the customer's provider account at its current rates. No Coin is
deducted for video generation. A valid key and sufficient provider balance are
required; Filey does not include free or unlimited provider usage.

## Keys, storage and recovery

Keys are scoped to the signed-in account/workspace. Desktop keeps them in the
OS credential vault. Web and mobile web keep keys in memory for the browser
session; enter the key again after reload or sign-out. Remove or replace it in
Video generation settings. Keys are not placed in model messages or chat history.

New media requests go directly to fal, without Supabase carrying the key,
generation request or polling traffic. The prompt and any reference photo go
to the selected provider. Job metadata and chat references stay on this device
in the current workspace; switching storage mode does not archive video bytes
in Filey Cloud. See [Images and videos in chat](ai-media.md) for media storage.

Generate clicks share a lock and durable pre-submit state. An interrupted or
ambiguous submission is not resubmitted: check the provider's request history
before creating another request. Reopening a queued job resumes checks after
its key is available. Stopping chat does not cancel generation. A cancellation
request is not proof that processing stopped or that the provider refunded it.

## Previous managed jobs — legacy only

**Previous Filey video requests** opens the former managed-job history. Existing
jobs can be viewed, refreshed and, where supported, canceled; an old draft can
be discarded. Drafts have no Generate action. Saved settings that previously
selected credit funding now use the own-key video path.

The `ai-video` endpoint rejects new `quote` and `start` actions, including calls
from stale clients, before any provider request, wallet reservation or job write.
Its list response reports generation as unconfigured. Existing get/cancel
actions and authenticated provider callbacks remain for prior jobs. Verification
can finish or release an already submitted job's existing hold; retirement does
not cancel provider work that was previously accepted.

Legacy Supabase job metadata, service-only transition permissions and callback
verification remain intact. Video bytes are held by the provider, not Supabase.
Callbacks carry an opaque per-job token and independently verify provider status;
incoming callback prices, states and URLs are not settlement authority. Keep any
existing provider credentials server-side solely for this reconciliation. Do
not configure a new managed provider, wallet video offer or video checkout.

Historical operations used `supabase/2026-09-21-ai-video.sql` and the Higgsfield
request/callback lifecycle. Those operations are compatibility support, not
instructions to enable new video generation. Previously recorded deployment
checks do not establish that this local transition is live or that a current
provider account works. Validation uses synthetic provider responses; no live
paid generation is part of this change.

Provider references:

- [Wan 2.2 API](https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/api)
- [fal queue lifecycle](https://fal.ai/docs/documentation/model-apis/inference/queue)
- Legacy Higgsfield: [request lifecycle](https://docs.higgsfield.ai/docs/concepts/requests),
  [billing and retention](https://docs.higgsfield.ai/docs/concepts/billing-and-retention),
  [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks).
