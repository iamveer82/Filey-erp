// Real Chromium + production conversion code; isolated profile, generated files only.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'filey-browser-fixture-'));
let finish;
const result = new Promise(resolve => { finish = resolve; });
let origin;
const server = await createServer({server:{host:'127.0.0.1',port:0,open:false},plugins:[{
  name:'filey-browser-fixture',
  configureServer(server) {
    server.middlewares.use((req,res,next)=>{
      if(req.url === '/__filey_fixture') {
        res.setHeader('Content-Type','text/html');
        void server.transformIndexHtml(req.url, '<!doctype html><html><head><title>Filey file-tool fixtures</title></head><body><h1>File tool checks</h1><pre id="result">Running generated fixtures…</pre><script type="module" src="/scripts/fixtures/browser-tools.ts"></script></body></html>').then(html=>res.end(html)).catch(next);
      } else if(req.url === '/__filey_fixture_result' && req.method === 'POST' && req.headers.origin === origin) {
        let body='';
        req.on('data',chunk=>{body+=chunk;if(body.length>8_000_000)req.destroy();});
        req.on('end',()=>{try{finish(JSON.parse(body));res.end('ok');}catch{res.statusCode=400;res.end();}});
      } else next();
    });
  },
}]});
let browser;
let timeout;
try {
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const windowsChrome = join(process.env.PROGRAMFILES || 'C:/Program Files','Google/Chrome/Application/chrome.exe');
  const windowsEdge = join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe');
  let executable = process.env.CHROME_PATH || (process.platform === 'win32' ? windowsChrome : 'google-chrome');
  if(process.platform === 'win32' && !process.env.CHROME_PATH) { try{await access(executable);}catch{executable=windowsEdge;} }
  browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`${origin}/__filey_fixture`],{stdio:'ignore',windowsHide:true});
  browser.on('error',error=>finish({ok:false,error:error.message}));
  timeout=setTimeout(()=>finish({ok:false,error:'Browser fixtures did not finish within 60 seconds.'}),60000);
  const output=await result;
  for (const artifact of output.artifacts || []) {
    if (artifact.name !== "arabic-invoice.png") throw new Error("Unexpected fixture artifact");
    const path = join(tmpdir(), "filey-fixture-" + artifact.name);
    await writeFile(path, Buffer.from(artifact.base64,"base64"));
    artifact.path = path; delete artifact.base64;
  }
  console.log(JSON.stringify(output,null,2));
  if(!output.ok)process.exitCode=1;
} finally {
  clearTimeout(timeout);
  browser?.kill();
  await server.close();
  // Only remove the exact disposable directory created above, never an app profile.
  const inside=relative(resolve(tmpdir()),resolve(profile));
  if(!inside.startsWith('..') && inside.startsWith('filey-browser-fixture-'))
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>console.warn(`Temporary browser profile retained: ${profile}`));
}
