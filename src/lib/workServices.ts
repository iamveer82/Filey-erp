/** Curated provider facts, reviewed against primary sources on 8 September 2026.
 * Access describes the provider, not a promise of unlimited Filey allowance.
 * This module reads public data only; it never saves credentials or records. */
export interface WorkService {
  id: string;
  name: string;
  category: "Business data" | "Research" | "AI" | "Messaging" | "Creative";
  access: "keyless" | "local" | "free-tier" | "byok";
  description: string;
  limits: string;
  docsUrl: string;
  setupUrl?: string;
  route?: string;
  tool?: "market" | "holidays" | "assets";
}

export const WORK_SERVICES: readonly WorkService[] = [
  {
    id: "world-bank",
    name: "World Bank market data",
    category: "Business data",
    access: "keyless",
    description: "Look up reported GDP and population for country-level market research.",
    limits:
      "Annual observations can lag the current year. These two WDI series use CC BY 4.0; retain the source and observation year.",
    docsUrl: "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392",
    tool: "market",
  },
  {
    id: "open-holidays",
    name: "OpenHolidays",
    category: "Business data",
    access: "keyless",
    description:
      "Check public holidays before planning follow-ups, deliveries or campaigns.",
    limits:
      "Only listed countries are supported; India and UAE are currently absent. Regional holidays are labelled. Free commercial use under ODbL, with attribution.",
    docsUrl: "https://www.openholidaysapi.org/en/faq/",
    tool: "holidays",
  },
  {
    id: "commons",
    name: "Wikimedia Commons",
    category: "Creative",
    access: "keyless",
    description: "Find reusable photographs with creator, licence and source links.",
    limits:
      "Filey filters for identified CC0, public-domain, CC BY and CC BY-SA images. Check each file's rights and attribution before publishing; people and trademarks can carry separate rights.",
    docsUrl:
      "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
    tool: "assets",
  },
  {
    id: "frankfurter",
    name: "Frankfurter exchange rates",
    category: "Business data",
    access: "keyless",
    description:
      "Daily currency reference rates already used by Filey's converter and reports.",
    limits:
      "Reference rates, not trading prices. Provider terms and abuse rate limits apply; choose an official source where your accounting rules require it.",
    docsUrl: "https://frankfurter.dev/",
    route: "/integrations",
  },
  {
    id: "jina",
    name: "Jina web research",
    category: "Research",
    access: "free-tier",
    description:
      "Read public websites and search for business research with Filey's existing web tools.",
    limits:
      "Reader supports limited keyless access. Search requires your own key; keyed use has token allowances and billing. Source website terms still apply.",
    docsUrl: "https://jina.ai/reader/",
    setupUrl: "https://jina.ai/reader/",
    route: "/integrations/web-research",
  },
  {
    id: "ollama",
    name: "Ollama local AI",
    category: "AI",
    access: "local",
    description:
      "Run a downloaded model on your computer through Filey's existing AI adapter.",
    limits:
      "Local API calls need no key. Hardware and model licences still matter; cloud models have separate account and usage terms.",
    docsUrl: "https://docs.ollama.com/api/authentication",
    setupUrl: "https://ollama.com/download",
    route: "/settings?section=ai",
  },
  {
    id: "lm-studio",
    name: "LM Studio local AI",
    category: "AI",
    access: "local",
    description: "Use a locally hosted, OpenAI-compatible model in Filey.",
    limits:
      "Start the local server and choose a tool-capable model. Optional server authentication and each model's licence apply.",
    docsUrl: "https://lmstudio.ai/docs/developer/openai-compat",
    setupUrl: "https://lmstudio.ai/download",
    route: "/settings?section=ai",
  },
  {
    id: "desktop-computer",
    name: "Filey computer access",
    category: "AI",
    access: "local",
    description:
      "Let Filey AI work with your Windows apps during a temporary session you enable.",
    limits:
      "Requires the desktop app, an enabled session and a suitable model. The selected AI provider may charge for its inference.",
    docsUrl: "/docs?article=browser",
    route: "/agent",
  },
  {
    id: "whatsapp-qr",
    name: "WhatsApp QR bridge",
    category: "Messaging",
    access: "local",
    description:
      "Filey's existing desktop bridge links your WhatsApp session and supports PDF attachments.",
    limits:
      "No API key is bundled. This third-party linked-device bridge is not Meta's official Business API; WhatsApp may restrict unsupported clients. Account connection and Filey approval rules apply.",
    docsUrl: "https://faq.whatsapp.com/378279804439436/",
    route: "/integrations?tab=free",
  },
  {
    id: "telegram",
    name: "Telegram Bot API",
    category: "Messaging",
    access: "free-tier",
    description: "Use your own bot to message subscribers and deliver documents.",
    limits:
      "BotFather token required. Normal bot messages are free within Telegram's limits; paid broadcasts are optional. Filey's Composio connector has separate provider requirements.",
    docsUrl: "https://core.telegram.org/bots/faq",
    setupUrl: "https://t.me/BotFather",
    route: "/integrations?tab=available",
  },
  {
    id: "resend",
    name: "Resend email",
    category: "Messaging",
    access: "free-tier",
    description:
      "Send invoices and account emails through Filey's server-side email integration.",
    limits:
      "Provider free plan currently allows 3,000 emails/month and 100/day. Sender verification and Filey's own sending limits apply. The administrator keeps the Resend key server-side.",
    docsUrl: "https://resend.com/pricing",
    setupUrl: "https://resend.com/api-keys",
    route: "/integrations?tab=free",
  },
  {
    id: "instagram",
    name: "Instagram publishing",
    category: "Messaging",
    access: "byok",
    description:
      "Publish to an authorized professional account through supported Meta APIs or Filey's social connector.",
    limits:
      "Requires an eligible professional account, permissions and access tokens. Personal-account automation is not generally supported. Platform limits and any Zernio/connector fees apply.",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform/",
    setupUrl: "https://developers.facebook.com/",
    route: "/integrations/social-publishing",
  },
  {
    id: "pexels",
    name: "Pexels stock media",
    category: "Creative",
    access: "free-tier",
    description:
      "An optional source of stock photographs and videos for your marketing work.",
    limits:
      "Own key required for the API; default allowance is 200 requests/hour and 20,000/month. Attribution and API partner rules apply. Filey does not bundle a Pexels adapter.",
    docsUrl: "https://www.pexels.com/api/documentation/",
    setupUrl: "https://www.pexels.com/api/",
  },
];

