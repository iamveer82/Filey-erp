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

/** `{{secret:NAME}}` — a reference to a stored credential. */
const SECRET_REF = /\{\{\s*secret:\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;

export interface FilledSecrets {
  text: string;
  /** Names substituted, for reporting back. Never the values. */
  used: string[];
  /** Names referenced that are not in the store. */
  missing: string[];
}

/**
 * Replace secret references with their values.
 *
 * The point is that the agent never handles the credential. Before this the
 * only way to use a stored key was `recall_secret`, which returns the value
 * into the conversation — so the key went to the model provider, into the chat
 * transcript, and into whatever the transcript is later pasted into. A
 * reference lets the model write `Authorization: Bearer {{secret:stripe}}`
 * while the substitution happens inside the tool, after the approval prompt has
 * shown the owner the reference rather than the key.
 *
 * `lookup` is injected so this is testable without touching localStorage.
 */
export function fillSecrets(
  text: string,
  lookup: (name: string) => string | null = recallSecret
): FilledSecrets {
  const used = new Set<string>();
  const missing = new Set<string>();
  const out = (text ?? "").replace(SECRET_REF, (whole, name: string) => {
    const v = lookup(name);
    if (v === null || v === undefined) {
      missing.add(name);
      return whole; // leave the reference visible rather than sending "null"
    }
    used.add(name);
    return v;
  });
  return { text: out, used: [...used], missing: [...missing] };
}

/** Does this text reference any secret? Cheap pre-check for callers that want
 *  to skip the work entirely. */
export function hasSecretRef(text: string): boolean {
  SECRET_REF.lastIndex = 0; // the regex is global, so its cursor persists
  return SECRET_REF.test(text ?? "");
}
