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
