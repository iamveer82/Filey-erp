# Local AI and user-supplied provider keys

Reviewed 7 September 2026. This update changes configuration code and help content; it does not install models, create provider accounts, obtain keys, or modify business records.

## Options available in Filey

| Option | Connection | Account and cost boundary |
| --- | --- | --- |
| Ollama on this device | OpenAI-compatible API at `http://localhost:11434/v1` | Download and run a suitable model. Local API calls do not require a key. Hardware, electricity and model license requirements remain. Cloud-backed Ollama models still use their cloud account. |
| LM Studio on this device | OpenAI-compatible API at `http://localhost:1234/v1` | Download a model and start the local server. Its API is keyless by default; enter a token if server authentication is enabled. |
| OpenRouter free models | Existing OpenAI adapter, model `openrouter/free` | User creates their own provider account and key. The router selects a currently available free model; capacity, latency, model availability and quotas vary. |
| Groq | Existing OpenAI adapter, model `openai/gpt-oss-20b` | User supplies their own key. Free-plan limits depend on model and organization; the provider dashboard is authoritative. |
| Google Gemini | Existing OpenAI-compatible adapter, model `gemini-2.5-flash` | User creates a Google AI Studio key. Free-tier access depends on account and region. Google's free tier may use submitted content to improve its products. |
| Other hosted providers or compatible gateways | Existing OpenAI Chat Completions or Anthropic Messages adapters | User supplies the corresponding endpoint, supported model ID and key. Provider pricing and terms apply. |

No shared free API keys are bundled or acquired. Free local Filey does not supply unlimited hosted AI, email, SMS or automation access. The app never falls back from a free model to a paid model automatically.

Provider documentation checked:

- [Ollama authentication](https://docs.ollama.com/api/authentication) and [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).
- [LM Studio OpenAI endpoints](https://lmstudio.ai/docs/developer/openai-compat) and [optional server authentication](https://lmstudio.ai/docs/developer/core/authentication).
- [OpenRouter free router, requirements and limitations](https://openrouter.ai/docs/guides/routing/routers/free-router).
- [Groq free-plan rate limits](https://console.groq.com/docs/rate-limits).
- [Gemini API pricing and data usage](https://ai.google.dev/gemini-api/docs/pricing) and [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), rechecked 8 September 2026.

Free hosted presets include a **Get your API key** link to the provider's own key dashboard. The user controls the provider account, quota and billing; no key is embedded in the repository. Resend's [free sending plan](https://resend.com/pricing) currently lists 3,000 emails/month and 100/day; sender/domain verification and server-side configuration are still required.

## Setup

Open Integrations → Provider setup → Configure AI, or Settings → AI Assistant. Local/free presets are shown first; additional hosted providers are under More providers.

For local AI, start the server and use **Find local models**. This calls only `GET /v1/models`, does not run inference, and does not change records. Choose a model ID from the returned catalogue or enter it manually. Filey does not silently choose or download a model.

For hosted providers, enter your own API key. **Test connection** sends only a short greeting and consumes the provider's allowance. It neither supplies business context nor calls business tools. A greeting is a transport check, not a guarantee of tool calling or vision support. Select a tool-capable model for Filey actions and a vision-capable model for images.

Browser builds need the local server to allow the current Filey origin, subject to browser network restrictions. The desktop app uses its existing native transport. See the [Ollama server FAQ](https://docs.ollama.com/faq) and LM Studio server settings; do not expose an unauthenticated server publicly.

## Credential and data behavior

AI settings stay in the browser/desktop profile's localStorage; this is **not application-level encrypted storage**. Requests go to the selected provider through the existing browser/native transport. Switching the endpoint origin clears the previous key unless a replacement key is explicitly supplied in the same configuration update. Same-origin model or API-path changes retain it.

Keyless readiness is limited to the OpenAI adapter on `localhost`, `127.0.0.1` or `[::1]`. Remote and misleading hostnames still require a key. Empty keys produce no Authorization header; optional local tokens are sent normally.

Cloud/local record mode is independent from model location. A downloaded local model can perform inference on the device while enabled web research, cloud-backed models or connected-app tools make their own network requests. Filey's existing action permissions still apply.

Composio and Zernio already provide user-key paths. Their provider charges and app authorization are separate. Resend remains an administrator-configured server integration; it is not exposed as a browser secret. Frankfurter reference rates, manual WhatsApp/Telegram links and calendar-file export already work without shared API keys.

## Verification

Regression tests use isolated test storage and mocked HTTP responses. They cover keyless chat and agent headers, optional local authentication, remote-host rejection, key clearing on origin switches, local catalogue reads and invalid responses, local setup's enabled test button, and the hosted free preset's key requirement. No live model/provider availability or account quota is asserted by those tests.
