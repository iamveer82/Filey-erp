// Import only MIT artwork from the pinned upstream revision; no upstream code runs.
// node scripts/import-mascot-avatars.mjs (Node 22.18+)
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { MASCOT_AVATARS } from "../src/lib/profileAvatars.ts";
const revision = "76a44ed9180063bf4852b9dd724b656f4a828ac7";
const source = `https://raw.githubusercontent.com/nilbuild/page-mascot/${revision}`;
const directory = resolve("public/avatars/mascots");
await mkdir(directory, { recursive: true });
async function fetchFile(path) {
  const response = await fetch(`${source}/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
await writeFile(resolve(directory, "LICENSE.txt"), await fetchFile("LICENSE"));
await writeFile(
  resolve(directory, "SOURCE.txt"),
  `Page Mascot by Kamran Ahmed\nhttps://github.com/nilbuild/page-mascot\nRevision: ${revision}\nMIT license: LICENSE.txt\nArtwork resized to 160px cells; centered portraits extracted for static fallbacks.\n`
);
let total = 0;
for (const id of MASCOT_AVATARS) {
  for (const type of ["directions", "reactions"]) {
    const bytes = await fetchFile(`public/mascots/${id}-${type}.webp`);
    const { width, height } = await sharp(bytes).metadata();
    if (!width || !height || width % 3 || height % 3)
      throw new Error(`Invalid sprite sheet: ${id}`);
    const sheet = await sharp(bytes).resize(480, 480).webp({ quality: 82 }).toBuffer();
    await writeFile(resolve(directory, `${id}-${type}.webp`), sheet);
    total += sheet.length;
    if (type === "directions") {
      const portrait = await sharp(bytes)
        .extract({
          left: width / 3,
          top: height / 3,
          width: width / 3,
          height: height / 3,
        })
        .resize(160, 160)
        .webp({ quality: 85 })
        .toBuffer();
      await writeFile(resolve(directory, `${id}.webp`), portrait);
      total += portrait.length;
    }
  }
}
console.log(
  `Imported ${MASCOT_AVATARS.length} mascots with static portraits and reaction sheets (${(total / 1024 / 1024).toFixed(2)} MiB).`
);
