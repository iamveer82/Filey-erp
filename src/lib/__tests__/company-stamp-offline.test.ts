// @vitest-environment jsdom
// Proves the stamp/signature fix in LOCAL mode: a company-asset upload is stored
// as an inline data: URL (renders directly, no Supabase Storage round-trip), and
// the saved stamp setting round-trips that data: URL unchanged instead of being
// mistaken for a storage path (which is what produced the blank/placeholder).
import { beforeAll, test, expect } from "vitest";

beforeAll(() => {
  localStorage.clear();
  // Must be set before importing files.ts → supabase.ts reads it at load.
  localStorage.setItem("filey_data_mode", "local");
});

test("offline: company asset upload returns an inline data: URL, not a storage path", async () => {
  const { uploadCompanyAsset } = await import("../files");
  const file = new File([new Uint8Array([137, 80, 78, 71])], "stamp.png", {
    type: "image/png",
  });
  const { path, url } = await uploadCompanyAsset(file);
  expect(path.startsWith("data:image/png")).toBe(true);
  expect(url).toBe(path);
  // The whole point: NOT a `{uid}/company/...` path that 404s → broken-image placeholder.
  expect(path.includes("/company/")).toBe(false);
});

test("offline: stamp setting round-trips a data: URL unchanged", async () => {
  const { saveCompanyStampSig, loadCompanyStampSig } = await import(
    "../../components/StampSignatureSettings"
  );
  const { STAMP_DEFAULT } = await import("../../components/StampSignature");
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  await saveCompanyStampSig({ stamp: { ...STAMP_DEFAULT, data: dataUrl } });
  const loaded = await loadCompanyStampSig();
  // Data URL is kept verbatim (not re-resolved as a storage path → null/blank).
  expect(loaded.stamp?.data).toBe(dataUrl);
});

test("the transient preview URL is never persisted", async () => {
  const { saveCompanyStampSig } = await import(
    "../../components/StampSignatureSettings"
  );
  const { STAMP_DEFAULT } = await import("../../components/StampSignature");
  const { tools } = await import("../api");
  await saveCompanyStampSig({
    stamp: {
      ...STAMP_DEFAULT,
      data: "uid/company/1/stamp.png",
      // A signed URL good for 5 minutes. Persisting it shadowed `data` with a
      // link that had already died by the next visit → blank image.
      _previewUrl: "https://proj.supabase.co/storage/v1/object/sign/files/uid/company/1/stamp.png?token=x",
    },
  });
  const row = (await tools.settings()).find((r) => r.key === "company_stamp");
  expect(row).toBeDefined();
  const stored = JSON.parse(row!.value) as Record<string, unknown>;
  expect(stored._previewUrl).toBeUndefined();
  expect(stored.data).toBe("uid/company/1/stamp.png");
});

test("an expired signed URL saved over the path heals back to the path", async () => {
  const { loadCompanyStampSig } = await import(
    "../../components/StampSignatureSettings"
  );
  const { tools } = await import("../api");
  // What the old code left behind on installs that opened Settings and saved.
  await tools.setSetting(
    "company_signature",
    JSON.stringify({
      data: "https://proj.supabase.co/storage/v1/object/sign/files/uid/company/2/sign.png?token=expired",
    })
  );
  const loaded = await loadCompanyStampSig();
  expect(loaded.signature?.data).toBe("uid/company/2/sign.png");
});
