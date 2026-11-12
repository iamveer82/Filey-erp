import { expect, it } from "vitest";
import { EAN13_TABLES, barcodeKind, barcodeSvg, ean13CheckDigit, ean13Modules, expectedCheckDigit, generateEan13, labelSheetHtml } from "../barcode";
import { skuFromName } from "../productForm";

const flip = (s: string) => s.replace(/[01]/g, (b) => (b === "1" ? "0" : "1"));
const reverse = (s: string) => [...s].reverse().join("");

it("uses the standard EAN-13 tables: R is L inverted, G is R reversed", () => {
  const { L, G, R, PARITY } = EAN13_TABLES;
  for (let d = 0; d < 10; d++) {
    expect(R[d]).toBe(flip(L[d]));
    expect(G[d]).toBe(reverse(R[d]));
    // Every digit is two bars and two spaces over seven modules; L starts with a space.
    expect(L[d].match(/(1+|0+)/g)).toHaveLength(4);
    expect(L[d][0]).toBe("0");
  }
  expect(PARITY[0]).toBe("LLLLLL");
  expect(new Set(PARITY).size).toBe(10);
});

it("computes check digits for well-known codes", () => {
  expect(ean13CheckDigit("400638133393")).toBe(1);
  expect(ean13CheckDigit("590123412345")).toBe(7);
  expect(barcodeKind("4006381333931")).toBe("ean13");
  expect(barcodeKind("036000291452")).toBe("upca"); // a UPC-A
  expect(barcodeKind("4006381333932")).toBe("bad-check");
  expect(expectedCheckDigit("4006381333932")).toBe(1);
  expect(barcodeKind("SKU-77A")).toBe("other");
  expect(barcodeKind(" ")).toBe("");
});

it("draws 95 modules with guard bars, and decodes back to the same digits", () => {
  const bits = ean13Modules("4006381333931")!;
  expect(bits).toHaveLength(95);
  expect(bits.slice(0, 3)).toBe("101");
  expect(bits.slice(45, 50)).toBe("01010");
  expect(bits.slice(92)).toBe("101");
  // Decode with the inverse tables: left digits name their parity, which gives the first digit.
  const { L, G, R, PARITY } = EAN13_TABLES;
  let parity = "";
  let digits = "";
  for (let i = 0; i < 6; i++) {
    const chunk = bits.slice(3 + i * 7, 10 + i * 7);
    const l = L.indexOf(chunk), g = G.indexOf(chunk);
    parity += l >= 0 ? "L" : "G";
    digits += String(l >= 0 ? l : g);
  }
  for (let i = 0; i < 6; i++) digits += String(R.indexOf(bits.slice(50 + i * 7, 57 + i * 7)));
  expect(String(PARITY.indexOf(parity)) + digits).toBe("4006381333931");
  expect(ean13Modules("036000291452")).toBe(ean13Modules("0036000291452"));
  expect(ean13Modules("4006381333932")).toBeNull();
});

it("renders an SVG only for printable codes", () => {
  expect(barcodeSvg("4006381333931")).toMatch(/^<svg[^>]+aria-label="Barcode 4006381333931"/);
  expect(barcodeSvg("SKU-77A")).toBe("");
});

it("generates unique in-store codes with a valid check digit", () => {
  let n = 0;
  const seq = () => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1, 0.2][n++ % 11];
  const first = generateEan13([], seq);
  expect(first).toBe(`2123456789${"12"}${ean13CheckDigit(`212345678912`)}`);
  expect(barcodeKind(first)).toBe("ean13");
  n = 0;
  expect(generateEan13([first], () => 0.5)).not.toBe(first);
});

it("lays out labels and escapes product names", () => {
  const html = labelSheetHtml([{ name: "<b>Tea & Co</b>", code: "4006381333931", price: "AED 5.00", sku: "T1" }, { name: "Skip", code: "ABC" }], "a4", 2);
  expect(html.match(/class="l"/g)).toHaveLength(2);
  expect(html).toContain("&lt;b&gt;Tea &amp; Co&lt;/b&gt;");
  expect(html).not.toContain("Skip");
  expect(labelSheetHtml([{ name: "x", code: "4006381333931" }], "38x25", 1)).toContain("size: 38mm 25mm");
});

it("suggests a readable SKU from the name and avoids ones in use", () => {
  expect(skuFromName("Paracetamol 500mg Strip")).toBe("PARA-500-STRI");
  expect(skuFromName("Paracetamol 500mg Strip", ["PARA-500-STRI"])).toBe("PARA-500-STRI-2");
  expect(skuFromName("!!!")).toBe("ITEM");
});
