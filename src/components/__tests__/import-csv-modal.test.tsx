import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ImportCsvModal from "../ImportCsvModal";

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: notify }) }));
afterEach(cleanup);
const fields = [{ key: "name", label: "Name", required: true }];
function csvFile(text: () => Promise<string>) {
  const file = new File([], "records.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: text });
  return file;
}

it("locks file, mapping and close controls while importing exactly the submitted rows once", async () => {
  let finish!: () => void;
  const onImport = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const onClose = vi.fn();
  const ui = render(
    <ImportCsvModal
      open
      title="Import leads"
      fields={fields}
      onImport={onImport}
      onClose={onClose}
    />
  );
  const fileInput = ui.baseElement.querySelector('input[type="file"]')!;
  fireEvent.change(fileInput, {
    target: { files: [csvFile(async () => "name\nNorth Harbour")] },
  });
  const submit = await screen.findByRole("button", { name: "Import 1" });
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(onImport).toHaveBeenCalledWith([{ name: "North Harbour" }]);
  expect(fileInput).toBeDisabled();
  expect(screen.getByRole("button", { name: "CSV column for Name" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("ignores older file reads and surfaces a failed file read without importing stale rows", async () => {
  let oldFile!: (text: string) => void;
  const onImport = vi.fn(async () => {});
  const ui = render(
    <ImportCsvModal
      open
      title="Import leads"
      fields={fields}
      onImport={onImport}
      onClose={() => {}}
    />
  );
  const input = ui.baseElement.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: {
      files: [
        csvFile(
          () =>
            new Promise((resolve) => {
              oldFile = resolve;
            })
        ),
      ],
    },
  });
  fireEvent.change(input, { target: { files: [csvFile(async () => "name\nLatest")] } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Import 1" })).not.toBeDisabled()
  );
  await act(async () => oldFile("name\nOld\nWrong"));
  expect(screen.getByRole("button", { name: "Import 1" })).not.toBeDisabled();
  fireEvent.change(input, {
    target: {
      files: [
        csvFile(async () => {
          throw new Error("File unavailable");
        }),
      ],
    },
  });
  await screen.findByText("Could not read CSV: File unavailable");
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(onImport).not.toHaveBeenCalled();
});
