// Bun bundles JavaScript, but sharp's native addon needs libvips beside it on
// the real filesystem. Keep each target separate, including cross-builds.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { values } = parseArgs({ options: { outfile: { type: 'string' }, target: { type: 'string' } } });
if (!values.outfile) throw new Error('Choose the sidecar output path with --outfile.');
const target = values.target ?? `bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
const match = /^bun-(windows|darwin|linux)-(x64|arm64)(-musl)?$/.exec(target);
if (!match) throw new Error('Choose a supported Bun desktop target.');
const platform = `${match[1] === 'windows' ? 'win32' : match[1] === 'linux' && match[3] ? 'linuxmusl' : match[1]}-${match[2]}`;
const outfile = path.resolve(values.outfile);
const mediaDir = path.join(path.dirname(outfile), 'wa-media');
const packageNames = [`@img/sharp-${platform}`, ...(!platform.startsWith('win32') ? [`@img/sharp-libvips-${platform}`] : [])];
const lock = JSON.parse(await fs.readFile(path.join(dir, 'package-lock.json'), 'utf8'));
async function copyPackage(source, name) {
  const destination = path.resolve(mediaDir, platform, name);
  if (!destination.startsWith(path.resolve(mediaDir, platform) + path.sep)) throw new Error('Unexpected native media destination.');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, dereference: true });
}

for (const name of packageNames) {
  let source;
  try { source = path.dirname(require.resolve(`${name}/package`)); }
  catch {
    // npm ci installs the host's optional packages. A macOS arm64 release
    // runner also needs the lockfile's x64 packages; fetch only those bytes,
    // without re-resolving dependencies or changing the lockfile.
    const entry = lock.packages?.[`node_modules/${name}`];
    const version = entry?.version;
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Missing locked media dependency: ${name}`);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'filey-wa-native-'));
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('filey-wa-native-')) throw new Error('Unexpected native package temporary directory.');
    try {
      const url = new URL(entry.resolved);
      if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('Invalid locked native package URL.');
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Could not download locked media dependency: ${name}@${version}`);
      const archive = Buffer.from(await response.arrayBuffer());
      const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
      if (entry.integrity !== integrity) throw new Error('Native package does not match the lockfile.');
      const archivePath = path.join(temporary, 'native.tgz');
      await fs.writeFile(archivePath, archive);
      source = path.join(temporary, 'package');
      await fs.mkdir(source);
      execFileSync('tar', ['-xzf', archivePath, '-C', source, '--strip-components=1']);
      await copyPackage(source, name);
    } finally {
      await fs.rm(resolved, { recursive: true, force: true });
    }
    continue;
  }
  await copyPackage(source, name);
}
const nativeDir = path.join(mediaDir, platform, packageNames[0], 'lib');
const addons = (await fs.readdir(nativeDir)).filter(name => name.endsWith('.node'));
if (addons.length !== 1) throw new Error('The selected media package must contain one native addon.');
const nativeRelative = path.relative(mediaDir, path.join(nativeDir, addons[0])).split(path.sep).join('/');

const result = await globalThis.Bun.build({
  entrypoints: [path.join(dir, 'index.mjs')],
  target: 'bun',
  compile: { target, outfile },
  plugins: [{
    name: 'filey-native-media',
    setup(build) {
      build.onLoad({ filter: /[\\/]sharp[\\/]dist[\\/]sharp\.(cjs|mjs)$/ }, ({ path: filename }) => ({
        loader: 'js',
        contents: `
          import path from 'node:path';
          import { createRequire } from 'node:module';
          import { parseArgs } from 'node:util';
          const { values } = parseArgs({ args: process.argv.slice(2), strict: false, allowPositionals: true, options: { 'media-dir': { type: 'string' } } });
          const media = values['media-dir'] ?? path.join(path.dirname(process.execPath), 'wa-media');
          if (!path.isAbsolute(media)) throw new Error('WhatsApp media directory must be an absolute path.');
          const binding = createRequire(process.execPath)(path.join(media, ${JSON.stringify(nativeRelative)}));
          ${filename.endsWith('.mjs') ? 'export default binding;' : 'module.exports = binding;'}
        `,
      }));
    },
  }],
});
if (!result.success) throw new AggregateError(result.logs, 'WhatsApp sidecar compilation failed.');
console.log(`Built WhatsApp sidecar and native media for ${platform}.`);
