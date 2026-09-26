# Free and user-owned work services

Reviewed **8 September 2026**. The [public-apis directory](https://github.com/public-apis/public-apis) was a discovery starting point; current provider documentation and terms determine the choices below. No shared, leaked or generated API keys are included. Filey does not create provider accounts, enable paid billing, or fall back to paid services automatically.

## New runnable public-data tools

The typed catalogue and read-only adapters live in `src/lib/workServices.ts`. They send only the requested country/year or image-search phrase to fixed public hosts. They omit credentials, do not write records or configuration, bound requests to 12 seconds, and limit results. Use public search terms, not customer contact details or confidential text.

| Tool | What it returns | Cost and reuse boundary |
| --- | --- | --- |
| World Bank market data | Most recent available GDP and population observations, their separate years, update dates and source links. Works with reported country data including India and UAE. | No API key. The selected [GDP](https://data.worldbank.org/indicator/NY.GDP.MKTP.CD) and [population](https://data.worldbank.org/indicator/SP.POP.TOTL) series explicitly carry CC BY 4.0. Retain attribution. Annual statistics may lag; missing values remain unavailable, never zero. [API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392). |
| OpenHolidays | Public holidays for one supported country and year, including regional subdivisions and nationwide flags. | Its [official FAQ](https://www.openholidaysapi.org/en/faq/) permits free commercial use under ODbL. Filey checks the provider's current country list. India and UAE are currently unsupported; a missing country causes an explicit error. The [coverage and API guide](https://www.openholidaysapi.org/en/) describes the available regions and dates. An empty result is not a guarantee that no holiday exists. |
| Wikimedia Commons image search | Up to ten raster images, file-page links, creator credit and licence information. | Anonymous public API. Filey accepts identified CC0, public-domain, CC BY and CC BY-SA results, rejects unknown/NC/ND licences and incomplete attribution, and never renders provider HTML. Follow each file's licence, including share-alike requirements. Copyright reuse does not establish model, property or trademark releases. See [reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia), [image metadata API](https://www.mediawiki.org/wiki/API:Imageinfo) and [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette). |

World Bank's general website terms differ from its dataset licences; the adapter is intentionally restricted to the two explicitly CC BY 4.0 indicator series. It does not offer unrestricted scraping of World Bank publications.

The image adapter returns links and plain-text credits, not downloaded files or automatically published advertisements. A public-domain result without a separate licence URL links back to the originating file's rights statement. Review that page before reuse.

## Existing local and free options

| Service | Filey connection | Current boundary |
| --- | --- | --- |
| [Frankfurter](https://frankfurter.dev/) | Existing converter and shared FX loader. | Keyless daily reference rates; commercial use permitted subject to underlying provider terms. Abuse rate limits remain. No new duplicate FX adapter was added. |
| [Ollama](https://docs.ollama.com/api/authentication) / [LM Studio](https://lmstudio.ai/docs/developer/openai-compat) | Settings → AI Assistant, using existing compatible endpoints. | Download and run a suitable local model. Hardware, electricity and model licences apply. Ollama cloud models require a separate account; LM Studio can optionally require a server token. See [Filey's local provider guide](local-ai-providers.md). |
| Filey computer access | Filey AI's temporary desktop session. | Local Windows automation has no separate Filey API key. The selected model's inference can still incur provider fees. Session permission, action approvals and local app access remain required. |
| WhatsApp QR bridge | Existing desktop linked-device bridge, including invoice PDFs. | No shared API key. This is a third-party bridge, not the official WhatsApp Business API. [WhatsApp's linked-device guidance](https://faq.whatsapp.com/378279804439436/) warns that unsupported clients can be restricted. Official WhatsApp Web/Desktop and manual sharing remain alternatives. |
| [Jina Reader](https://jina.ai/reader/) | Existing web research and lead-enrichment tools. | Current table permits keyless Reader calls at 20 requests/minute; Search requires a key. Keyed use has its own token billing and rate limits. Do not describe all Jina search as keyless. |

## Services with user-owned keys or account authorization

| Service | What is free | Setup and limits |
| --- | --- | --- |
| [Telegram Bot API](https://core.telegram.org/bots/faq) | Normal bot messages within the free limits. | Create a bot with BotFather and use its token. Bots message their subscribers; normal limits include roughly 30 messages/second across recipients, one/second per chat and 20/minute in a group. Paid broadcasts are optional. Filey's Composio connection and hosting can have separate requirements; no direct universal Telegram account control is implied. |
| [Resend](https://resend.com/pricing) | Current transactional free allowance: 3,000 emails/month and 100/day. | A verified sender/domain and administrator-provided server key are required. Keep the key out of frontend code. Filey's own sending limits still apply. This allowance is not an unlimited marketing-email entitlement. |
| Instagram / Meta | Access depends on the authorized account and API permissions; connector fees are separate. | Meta's [official Instagram collection](https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login) requires a professional account and the relevant permissions. [Publishing and messaging documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) describes account limits; query `content_publishing_limit` for the current allowance. Publishing support does not grant unrestricted personal-account access or cold direct messaging. Filey's existing social connector can use a user-owned Zernio key and its pricing. |
| [Pexels](https://www.pexels.com/api/documentation/) | Own-key stock media API with a default 200 requests/hour and 20,000/month. | Optional external provider; no new Filey adapter is bundled. [API partner rules](https://help.pexels.com/hc/en-us/articles/900005852323-How-do-I-get-unlimited-requests) require credit and restrict cloning its stock-library service; larger access needs approval. The [media licence](https://www.pexels.com/license/) also limits endorsements, trademarks and resale of unaltered media. |

Hosted AI free tiers are already documented in [local-ai-providers.md](local-ai-providers.md). Users retain their provider account, keys, quotas and billing choices. A provider's free plan does not eliminate downstream hosting or connector charges.

## Popular entries excluded from free commercial defaults

- **REST Countries:** [terms updated 13 August 2026](https://restcountries.com/legal/terms-of-service) require paid plans for business/production use and limit cached data retention to three days. Its [current API](https://restcountries.com/docs) requires keys. Old keyless v3 examples are not a sound free-commercial dependency.
- **Nager.Holidays:** its [terms](https://nagerholidays.com/legal/termsofservice) require active sponsorship for commercial use, even though the API advertises broad coverage and no rate limit. OpenHolidays was selected for its explicit commercial-use permission.
- APIs without clear current commercial terms, generic credential lists and promises of unlimited free SMS, image generation or hosted AI were not added.

## Verification

Mocked regression tests cover observation years, missing values, supported-country checks, regional holidays, date validation, image rights filtering, unsafe URLs/HTML, request limits, cancellation and timeouts. They never send messages or change business records.

Jina regression checks verify that Search rejects a missing key before sending a request, Reader remains available without a key, provider errors remain errors, and both operations support cancellation and a 30-second deadline.

Innocuous live GET checks returned HTTP 200 and permissive CORS for UAE GDP, the OpenHolidays country list, German 2026 holidays and an `office` Commons search. Running the actual adapters returned two UAE market indicators with their observation years, 20 German holiday rows and four licensed Commons image results with attribution. These checks establish endpoint reachability on the review date, not future availability or a service-level guarantee.
