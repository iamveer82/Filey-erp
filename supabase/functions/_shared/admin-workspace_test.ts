import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adminWorkspace } from "./admin-workspace.ts";

function workspaceClient(options: {
  org?: string | null;
  role?: string | null;
  profileError?: boolean;
  memberError?: boolean;
  throws?: boolean;
}) {
  const filters: Array<[string, string, unknown]> = [];
  return {
    filters,
    from(table: string) {
      const query = {
        select: (_columns: string) => query,
        eq(column: string, value: unknown) {
          filters.push([table, column, value]);
          return query;
        },
        maybeSingle() {
          if (options.throws) throw new Error("unavailable");
          return Promise.resolve(table === "profiles"
            ? { data: { org_id: options.org ?? null }, error: options.profileError ? {} : null }
            : { data: options.role ? { role: options.role } : null, error: options.memberError ? {} : null });
        },
      };
      return query;
    },
  };
}

Deno.test("service-role workspace is the current profile's active owner/admin membership", async () => {
  for (const role of ["owner", "admin"]) {
    const client = workspaceClient({ org: "CURRENT", role });
    assertEquals(await adminWorkspace(client, "USER"), "CURRENT");
    assertEquals(client.filters, [
      ["profiles", "id", "USER"],
      ["org_members", "org_id", "CURRENT"],
      ["org_members", "user_id", "USER"],
    ]);
  }
});

Deno.test("switching an owner account into another team as staff cannot elevate service-role access", async () => {
  for (const role of ["staff", "viewer", "OWNER", null]) {
    assertEquals(await adminWorkspace(workspaceClient({ org: "OTHER_TEAM", role }), "USER"), null);
  }
});

Deno.test("removed membership, absent profile and lookup failures fail closed", async () => {
  for (const options of [
    { org: "ORG", role: null },
    { role: "owner" },
    { org: "ORG", role: "owner", profileError: true },
    { org: "ORG", role: "owner", memberError: true },
    { org: "ORG", role: "owner", throws: true },
  ]) assertEquals(await adminWorkspace(workspaceClient(options), "USER"), null);
  const client = workspaceClient({ org: "ORG", role: "owner" });
  assertEquals(await adminWorkspace(client, ""), null);
  assertEquals(client.filters, []);
});
