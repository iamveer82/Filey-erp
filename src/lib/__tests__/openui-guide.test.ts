import { expect, it } from "vitest";
import { OPENUI_GUIDE } from "../openuiGuide";
import { buildOpenUiGuide, openUiProblems } from "../openuiLib";

// Filey AI draws with OpenUI (thesysdev/openui). The prompt carries a stored copy of the guide.
it("keeps the stored guide identical to the library's, with Filey's data rule and no invented data", () => {
  expect(OPENUI_GUIDE).toBe(buildOpenUiGuide());
  expect(OPENUI_GUIDE).toContain("Never invent, estimate or pad data");
  expect(OPENUI_GUIDE).not.toMatch(/generate realistic\/plausible data/i);
  expect(OPENUI_GUIDE).toContain("BarChart(labels: string[], series: Series[]");
  expect(OPENUI_GUIDE).not.toContain("ImageGallery");
  expect(OPENUI_GUIDE.length).toBeLessThan(10_000);
});

it("tells the model exactly what to fix in a program", () => {
  expect(openUiProblems('root = Card([h])\nh = CardHeader("Sales", "AED")')).toEqual([]);
  expect(openUiProblems('root = Card([h, missing])\nh = CardHeader(5)\nextra = TextContent("x")')).toEqual([
    "Used but never defined: missing.",
    "Defined but not reachable from root, so not shown: extra.",
    'h (CardHeader): field "/title" expects string but got number',
  ]);
  expect(openUiProblems("just some words")[0]).toMatch(/No root/);
});
