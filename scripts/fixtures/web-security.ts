import { aiFetch } from '../../src/lib/ai';
import { sessionFetch } from '../../src/lib/cloudSession';

const results: Record<string, boolean> = {};
function check(name: string, value: boolean) {
  results[name] = value;
  if (!value) throw new Error(name);
}
async function run() {
  check('trustedBootPreferences', document.documentElement.classList.contains('dark') && document.documentElement.dataset.accent === 'blue');
  const state = window as unknown as { inlineLeak?: boolean; handlerLeak?: boolean; evalLeak?: boolean };
  const script = document.createElement('script');
  script.textContent = 'window.inlineLeak = true'; document.head.append(script);
  check('arbitraryInlineScriptBlocked', !state.inlineLeak);
  const button = document.createElement('button');
  button.setAttribute('onclick', 'window.handlerLeak = true'); document.body.append(button); button.click();
  check('inlineEventHandlerBlocked', !state.handlerLeak);
  let blocked = false;
  try { Function('window.evalLeak = true')(); } catch { blocked = true; }
  check('dynamicJavascriptBlocked', blocked && !state.evalLeak);
  await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  check('wasmStillAvailable', true);
  let aiRejected = false;
  try {
    await aiFetch(`${location.origin}/__filey_security_redirect`, {
      method: 'POST', headers: { 'x-api-key': 'synthetic-provider-key' }, body: 'synthetic private conversation',
      redirect: 'follow', credentials: 'include', referrerPolicy: 'unsafe-url',
    }, { retries: 0 });
  } catch { aiRejected = true; }
  check('aiRedirectRefused', aiRejected);
  let cloudRejected = false;
  try {
    await sessionFetch(location.origin, () => null)(`${location.origin}/rest/v1/security-redirect`, {
      method: 'POST', headers: { authorization: 'Bearer synthetic-account-key' }, body: 'synthetic private document',
      redirect: 'follow', credentials: 'include', referrerPolicy: 'unsafe-url',
    });
  } catch { cloudRejected = true; }
  check('cloudRedirectRefused', cloudRejected);
}
void run().then(() => fetch('/__filey_security_result', { method: 'POST', body: JSON.stringify({ ok: true, checks: results }) }))
  .catch(error => fetch('/__filey_security_result', { method: 'POST', body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Browser security fixture failed', checks: results }) }));
