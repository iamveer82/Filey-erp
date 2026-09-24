import path from "node:path";
import { expect, it } from "vitest";
import { bridgeLaunch } from "./launch.mjs";

it("uses exact argument paths and an explicitly empty owner when environment is missing or stale", () => {
  const stateDir = path.resolve("saved pairing", "folder with spaces");
  expect(bridgeLaunch(["--state-dir", stateDir, "--owner-number", ""], { FILEY_BRIDGE_STATE: "wrong-folder", FILEY_BRIDGE_OWNER: "971500000099" }))
    .toEqual({ stateDir, ownerNumber: "" });
  expect(bridgeLaunch(["--state-dir", stateDir, "--owner-number", "971500000001"], {}))
    .toEqual({ stateDir, ownerNumber: "971500000001" });
});

it("keeps legacy environment launch and standalone defaults working", () => {
  expect(bridgeLaunch([], { FILEY_BRIDGE_STATE: "saved-auth", FILEY_BRIDGE_OWNER: "971500000001" }))
    .toEqual({ stateDir: "saved-auth", ownerNumber: "971500000001" });
  expect(bridgeLaunch([], {})).toEqual({ stateDir: path.join(process.cwd(), "auth"), ownerNumber: "" });
  expect(bridgeLaunch([], { FILEY_BRIDGE_STATE: "" }).stateDir).toBe(path.join(process.cwd(), "auth"));
});

it("rejects malformed launch arguments instead of silently choosing another pairing directory", () => {
  for (const args of [["--state-dir"], ["--state-dir", ""], ["--state-dir", "relative"], ["--owner-number"], ["--unexpected"], ["unexpected"]])
    expect(() => bridgeLaunch(args, {})).toThrow();
});
