// Real browser security boundaries; isolated profile and synthetic requests only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createServer } from 'vite';

const html = (await readFile('index.html', 'utf8')).replace(/\r\n?/g, '\n');
const config = JSON.parse(await readFile('vercel.json', 'utf8'));
const metaPolicy = source => source.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1];
const policy = metaPolicy(html);
const headers = config.headers.find(row => row.source === '/(.*)').headers;
const headerPolicy = headers.find(row => row.key === 'Content-Security-Policy')?.value;
const builtHtml = process.argv.includes('--production') ? (await readFile('dist/index.html', 'utf8')).replace(/\r\n?/g, '\n') : null;
for (const [page, value] of [[html, policy], [html, headerPolicy], ...(builtHtml ? [[builtHtml, metaPolicy(builtHtml)], [builtHtml, headerPolicy]] : [])]) {
  assert.ok(value, 'Production CSP must be present');
  const scripts = value.match(/(?:^|;)\s*script-src\s+([^;]+)/)?.[1];
  assert.ok(scripts?.includes("'wasm-unsafe-eval'"));
  assert.ok(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"));
  for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
    assert.ok(scripts.includes(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`), 'Trusted boot script hash must match its exact bytes');
  }
}
assert.ok(headerPolicy.includes("frame-ancestors 'none'"));
assert.equal(headers.find(row => row.key === 'Referrer-Policy')?.value, 'no-referrer');

let leakedRequests = 0;
const redirectTarget = httpServer((_req, res) => { leakedRequests++; res.setHeader('Access-Control-Allow-Origin', '*'); res.end('unexpected'); });
await new Promise(resolve => redirectTarget.listen(0, '127.0.0.1', resolve));
const target = `http://127.0.0.1:${redirectTarget.address().port}/private`;
let finish;
const result = new Promise(resolve => { finish = resolve; });
let origin;
const received = [];
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, plugins: [{
  name: 'filey-web-security-fixture',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/__filey_security') {
        const fixture = html.replace('src="/src/main.tsx"', 'src="/scripts/fixtures/web-security.ts"');
        void server.transformIndexHtml(req.url, fixture).then(page => {
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Content-Security-Policy', `${metaPolicy(page)} frame-ancestors 'none';`);
          res.setHeader('Referrer-Policy', 'no-referrer');
          res.setHeader('Set-Cookie', ['filey_theme=dark; Path=/', 'filey_accent=blue; Path=/']);
          res.end(page);
        }).catch(next);
      } else if (['/__filey_security_redirect', '/rest/v1/security-redirect'].includes(req.url)) {
        received.push({ path: req.url, hasCookie: !!req.headers.cookie, hasReferrer: !!req.headers.referer });
        res.writeHead(307, { Location: target }); res.end();
      } else if (req.url === '/__filey_security_result' && req.method === 'POST' && req.headers.origin === origin) {
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 8192) req.destroy(); });
        req.on('end', () => { try { finish(JSON.parse(body)); res.end('ok'); } catch { res.writeHead(400); res.end(); } });
      } else next();
    });
  },
}] });
const profile = await mkdtemp(join(tmpdir(), 'filey-web-security-'));
let browser, timeout;
try {
  await server.listen();
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  let executable = process.env.CHROME_PATH || (process.platform === 'win32' ? join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe') : 'google-chrome');
  if (process.platform === 'win32' && !process.env.CHROME_PATH) {
    try { await access(executable); } catch { executable = join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'); }
  }
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `${origin}/__filey_security`], { stdio: 'ignore', windowsHide: true });
  browser.on('error', () => finish({ ok: false, error: 'Could not launch the fixture browser.' }));
  timeout = setTimeout(() => finish({ ok: false, error: 'Browser security checks did not finish within 60 seconds.' }), 60000);
  const output = await result;
  assert.equal(output.ok, true, output.error);
  assert.equal(leakedRequests, 0, 'Redirect target must receive no private request');
  assert.equal(received.length, 2);
  assert.ok(received.every(request => !request.hasCookie && !request.hasReferrer));
  console.log(JSON.stringify({ ...output, productionPolicies: 'passed', builtPolicies: builtHtml ? 'passed' : 'not checked before build', redirectedPrivateRequests: leakedRequests, cookiesAndReferrers: 'omitted' }, null, 2));
} finally {
  clearTimeout(timeout); browser?.kill();
  await server.close();
  await new Promise(resolve => redirectTarget.close(resolve));
  const inside = relative(resolve(tmpdir()), resolve(profile));
  if (!inside.startsWith('..') && inside.startsWith('filey-web-security-')) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
