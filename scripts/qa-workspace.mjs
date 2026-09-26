// Isolated browser QA. Uses the real local database and UI, never a cloud account.
// Run: node scripts/qa-workspace.mjs. Production builds do not import this file.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] || 16422);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
const entry = '/@filey-qa-workspace';
const bootstrap = `
if (location.hostname !== '127.0.0.1' || location.port !== '${port}') throw new Error('QA workspace requires its isolated localhost origin.');
if (!localStorage.getItem('filey_qa_initialized')) {
  if (Object.keys(localStorage).some(key => /^(localdb:|filey_local_|sb-)/.test(key))) throw new Error('QA origin already contains business data. Use a fresh browser profile.');
  const id = '00000000-0000-4000-8000-000000000722';
  const profile = { id, email: 'qa@filey.invalid', name: 'Filey QA', company: 'Filey Test Trading', org_id: 'default' };
  localStorage.setItem('filey_data_mode', 'local');
  localStorage.setItem('filey_local_credential', JSON.stringify({ email: profile.email, userId: id, verifiedAt: new Date().toISOString() }));
  localStorage.setItem('filey_local_profile', JSON.stringify(profile));
  localStorage.setItem('filey_local_workspace_owner', id);
  localStorage.setItem('filey_local_session', '1');
  localStorage.setItem('theme', 'light');
  localStorage.setItem('filey_qa_initialized', '1');
}
document.title = 'Filey · isolated QA workspace';
await import('/src/main.tsx');
const label = document.createElement('div');
label.textContent = 'Local QA workspace · disposable test records · cloud disconnected';
label.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;padding:4px 12px;background:#faca1a;color:#171717;font:11px system-ui;text-align:center;pointer-events:none';
document.body.append(label);
`;
const server = await createServer({
  root,
  cacheDir: 'node_modules/.vite-qa',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://your-project.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('your-anon-key'),
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(''),
  },
  plugins: [{
    name: 'filey-isolated-qa',
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/src/main.tsx', entry) },
    resolveId(id) { if (id === entry) return '\0filey-qa-workspace'; },
    load(id) { if (id === '\0filey-qa-workspace') return bootstrap; },
  }],
  server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false },
});
await server.listen();
server.printUrls();
