import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { AVATAR_SHAPES, AVATAR_COLOURS, avatarUrl } from "../../lib/profileAvatars";

it("keeps saved avatar URLs available and gives every character a static reduced-motion mode", () => {
  const paths = AVATAR_SHAPES.flatMap((shape) => [
    `/avatars/${shape.legacy}.svg`,
    ...AVATAR_COLOURS.map((colour) => avatarUrl(shape.id, colour.id)),
  ]);
  expect(new Set(paths).size).toBe(110);
  const designs = new Set<string>();
  for (const path of paths) {
    const svg = readFileSync(resolve("public", path.slice(1)), "utf8");
    expect(
      new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror"),
      path
    ).toBeNull();
    expect(svg, path).toContain('viewBox="0 0 100 100"');
    expect(svg, path).toMatch(/prefers-reduced-motion\s*:\s*reduce/);
    expect(svg, path).toMatch(/animation\s*:\s*none/);
    expect(svg, path).toContain("Copyright (c) 2026 Alain");
    expect(svg, path).toContain("Permission is hereby granted");
    expect(svg, path).not.toMatch(/<script|<foreignObject|(?:href|src)=/);
    designs.add(svg);
  }
  expect(designs.size).toBe(paths.length);
});
