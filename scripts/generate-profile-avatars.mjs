/**
 * Generate Filey's local SVG choices with Blobatar's actual generation-2 renderer.
 * BlobatarSwift credits this renderer for its geometry, keyed traits, and palette.
 * Geometry and the default two-eye face come directly from upstream; Filey adds
 * only lightweight idle CSS. Shape and colour axes come from profileAvatars.ts:
 * 100 canonical assets keep geometry/motion fixed while changing the palette.
 * The ten legacy assets remain byte-identical. No avatar code or network calls
 * enter the app bundle.
 *
 * Reproduce from the repository root (Bun loads upstream TypeScript directly):
 *   git clone https://github.com/Alain00/blobatar.git output/blobatar-web-reference
 *   git -C output/blobatar-web-reference checkout a7fd546ebede49d0a9fa638945b9e534489782a2
 *   git clone https://github.com/RayZhao1998/BlobatarSwift.git output/blobatar-swift-reference
 *   git -C output/blobatar-swift-reference checkout 12ec93251e8a88b613caf3937b5c4fc7934bd516
 *   bun scripts/generate-profile-avatars.mjs
 * Optional arguments replace the two reference checkout paths, in that order.
 * Both checkout revisions are checked before assets or license notices are written.
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AVATAR_SHAPES, AVATAR_COLOURS } from "../src/lib/profileAvatars.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRevision = "a7fd546ebede49d0a9fa638945b9e534489782a2";
const swiftRevision = "12ec93251e8a88b613caf3937b5c4fc7934bd516";
const webSource = resolve(root, process.argv[2] ?? "output/blobatar-web-reference");
const swiftSource = resolve(root, process.argv[3] ?? "output/blobatar-swift-reference");

for (const [source, revision] of [[webSource, webRevision], [swiftSource, swiftRevision]]) {
  const actual = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (actual !== revision) throw new Error(`Reference checkout must be at ${revision}: ${source}`);
}

const src = resolve(webSource, "packages/blobatar/src");
const { blobatar, layout } = await import(pathToFileURL(resolve(src, "blob.ts")).href);
const { traits } = await import(pathToFileURL(resolve(src, "traits.ts")).href);
const upstreamLicense = (await readFile(resolve(webSource, "LICENSE"), "utf8")).replace(/\r\n/g, "\n");

// A colour must never change the silhouette, its decorations or eye geometry.
const geometry = (svg) => [...svg.matchAll(/<(?:path|circle)\b[^>]*\/>/g)]
  .map(([primitive]) => primitive.replace(/ fill="#[0-9a-f]{6}"/g, ""));

function renderAvatar(shape, colour, index, title, canonical = false) {
  const seed = `filey-profile-${shape.legacy}`;
  const silhouette = shape.id === "sunburst" ? "sun" : shape.id;
  const options = {
    background: "circle", hue: colour.hue, tone: colour.tone,
    traits: { shape: shape.pin }, title,
  };
  assert.equal(layout(traits(seed, true, options.traits)).shape, silhouette, `Invalid shape pin: ${shape.id}`);
  let svg = blobatar(seed, options);
  const primitives = geometry(svg);
  // This pinned idle renderer emits one body group followed by one two-eye group.
  // Wrap those groups without touching any upstream path, circle, or palette value.
  const groups = [...svg.matchAll(/<g fill="(#[0-9a-f]{6})">/g)];
  assert.equal(groups.length, 2, `Unexpected upstream idle SVG structure: ${shape.id}`);
  assert.equal(groups[0][1], colour.swatch, `Colour swatch differs from upstream palette: ${colour.id}`);
  let group = 0;
  svg = svg.replace(/<g fill="(#[0-9a-f]{6})">/g, (_, fill) => {
    group += 1;
    return group === 1
      ? `<g class="breathe"><g class="bob"><g fill="${fill}">`
      : `<g class="eyes" fill="${fill}">`;
  }).replace("</svg>", "</g></g></svg>");
  const blink = (5.2 + index * 0.23).toFixed(2);
  const phase = (index * -0.37).toFixed(2);
  const motion = `<style>.breathe,.eyes{transform-box:fill-box;transform-origin:center}.breathe{animation:breathe 2.8s ease-in-out ${phase}s infinite}.bob{animation:bob 3.4s ease-in-out ${phase}s infinite}.eyes{animation:blink ${blink}s linear ${phase}s infinite}@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.018)}}@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-.75px)}}@keyframes blink{0%,96%,100%{transform:scaleY(1)}98%{transform:scaleY(.08)}}@media(prefers-reduced-motion:reduce){.breathe,.bob,.eyes{animation:none;transform:none}}</style>`;
  const provenance = JSON.stringify({
    renderer: "https://github.com/Alain00/blobatar", revision: webRevision,
    swift: "https://github.com/RayZhao1998/BlobatarSwift", swiftRevision,
    generation: 2, seed, shape: silhouette, options,
    ...(canonical ? { shapeId: shape.id, colourId: colour.id } : {}),
  });
  svg = svg.replace(/^(<svg[^>]*>)/, `$1<!--\n${upstreamLicense.trimEnd()}\n-->${motion}<metadata>${provenance}</metadata>`);
  return { svg: `${svg}\n`, primitives };
}

const avatars = resolve(root, "public/avatars");
const variants = resolve(avatars, "blobatar");
const outputs = [];
for (const [index, shape] of AVATAR_SHAPES.entries()) {
  const originalColour = AVATAR_COLOURS.find(colour => colour.id === shape.colour);
  assert.ok(originalColour, `Missing original colour for ${shape.id}`);
  const legacyName = shape.id === shape.legacy ? shape.name : originalColour.name;
  const legacy = renderAvatar(shape, originalColour, index, `${legacyName} avatar`);
  const legacyPath = resolve(avatars, `${shape.legacy}.svg`);
  const saved = await readFile(legacyPath, "utf8").catch(error => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (saved === null) outputs.push({ path: legacyPath, svg: legacy.svg });
  else assert.equal(legacy.svg, saved, `Legacy avatar would change: ${shape.legacy}`);

  for (const colour of AVATAR_COLOURS) {
    const rendered = renderAvatar(shape, colour, index, `${shape.name} ${colour.name} avatar`, true);
    assert.deepEqual(rendered.primitives, legacy.primitives, `${shape.id}/${colour.id} changed geometry`);
    outputs.push({ path: resolve(variants, `${shape.id}-${colour.id}.svg`), svg: rendered.svg });
  }
}
await mkdir(variants, { recursive: true });
for (const output of outputs) await writeFile(output.path, output.svg);

const licenses = resolve(root, "licenses");
await mkdir(licenses, { recursive: true });
await writeFile(resolve(licenses, "blobatar.txt"), upstreamLicense);
const swiftLicense = (await readFile(resolve(swiftSource, "LICENSE"), "utf8")).replace(/\r\n/g, "\n");
const swiftNotice = (await readFile(resolve(swiftSource, "NOTICE"), "utf8")).replace(/\r\n/g, "\n");
await writeFile(resolve(licenses, "blobatar-swift.txt"), `${swiftLicense.trimEnd()}\n\n${swiftNotice.trimEnd()}\n`);
console.log(`Generated ${AVATAR_SHAPES.length * AVATAR_COLOURS.length} Blobatar choices; geometry invariant across colours, ${AVATAR_SHAPES.length} legacy presets preserved, MIT notices included.`);
