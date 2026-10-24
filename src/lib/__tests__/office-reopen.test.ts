import { beforeEach, describe, expect, it } from "vitest";
import { setCacheOrg } from "../api";
import { officeBytesNamed, rememberOfficeFile } from "../aiTools";

describe("a file the agent saved can be opened again", () => {
  beforeEach(() => {
    localStorage.setItem("filey_data_mode", "local");
    setCacheOrg("test-org", "test-user");
  });

  it("finds the file by the name it was saved under, ahead of asking the user to attach it", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    rememberOfficeFile("turn-1", "Letter.docx", bytes);
    expect(officeBytesNamed("turn-1", "letter.docx")).toEqual({ name: "Letter.docx", bytes });
    expect(officeBytesNamed("turn-1", "letter")).toEqual({ name: "Letter.docx", bytes });
    expect(officeBytesNamed("turn-1", "budget.xlsx")).toBeUndefined();
  });

  it("asks for the exact name when two saved files match", () => {
    rememberOfficeFile("turn-2", "A-letter.docx", new Uint8Array([1]));
    rememberOfficeFile("turn-2", "B-letter.docx", new Uint8Array([2]));
    expect(officeBytesNamed("turn-2", "letter")).toEqual({ error: "Several files saved this turn match. Give the exact name." });
  });
});
