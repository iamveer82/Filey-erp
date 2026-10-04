// Targeted real-PostgreSQL entry; reuse the complete clean installer and safe
// disposable cluster harness without rerunning unrelated behavioral fixtures.
process.argv.push('--recurrence');
await import('./test-schema-bootstrap-local.mjs');
