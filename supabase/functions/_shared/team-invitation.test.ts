import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { invitationEmail, sendInvitation } from "./team-invitation.ts";
const invite = {
  id: "invite-1",
  email: "teammate@example.invalid",
  email_send_id: "attempt-1",
  email_status: "sending",
  workspace_name: "<Acme & Co>",
  role: "staff",
};
Deno.test("invitation escapes names and uses a fixed app link", () => {
  const email = invitationEmail(invite, "https://app.gofiley.com");
  assert(email.html.includes("&lt;Acme &amp; Co&gt;"));
  assert(email.html.includes("/#/settings?section=users&amp;invite=invite-1"));
});
Deno.test(
  "retries use the same provider key; accepted is distinct from delivered",
  async () => {
    const keys: string[] = [];
    const send: typeof fetch = async (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return new Response("{}", { status: 200 });
    };
    const config = {
      key: "test",
      from: "Filey <test@example.invalid>",
      appUrl: "https://app.gofiley.com",
    };
    assertEquals((await sendInvitation(invite, config, send)).status, "accepted");
    await sendInvitation(invite, config, send);
    assertEquals(keys, ["filey-invite/attempt-1", "filey-invite/attempt-1"]);
    assertEquals(
      (
        await sendInvitation(invite, config, async () => {
          throw new Error("timeout");
        })
      ).status,
      "unknown"
    );
    assertEquals(
      (
        await sendInvitation(
          invite,
          config,
          async () => new Response("{}", { status: 422 })
        )
      ).status,
      "failed"
    );
  }
);
