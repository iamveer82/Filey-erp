export function integrationAllowed(member: { role?: string; modules?: unknown } | null, provider: string): boolean {
  if (!member) return false;
  return ["owner","admin"].includes(member.role ?? "") || member.modules === null ||
    Array.isArray(member.modules) && member.modules.includes(provider === "zernio" ? "marketing" : "integrations");
}

export async function integrationEntity(orgId: string, userId: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${orgId}:user:${userId}`));
  return `filey-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2,"0")).join("")}`;
}

/** Never return OAuth state, tokens or arbitrary provider account fields. */
export function connectionSummary(account: Record<string,unknown>, userId: string) {
  if (account.user_id !== userId) throw new Error("Connection belongs to a different workspace.");
  const toolkit = account.toolkit as {slug?:string} | undefined;
  return {id:account.id,status:account.status,toolkit:{slug:toolkit?.slug}};
}