type ReadOptions = { signal?: AbortSignal };
type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonObject) : {};
const text = (v: unknown, max = 300): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

function countryCode(input: string): string {
  const code = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code))
    throw new Error("Enter a two-letter country code, such as AE, IN or DE.");
  return code;
}

/** All hosts and paths are fixed by the adapters. No cookies, tokens or business
 * records are sent. Public requests time out, never retry into another provider. */
async function publicJson(
  url: string,
  provider: string,
  opts: ReadOptions,
  headers?: Record<string, string>
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (opts.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  opts.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 12_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      signal: controller.signal,
      headers: { accept: "application/json", ...headers },
    });
    if (!response.ok)
      throw new Error(
        `${provider} returned HTTP ${response.status}${response.status === 429 ? ". Its request limit was reached; try again later" : ""}.`
      );
    const body = await response.text();
    if (body.length > 1_000_000)
      throw new Error(`${provider} returned too much data. Try a narrower request.`);
    try {
      return JSON.parse(body);
    } catch {
      throw new Error(`${provider} returned an invalid response. Try again later.`);
    }
  } catch (error) {
    if (opts.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (timedOut)
      throw new Error(`${provider} took too long to respond. Try again later.`);
    throw error;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", abort);
  }
}

export interface CountryMarketRow {
  id: string;
  label: string;
  value: number | null;
  year: string | null;
  unit: string;
  sourceUrl: string;
  lastUpdated?: string;
}
export interface CountryMarketData {
  countryCode: string;
  countryName: string;
  rows: CountryMarketRow[];
  sourceUrl: string;
  attribution: string;
}

export async function getCountryMarketData(
  input: string,
  opts: ReadOptions = {}
): Promise<CountryMarketData> {
  const code = countryCode(input);
  let countryName = code;
  const indicators = [
    { id: "NY.GDP.MKTP.CD", label: "GDP", unit: "current USD" },
    { id: "SP.POP.TOTL", label: "Population", unit: "people" },
  ];
  const rows = await Promise.all(
    indicators.map(async (indicator): Promise<CountryMarketRow> => {
      const data = await publicJson(
        `https://api.worldbank.org/v2/country/${code}/indicator/${indicator.id}?format=json&mrnev=1&per_page=1`,
        "World Bank",
        opts
      );
      if (
        !Array.isArray(data) ||
        data.length < 2 ||
        (data[1] !== null && !Array.isArray(data[1]))
      )
        throw new Error("World Bank returned an invalid country response.");
      const observation = object(data[1]?.[0]);
      const country = object(observation.country);
      if (country.id !== undefined && country.id !== code)
        throw new Error("World Bank returned data for a different country.");
      const name = text(country.value);
      if (name) countryName = name;
      const value =
        typeof observation.value === "number" &&
        Number.isFinite(observation.value) &&
        observation.value >= 0
          ? observation.value
          : null;
      const year = /^\d{4}$/.test(text(observation.date)) ? text(observation.date) : null;
      return {
        ...indicator,
        value: year ? value : null,
        year: value !== null ? year : null,
        sourceUrl: `https://data.worldbank.org/indicator/${indicator.id}?locations=${code}`,
        lastUpdated: text(object(data[0]).lastupdated) || undefined,
      };
    })
  );
  if (rows.every((row) => row.value === null))
    throw new Error(
      `No World Bank GDP or population observations are available for ${code}.`
    );
  return {
    countryCode: code,
    countryName,
    rows,
    sourceUrl: rows[0].sourceUrl,
    attribution:
      "World Bank, World Development Indicators — CC BY 4.0. Values retain their reported year and source; they are not live estimates.",
  };
}

