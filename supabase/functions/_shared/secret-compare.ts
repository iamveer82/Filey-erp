// Constant-time comparison for shared secrets on endpoints deployed with
// --no-verify-jwt, where the header is the only authentication. A plain
// `!==` short-circuits at the first differing byte and leaks the matched
// prefix length under a timing oracle. Hashing both sides first normalises
// the length, so the XOR loop never exits early and nothing is leaked.
export async function secretMatches(presented: string | null | undefined, expected: string): Promise<boolean> {
  if (!expected || typeof presented !== "string") return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}
