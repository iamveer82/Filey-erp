import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PDF_TOOLS } from "../PdfToolbox";
import ToolCover from "../ToolCover";

it("renders every registered tool without a cover download and follows the current theme", () => {
  for (const tool of PDF_TOOLS) {
    const cover = renderToStaticMarkup(createElement(ToolCover, { tool }));
    expect(cover, tool.id).toContain(`data-tool="${tool.id}"`);
    expect(cover, tool.id).toContain("currentColor");
    expect(cover, tool.id).not.toContain("<img");
    expect(cover, tool.id).not.toMatch(/#[0-9a-f]{3,8}(?:[";])/i);
    expect(cover, tool.id).toContain('aria-hidden="true"');
  }
});
