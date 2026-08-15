// Owner-only secret store: credentials the owner gives the agent (API keys,
// portal logins) so it can use them later. Stored in localStorage, keyed by
// name. The tools are ownerOnly, so a customer can never read or write these.
const PREFIX = "filey.secret.";

export function saveSecret(name: string, value: string): void {
  localStorage.setItem(PREFIX + name, value);
}

export function recallSecret(name: string): string | null {
  return localStorage.getItem(PREFIX + name);
}

export function listSecrets(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
  }
  return out;
}

export function deleteSecret(name: string): void {
  localStorage.removeItem(PREFIX + name);
}
