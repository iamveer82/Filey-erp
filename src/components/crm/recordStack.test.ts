import { expect, it } from "vitest";
import { parseRecordStack, pushRecord, recordKey } from "./recordStack";

it("restores linked navigation and rejects malformed or unsafe record identifiers", () => {
  const refs = parseRecordStack("companies:12,contacts:7,deals:3");
  expect(refs.map(recordKey)).toEqual(["companies:12", "contacts:7", "deals:3"]);
  expect(pushRecord(refs, { kind: "companies", id: 12 }).map(recordKey)).toEqual([
    "contacts:7",
    "deals:3",
    "companies:12",
  ]);
  expect(
    parseRecordStack(
      "users:1,contacts:0,contacts:-1,contacts:1e3,companies:1:2,deals:9007199254740992,contacts:2,contacts:2"
    )
  ).toEqual([{ kind: "contacts", id: 2 }]);
  expect(parseRecordStack("a".repeat(2001))).toEqual([]);
  expect(parseRecordStack(null)).toEqual([]);
  expect(
    parseRecordStack(Array.from({ length: 30 }, (_, i) => `deals:${i + 1}`).join(","))
  ).toHaveLength(20);
});
