// Puts Office work's apps into public/ (desktop builds only; see vite.config.ts):
// Word = WordCraft, Sheets = GridCraft, PDF = PdfCraft, Slides = DeckCraft, Designs = DesignCraft,
// Fig = FigCraft, Vector = VectorCraft (MIT OR Apache-2.0,
// github.com/storytold). Filey ships each rebuilt with scripts/<app>/filey-control.patch,
// which lets the Filey agent drive it. The 30-80 MB wasm stays out of git: each zip is
// pinned by SHA-256.
//
//   node scripts/fetch-office-apps.mjs [--optional]               download (--optional: warn, don't fail)
//   node scripts/fetch-office-apps.mjs --from <dir> --app <name>  install a local `trunk build` (dist/web)
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

// SHA256 is set when the patched build is published as a release asset.
const APPS = {
  wordcraft: { version: '0.7.0-filey.2', sha256: 'b27148484cdfb3eda1db529ef0f20318e401c6bf51a37ee9f399b560c1d4edc1' },
  gridcraft: { version: '0.7.0-filey.1', sha256: 'ca7e63579c337c000849375bca9d74403830c5b00fbc77734c7540ee8245aec0' },
  pdfcraft: { version: '0.8.0-filey.2', sha256: '1096a2f15169ee98c8c9a9ec81edc1e1579d894b78cc14d12d04f7361966db5b' },
  deckcraft: { version: '0.7.0-filey.1', sha256: '29d96b1b9cc5c04c7f3b6c7dfaca70003e6eb85f844569d560fe99a26148b49a' },
  designcraft: { version: '0.8.0-filey.1', sha256: 'ba378e3754cf0c0b2908e60ef6f3815f31d5d4f75b580ac676f02853ea59dc3b' },
  figcraft: { version: '0.6.0-filey.1', sha256: '43fde951c77976ec78177320829da9b891a2e3a455dffc837606324b65f0cc00' },
  vectorcraft: { version: '0.12.0-filey.1', sha256: 'bf14e5d3cc0b72e516921a97226bacb8018b707b9842880c1a55f941cf574ab4' },
};
const KEEP = /^([\w.-]+\.(?:html|js|wasm|ico|css|png|svg|woff2?|ttf|json)|LICENSE-MIT|LICENSE-APACHE)$/;

// The apps do their work in frames. In a hidden or minimised window eframe makes
// them with a 10 ms timer, which the webview slows to one a second (one a minute
// after five minutes), so an agent request from WhatsApp would time out. Those
// frames stay on their normal timer and can also be run early by Filey while a
// request waits (officeWord.ts runFramesWhileHidden). The shim stays in the iframe.
const FRAME_SHIM = `{
  const queued = new Map(); let next = 0;
  const later = window.setTimeout.bind(window), cancel = window.clearTimeout.bind(window);
  window.setTimeout = (cb, ms, ...args) => {
    if (!(document.hidden && ms === 10 && typeof cb === 'function')) return later(cb, ms, ...args);
    const id = --next, run = () => { if (queued.delete(id)) cb(...args); };
    queued.set(id, run);
    later(run, ms);
    return id;
  };
  window.clearTimeout = id => id < 0 ? queued.delete(id) : cancel(id);
  // Nothing queued: the loop is stalled (a page loaded while hidden never gets its
  // first frame). eframe reschedules on visibilitychange, onto the timer above.
  window.fileyRunFrames = () => {
    if (!queued.size) document.dispatchEvent(new Event('visibilitychange'));
    for (const run of [...queued.values()]) run();
  };
}
`;

// ponytail: tiny central-directory reader (stored/deflate, no zip64), fine for pinned zips.
function unzip(zip, app) {
  const files = new Map();
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  for (let i = 0, p = zip.readUInt32LE(eocd + 16); i < zip.readUInt16LE(eocd + 10); i++) {
    const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20), nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42), name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    // Only the app's own flat files under the top folder; never a path from the archive.
    const base = name.match(new RegExp(`^${app}-web-[\\w.-]+/([^/]+)$`))?.[1];
    if (!base || !KEEP.test(base)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    files.set(base, method === 0 ? data : method === 8 ? inflateRawSync(data) : null);
  }
  return files;
}

async function install(app, files, version) {
  const out = new URL(`../public/${app}/`, import.meta.url);
  const html = files.get('index.html')?.toString('utf8');
  if (!html || ![...files.keys()].some(f => f.endsWith('.wasm'))) throw new Error('the build is missing the app');
  // Trunk inlines its boot module; Filey's CSP allows only same-origin scripts.
  const boot = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!boot) throw new Error('boot script not found');
  files.set('boot.js', Buffer.from(FRAME_SHIM + boot.trim() + '\n'));
  files.set('index.html', Buffer.from(html.replace(/<script type="module">[\s\S]*?<\/script>/, '<script type="module" src="./boot.js"></script>')));
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const [name, bytes] of files) await writeFile(new URL(name, out), bytes);
  await writeFile(new URL('VERSION', out), version);
  console.log(`${app} ${version} ready (${files.size} files)`);
}

const optional = process.argv.includes('--optional');
const arg = flag => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : '';
const from = arg('--from');
for (const [app, { version, sha256 }] of Object.entries(APPS)) {
  if (from && arg('--app') !== app) continue;
  try {
    let files;
    if (from) {
      files = new Map();
      for (const name of await readdir(from)) if (KEEP.test(name)) files.set(name, await readFile(join(from, name)));
    } else {
      const have = await readFile(new URL(`../public/${app}/VERSION`, import.meta.url), 'utf8').catch(() => '');
      if (have === version) continue;
      if (!sha256) throw new Error(`no published build for ${version} yet; build it and install with --from`);
      const res = await fetch(`https://github.com/iamveer82/Filey-erp/releases/download/${app}-${version}/${app}-web-${version}.zip`);
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      const zip = Buffer.from(await res.arrayBuffer());
      if (createHash('sha256').update(zip).digest('hex') !== sha256) throw new Error('checksum mismatch');
      files = unzip(zip, app);
    }
    await install(app, files, version);
  } catch (error) {
    console[optional ? 'warn' : 'error'](`${app}: ${error.message}`);
    if (!optional) process.exitCode = 1;
  }
}
