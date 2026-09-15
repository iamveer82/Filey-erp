// Inspect the actual production graph, not the sum of every lazy asset.
import {readFileSync,statSync} from 'node:fs';
import assert from 'node:assert/strict';
let manifest;
try { manifest=JSON.parse(readFileSync('dist/.vite/manifest.json','utf8')); }
catch { console.error('No build manifest. Run: npm run build -- --manifest'); process.exit(1); }
for(const root of ['index.html','src/pages/Crm.tsx','src/pages/Invoicing.tsx']) {
  const seen=new Set();
  function visit(key){if(seen.has(key))return;seen.add(key);for(const imported of manifest[key].imports||[])visit(imported);}
  visit(root);
  const engines=[...seen].filter(key=>/heic|vtracer|tesseract|mammoth|ag-psd|pptxgen/i.test(key));
  assert.deepEqual(engines,[],root+' eagerly imports an unrelated converter');
  if(root!=='src/pages/Invoicing.tsx') assert(![...seen].some(key=>/pdfTools|pdfjsSafe/i.test(key)),root+' eagerly imports PDF tools');
  console.log(root+': '+[...seen].reduce((n,key)=>n+statSync('dist/'+manifest[key].file).size,0)+' bytes of static JS; unrelated converters remain lazy');
}
