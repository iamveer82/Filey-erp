// Tool covers ship inside the installer, so every megabyte here is a megabyte
// every user downloads on every auto-update. Generated art comes out at
// 1536x1024 and 1-2 MB a piece; the grid renders them a few hundred pixels
// wide. This regenerates the .webp the app actually loads at a sane size, and
// moves the .png originals out of public/ so they stop being shipped.
//
// Re-run it after generating a new batch: node scripts/optimize-tool-covers.mjs
import { mkdir, readdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import sharp from "sharp";

const PUBLIC = "public/tool-covers";
const ORIGINALS = "art/tool-covers-src";
const WIDTH = 640;
const QUALITY = 80;

const walk = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const files = await walk(PUBLIC);
const pngs = files.filter((f) => extname(f).toLowerCase() === ".png");
const webps = files.filter((f) => extname(f).toLowerCase() === ".webp");
let before = 0;
let after = 0;

// A .png next to its .webp is the original: re-encode from it (one generation
// of loss, not two), then retire the .png out of the shipped folder.
for (const png of pngs) {
  const webp = png.replace(/\.png$/i, ".webp");
  const out = await sharp(png).resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY }).toBuffer();
  before += (await stat(png)).size + (existsSync(webp) ? (await stat(webp)).size : 0);
  after += out.length;
  await writeFile(webp, out);
  const dest = join(ORIGINALS, relative(PUBLIC, png));
  await mkdir(dirname(dest), { recursive: true });
  await rename(png, dest);
  console.log(`  ${basename(webp)} -> ${kb(out.length)}  (png archived)`);
}

// A .webp with no .png source can only be resized from itself.
for (const webp of webps) {
  if (pngs.includes(webp.replace(/\.webp$/i, ".png"))) continue;
  const size = (await stat(webp)).size;
  const meta = await sharp(webp).metadata();
  if (meta.width <= WIDTH && size < 120_000) continue;
  const out = await sharp(webp).resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY }).toBuffer();
  before += size;
  after += out.length;
  await writeFile(webp, out);
  console.log(`  ${basename(webp)} -> ${kb(out.length)}`);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n${mb(before)} -> ${mb(after)}   originals archived in ${ORIGINALS}/`);
