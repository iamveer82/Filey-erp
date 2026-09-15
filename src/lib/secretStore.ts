import { credentialNames, peekCredential, readCredential, saveCredential } from "./credentialStore";
const PREFIX = "agent:";
function validName(name: string): string {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) throw new Error("Use a secret name containing letters, numbers, dots, underscores or hyphens.");
  return PREFIX + name;
}

export function saveSecret(name: string, value: string): Promise<void> {
  return saveCredential(validName(name), value);
}

export function recallSecret(name: string): Promise<string | null> {
  return readCredential(validName(name));
}

export function listSecrets(): string[] {
  return credentialNames().filter(name => name.startsWith(PREFIX)).map(name => name.slice(PREFIX.length));
}

export function deleteSecret(name: string): Promise<void> {
  return saveCredential(validName(name), null);
}

/** `{{secret:NAME}}` — a reference to a stored credential. */
const SECRET_REF = /\{\{\s*secret:\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

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
  lookup: (name: string) => string | null = name => peekCredential(validName(name)) || null
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

/** Resolve only the referenced names; the returned redactor stays inside the
 * tool closure and removes provider echoes before they enter the transcript. */
export async function secretSubstitutions(texts: string[]) {
  const names = [...new Set(texts.flatMap(text => [...text.matchAll(SECRET_REF)].map(match => match[1])))];
  const stored = new Map(await Promise.all(names.map(async name => [name, await recallSecret(name)] as const)));
  const variants = [...new Set([...stored.values()].filter((value): value is string => !!value)
    .flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1,-1)]))].sort((a,b) => b.length-a.length);
  return {
    fill: (text: string) => fillSecrets(text, name => stored.get(name) ?? null),
    redact: (text: string) => variants.reduce((out, value) => out.split(value).join("[REDACTED]"), text),
  };
}

/** Does this text reference any secret? Cheap pre-check for callers that want
 *  to skip the work entirely. */
export function hasSecretRef(text: string): boolean {
  SECRET_REF.lastIndex = 0; // the regex is global, so its cursor persists
  return SECRET_REF.test(text ?? "");
}
