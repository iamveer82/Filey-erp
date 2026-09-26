// Run after `npx vite build --manifest`; counts only initial JS, not lazy routes.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const seen = new Set();
function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  for (const child of manifest[key].imports ?? []) visit(child);
}
visit('index.html');
const files = [...seen].map(key => {
  const file = manifest[key].file;
  const bytes = readFileSync(`dist/${file}`);
  return { file, bytes: bytes.length, gzip: gzipSync(bytes).length };
});
const result = {
  chunks: files.length,
  bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  gzip: files.reduce((sum, file) => sum + file.gzip, 0),
  files: files.sort((a, b) => b.bytes - a.bytes),
};
console.log(JSON.stringify(result, null, 2));
