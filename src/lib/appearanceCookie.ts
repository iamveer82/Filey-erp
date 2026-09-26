// Small, host-only visual preferences. Never put records, auth tokens or API
// keys in these cookies; Supabase remains responsible for the session.
type Preference = "theme" | "accent";
export function readAppearanceCookie(name: Preference): string | undefined {
  if (typeof document === "undefined") return;
  try {
    const prefix = `filey_${name}=`;
    const value = document.cookie.split(/;\s*/).find(part => part.startsWith(prefix));
    return value ? decodeURIComponent(value.slice(prefix.length)) : undefined;
  } catch { return undefined; }
}

export function writeAppearanceCookie(name: Preference, value: string): void {
  if (typeof document === "undefined" || "__TAURI_INTERNALS__" in window) return;
  try {
    document.cookie = `filey_${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* Storage restrictions must not prevent changing appearance. */ }
}
