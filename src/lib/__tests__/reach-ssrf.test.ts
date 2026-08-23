// The SSRF guard is the only thing between "read this supplier page" and
// "fetch the cloud-metadata endpoint". These are the encodings that have
// historically slipped past naive string checks — each one here failed some
// real-world filter somewhere.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { readUrl, httpFetch, ReachError } from "../reach";

// Hermetic: any URL that slips past the guard must fail HERE, as a plain
// error, not by reaching out to the reader service.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in SSRF tests");
    })
  );
});

async function refuses(url: string) {
  await expect(readUrl(url), `readUrl(${url}) must refuse`).rejects.toBeInstanceOf(
    ReachError
  );
  await expect(
    httpFetch(url),
    `httpFetch(${url}) must refuse`
  ).rejects.toBeInstanceOf(ReachError);
}

describe("publicHttpUrl rejects non-public targets", () => {
  it("scheme and credential hygiene", async () => {
    await refuses("file:///etc/passwd");
    await refuses("ftp://example.com/x");
    await refuses("https://user:pass@example.com/");
  });

  it("obvious private hosts", async () => {
    await refuses("http://localhost/x");
    await refuses("http://api.fleet.internal/x");
    await refuses("http://printer.local/x");
    await refuses("http://127.0.0.1:8080/admin");
    await refuses("http://10.1.2.3/x");
    await refuses("http://192.168.1.1/x");
    await refuses("http://172.16.0.9/x");
    await refuses("http://172.31.255.1/x");
    await refuses("http://169.254.169.254/latest/meta-data/");
  });

  it("encoded IPv4 forms of loopback and private space", async () => {
    // WHATWG URL canonicalises most of these, but the guard re-checks the raw
    // host so a platform that doesn't (or a future regression in one that
    // does) still fails closed.
    await refuses("http://2130706433/"); // 127.0.0.1 as decimal u32
    await refuses("http://0x7f000001/"); // hex u32
    await refuses("http://127.1/"); // inet_aton short form
    await refuses("http://0x7f.1/"); // mixed hex short form
    await refuses("http://0177.0.0.1/"); // octal 177 = 127
    await refuses("http://0.0.0.0/");
    await refuses("http://100.64.0.1/"); // CGNAT
    await refuses("http://198.18.0.1/"); // benchmarking range
    await refuses("http://224.0.0.1/"); // multicast
  });

  it("IPv6 loopback, ULA, link-local and v4-mapped", async () => {
    await refuses("http://[::1]/x");
    await refuses("http://[::]/x");
    await refuses("http://[fc00::1]/x"); // unique local
    await refuses("http://[fd12::35]/x"); // unique local
    await refuses("http://[fe80::1]/x"); // link-local
    await refuses("http://[::ffff:127.0.0.1]/x"); // mapped loopback
    await refuses("http://[::ffff:a00:1]/x"); // mapped 10.0.0.1
  });

  it("still allows genuinely public URLs", () => {
    expect(() => readUrl("https://example.com/supplier")).not.toThrow();
    // Note: not awaited — the guard runs synchronously before any fetch; an
    // actual network call would only fail on fetch itself, never ReachError.
  });
});
