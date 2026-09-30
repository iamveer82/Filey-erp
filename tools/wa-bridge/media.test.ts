import { expect, it } from "vitest";
import { mediaRequestOptions } from "./media.mjs";

it("allows only WhatsApp's actual media URL choice and disables redirects", () => {
  const expected = { timeout: 30_000, maxRedirects: 0 };
  expect(mediaRequestOptions({ url: "https://mmg.whatsapp.net/v/file.enc?token=example" })).toEqual(expected);
  expect(mediaRequestOptions({ directPath: "/v/file.enc?token=example" })).toEqual(expected);
  // Baileys ignores a URL outside this prefix when a valid directPath exists.
  expect(mediaRequestOptions({ url: "https://other.invalid/file", directPath: "/v/file.enc" })).toEqual(expected);
});

it.each([
  {}, { directPath: "@127.0.0.1/private" }, { directPath: ":444/private" },
  { directPath: "//127.0.0.1/private" }, { directPath: "\\127.0.0.1\\private" },
  { directPath: "/v/file\r\nInjected: value" }, { directPath: "/" + "x".repeat(4096) },
  { url: "https://mmg.whatsapp.net@127.0.0.1/private" },
  { url: "http://mmg.whatsapp.net/file" },
  { url: "https://mmg.whatsapp.net:444/file" },
  { url: "https://mmg.whatsapp.net.evil.invalid/file" },
])("refuses unsafe or missing media locations without downloading: %j", media => {
  expect(() => mediaRequestOptions(media)).toThrow("Invalid WhatsApp attachment location");
});
