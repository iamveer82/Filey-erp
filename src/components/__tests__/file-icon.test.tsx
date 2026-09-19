import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { FileIcon } from "../BrandIcon";

afterEach(cleanup);

it("renders outline file icons for uppercase extensions and falls back safely for unknown files", () => {
  const view = render(<>
    <FileIcon name="invoice.final.PDF" />
    <FileIcon name="customers.CSV" />
    <FileIcon name="photo.HEIC" />
    <FileIcon name="backup.zip" />
    <FileIcon name="README" />
    <FileIcon name="file.constructor" />
  </>);
  expect(view.container.querySelectorAll("svg.lucide")).toHaveLength(6);
  expect(view.container.querySelectorAll("img")).toHaveLength(0);
  expect(view.container.querySelector(".lucide-file-text")).toBeInTheDocument();
  expect(view.container.querySelector(".lucide-file-spreadsheet")).toBeInTheDocument();
  expect(view.container.querySelector(".lucide-file-image")).toBeInTheDocument();
  expect(view.container.querySelector(".lucide-file-archive")).toBeInTheDocument();
  expect(view.container.querySelectorAll(".lucide-file")).toHaveLength(2);
});