const HOLIDAY_SOURCE = "https://www.openholidaysapi.org/en/";
const holidayAttribution =
  "OpenHolidays API / STÜBER SYSTEMS — ODbL 1.0. Regional coverage and published dates may change; an empty result is not confirmation that no holiday exists.";
const holidayName = (names: unknown): string => {
  const rows = Array.isArray(names) ? names.map(object) : [];
  return text(rows.find((row) => row.language === "EN")?.text ?? rows[0]?.text);
};

export async function listHolidayCountries(
  opts: ReadOptions = {}
): Promise<{ code: string; name: string }[]> {
  const data = await publicJson(
    "https://openholidaysapi.org/Countries?languageIsoCode=EN",
    "OpenHolidays",
    opts
  );
  if (!Array.isArray(data))
    throw new Error("OpenHolidays returned an invalid country list.");
  return data
    .flatMap((value) => {
      const row = object(value);
      const code = text(row.isoCode);
      const name = holidayName(row.name);
      return /^[A-Z]{2}$/.test(code) && name ? [{ code, name }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PublicHoliday {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  nationwide: boolean;
  subdivisions: string[];
}
export interface PublicHolidays {
  countryCode: string;
  year: number;
  rows: PublicHoliday[];
  sourceUrl: string;
  attribution: string;
}
const calendarDate = (value: unknown): string => {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : "";
};

export async function getPublicHolidays(
  input: string,
  year: number,
  opts: ReadOptions = {}
): Promise<PublicHolidays> {
  const code = countryCode(input);
  if (!Number.isInteger(year) || year < 2020 || year > 2100)
    throw new Error("Choose a holiday year between 2020 and 2100.");
  const countries = await listHolidayCountries(opts);
  if (!countries.some((country) => country.code === code))
    throw new Error(
      `OpenHolidays does not currently cover ${code}. Choose a supported country; no dates have been inferred.`
    );
  const data = await publicJson(
    `https://openholidaysapi.org/PublicHolidays?countryIsoCode=${code}&languageIsoCode=EN&validFrom=${year}-01-01&validTo=${year}-12-31`,
    "OpenHolidays",
    opts
  );
  if (!Array.isArray(data))
    throw new Error("OpenHolidays returned an invalid holiday list.");
  const rows = data
    .flatMap((value) => {
      const row = object(value);
      const startDate = calendarDate(row.startDate);
      const endDate = calendarDate(row.endDate);
      const name = holidayName(row.name);
      if (
        !startDate ||
        !endDate ||
        !name ||
        endDate < startDate ||
        startDate > `${year}-12-31` ||
        endDate < `${year}-01-01` ||
        typeof row.nationwide !== "boolean"
      )
        return [];
      return [
        {
          id: text(row.id) || `${startDate}:${name}`,
          name,
          startDate,
          endDate,
          nationwide: row.nationwide,
          subdivisions: Array.isArray(row.subdivisions)
            ? row.subdivisions.map((v) => text(object(v).code, 60)).filter(Boolean)
            : [],
        },
      ];
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  return {
    countryCode: code,
    year,
    rows,
    sourceUrl: HOLIDAY_SOURCE,
    attribution: holidayAttribution,
  };
}

export interface CreativeAsset {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  creator: string;
  license: string;
  licenseUrl: string;
  attribution: string;
}
export interface CreativeAssets {
  query: string;
  rows: CreativeAsset[];
  sourceUrl: string;
  attribution: string;
}

function plainMetadata(value: unknown): string {
  const raw = text(object(value).value, 4000);
  // Template content is inert. Never pass provider HTML to a rendered element.
  const template = document.createElement("template");
  template.innerHTML = raw;
  template.content.querySelectorAll("script, style").forEach((node) => node.remove());
  return (template.content.textContent || "").replace(/\s+/g, " ").trim().slice(0, 500);
}
function publicAssetUrl(value: unknown, hosts: string[]): string {
  try {
    const url = new URL(text(value, 3000));
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hosts.includes(url.hostname)
      ? url.href
      : "";
  } catch {
    return "";
  }
}
function reusableLicense(
  metadata: JsonObject,
  sourceUrl: string
): { license: string; licenseUrl: string } | null {
  const license = plainMetadata(metadata.LicenseShortName);
  const rawUrl = plainMetadata(metadata.LicenseUrl).replace(/^http:\/\//, "https://");
  const licenseUrl = publicAssetUrl(rawUrl, [
    "creativecommons.org",
    "www.creativecommons.org",
  ]);
  const cc = /^CC (BY(?:-SA)?) (1\.0|2\.0|2\.5|3\.0|4\.0)$/i.exec(license);
  if (cc && licenseUrl) {
    const path = new URL(licenseUrl).pathname;
    const expected = `/licenses/${cc[1].toLowerCase()}/${cc[2]}`;
    if (path === expected || path.startsWith(`${expected}/`))
      return { license, licenseUrl };
  }
  if (/^(CC0(?: 1\.0)?|Public domain)$/i.test(license)) {
    if (
      licenseUrl &&
      /^\/publicdomain\/(zero|mark)\/1\.0(?:\/|$)/.test(new URL(licenseUrl).pathname)
    )
      return { license, licenseUrl };
    if (!rawUrl && /^Public domain$/i.test(license))
      return { license, licenseUrl: sourceUrl };
  }
  return null;
}

export async function searchCreativeAssets(
  input: string,
  opts: ReadOptions & { limit?: number } = {}
): Promise<CreativeAssets> {
  const query = typeof input === "string" ? input.trim() : "";
  if (query.length < 2 || query.length > 160)
    throw new Error("Enter an image search between 2 and 160 characters.");
  const limit = opts.limit ?? 6;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new Error("Choose between 1 and 10 image results.");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "600",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired",
    origin: "*",
  });
  const sourceUrl = `https://commons.wikimedia.org/w/index.php?${new URLSearchParams({ title: "Special:MediaSearch", type: "image", search: query })}`;
  const data = object(
    await publicJson(
      `https://commons.wikimedia.org/w/api.php?${params}`,
      "Wikimedia Commons",
      opts,
      { "Api-User-Agent": "GoFiley/2.10 (https://gofiley.com)" }
    )
  );
  if (data.error)
    throw new Error(
      "Wikimedia Commons could not complete that search. Try a narrower query later."
    );
  const pages = object(data.query).pages;
  if (pages === undefined && data.batchcomplete !== true)
    throw new Error("Wikimedia Commons returned an invalid image list.");
  if (pages !== undefined && !Array.isArray(pages))
    throw new Error("Wikimedia Commons returned an invalid image list.");
  const rows = (Array.isArray(pages) ? pages : [])
    .flatMap((value) => {
      const page = object(value);
      if (
        typeof page.pageid !== "number" ||
        !Number.isInteger(page.pageid) ||
        page.pageid <= 0
      )
        return [];
      const info = object(Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined);
      if (
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(text(info.mime))
      )
        return [];
      const imageUrl = publicAssetUrl(info.url, [
        "upload.wikimedia.org",
        "thumb.wikimedia.org",
      ]);
      const thumbnailUrl = publicAssetUrl(info.thumburl, [
        "upload.wikimedia.org",
        "thumb.wikimedia.org",
      ]);
      const fileUrl = publicAssetUrl(info.descriptionurl, ["commons.wikimedia.org"]);
      if (!imageUrl || !thumbnailUrl || !fileUrl) return [];
      const metadata = object(info.extmetadata);
      const licence = reusableLicense(metadata, fileUrl);
      if (!licence) return [];
      const creator = plainMetadata(metadata.Artist);
      // Attribution licences without a supplied creator require manual review;
      // omit them rather than presenting an incomplete reuse credit.
      if (/^CC BY/i.test(licence.license) && !creator) return [];
      const title = text(page.title).replace(/^File:/, "");
      return [
        {
          id: String(page.pageid),
          title,
          imageUrl,
          thumbnailUrl,
          sourceUrl: fileUrl,
          creator,
          ...licence,
          attribution: `${title}${creator ? ` — ${creator}` : ""} — ${licence.license}. ${fileUrl}`,
        },
      ];
    })
    .slice(0, limit);
  return {
    query,
    rows,
    sourceUrl,
    attribution:
      "Wikimedia Commons. Review the linked file page before publishing; retain its creator and licence. A reusable copyright licence does not supply model, property or trademark releases.",
  };
}
