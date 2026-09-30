/** Service-role callers must recheck the user's CURRENT workspace authority.
 *  A profile workspace alone is not permission: ordinary members can switch
 *  into a team whose private records remain protected by RLS in the app. */
export async function adminWorkspace(
  // deno-lint-ignore no-explicit-any
  client: any,
  userId: string,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data: profile, error: profileError } = await client.from("profiles")
      .select("org_id").eq("id", userId).maybeSingle();
    if (profileError || !profile?.org_id) return null;
    const orgId = String(profile.org_id);
    const { data: member, error: memberError } = await client.from("org_members")
      .select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
    return !memberError && ["owner", "admin"].includes(member?.role) ? orgId : null;
  } catch {
    return null;
  }
}
