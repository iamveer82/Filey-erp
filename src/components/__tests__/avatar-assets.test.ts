import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  AVATAR_SHAPES,
  AVATAR_COLOURS,
  MASCOT_AVATARS,
  avatarUrl,
} from "../../lib/profileAvatars";
import sharp from "sharp";

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

it("ships every licensed mascot as a small portrait and aligned direction/reaction sheets accepted by the cloud", async () => {
  const license = readFileSync("public/avatars/mascots/LICENSE.txt", "utf8");
  expect(license).toContain("Copyright (c) 2026 Kamran Ahmed");
  expect(license).toContain("Permission is hereby granted");
  const sql = readFileSync("supabase/2026-10-07-mascot-avatars.sql", "utf8");
  const allowed = sql.match(/avatars\/mascots\/\(([^)]+)\)/)![1].split("|");
  expect(allowed.sort()).toEqual([...MASCOT_AVATARS].sort());
  for (const id of MASCOT_AVATARS) {
    for (const suffix of ["", "-directions", "-reactions"]) {
      const bytes = readFileSync(`public/avatars/mascots/${id}${suffix}.webp`);
      const metadata = await sharp(bytes).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(suffix ? 480 : 160);
      expect(metadata.height).toBe(suffix ? 480 : 160);
      expect(bytes.length).toBeLessThan(100_000);
    }
  }
});
