import { describe, it, expect } from "vitest";
import { parseRanges } from "../ranges";

describe("parseRanges (1-based → 0-based indices)", () => {
  it("parses single pages and ranges", () => {
    expect(parseRanges("1,3,5", 10)).toEqual([0, 2, 4]);
    expect(parseRanges("2-4", 10)).toEqual([1, 2, 3]);
  });

  it("supports open-ended ranges", () => {
    expect(parseRanges("8-", 10)).toEqual([7, 8, 9]);
    expect(parseRanges("-3", 10)).toEqual([0, 1, 2]);
  });

  it("dedupes, sorts and clamps to the page count", () => {
    expect(parseRanges("3,1-2,3,99", 5)).toEqual([0, 1, 2]);
  });

  it("ignores junk and out-of-range values", () => {
    expect(parseRanges("0,abc, ,12", 5)).toEqual([]);
    expect(parseRanges("", 5)).toEqual([]);
  });
});
