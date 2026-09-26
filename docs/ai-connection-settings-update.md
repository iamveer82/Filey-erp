# Filey AI connection settings — 13 September 2026

Settings → AI Assistant now has explicit **Save changes**, **Test connection**,
**Find models**, and masked key controls with consistent pill buttons. A test
saves the current configuration, sends only a short greeting, and reports the
result inline. It does not read or change business records. Provider requests
still use the user's own account, quota and billing.

## Fixes

- Chat and agent requests share OpenAI reasoning-model parameter handling.
  Those models use `max_completion_tokens` without an incompatible temperature.
- Claude agent requests no longer force temperature. Connection tests allow
  2,048 output/reasoning tokens instead of eight, avoiding false empty-response
  failures for ordinary reasoning-model checks. Models requiring more reasoning
  may still return no text; this is reported separately from invalid keys.
- The localhost preview forwards requests to a fixed list of provider origins,
  avoiding provider CORS failures. It is not an arbitrary URL proxy. Production
  desktop continues to use the native `ai_proxy` command; hosted browser builds
  still require provider CORS support.
- Model discovery uses the selected provider's `/models` endpoint with the
  appropriate authentication headers. Providers without a compatible catalogue
  can use manual model IDs. Catalogue results do not guarantee tool/vision support.
- Each provider keeps its own credential. An unsaved replacement is discarded
  when switching hosts and is never sent to the new provider. Clearing a key
  takes effect when Save changes is clicked.
- Failed vault writes are reported rather than advertised as saved. A failed
  unrelated integration credential no longer blocks saving/testing an AI key.
- Key rejection, permissions, quota, missing models, timeouts and network errors
  have inline guidance. Provider error messages are redacted before display.
- Browser key lifetime is explicit: reload/sign-out clears them. Desktop keys
  remain in the operating system vault, scoped to the signed-in workspace.

## Verification

60 focused tests cover settings, provider requests, desktop transport wiring,
credential isolation, retries, agent behavior, image and voice settings.
Production build and TypeScript checks passed. The actual localhost proxy
reached OpenAI's models endpoint and returned its expected unauthenticated 401.
Browser checks covered draft key input, show/hide, provider switching, pill
buttons and a 390px layout without horizontal overflow.

Native transport was tested with a mocked OS vault and native command; this is
not a packaged-desktop or paid provider account end-to-end certification. No
real provider key or business record was modified during QA. A real account's
model access and remaining allowance must be checked using Test connection.

## Provider references checked

- [OpenAI Chat Completions parameters](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI reasoning-model parameter compatibility](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2)
- [Claude API parameter and thinking guidance](https://platform.claude.com/docs/en/claude_api_primer)
- [xAI model catalogue](https://docs.x.ai/developers/models)
- [Cerebras public model catalogue](https://inference-docs.cerebras.ai/api-reference/models/public-models)
