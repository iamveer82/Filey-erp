// Freedom-plan enquiries. Posts to the public `lead-contact` edge function,
// which records the lead and emails the owner through Resend.
//
// Deliberately not routed through the supabase client: the function runs with
// --no-verify-jwt so the same call works from the marketing site and from a
// signed-out app, and it needs no key of any kind.
const FN_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(
    ".supabase.co",
    ".functions.supabase.co"
  ) ?? "https://voyrjqgaypiylwskkwpr.functions.supabase.co";

export interface Lead {
  name: string;
  phone: string;
  email?: string;
  message?: string;
  source?: "app" | "website";
}

export async function submitLead(lead: Lead): Promise<void> {
  if (!lead.name.trim() || !lead.phone.trim())
    throw new Error("Please give a name and a phone number.");

  const res = await fetch(`${FN_URL}/lead-contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...lead, source: lead.source ?? "app" }),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;
  if (!res.ok || body?.error)
    throw new Error(body?.error ?? "Could not send your request — please try again.");
}
