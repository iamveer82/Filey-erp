import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLocalClient, readLocalIdentity, resolveDbPath } from "./localdb.js";

export interface Ctx {
  supabase: SupabaseClient;
  userId: string;
  orgId: string;
  /** True when reading the desktop app's SQLite file instead of Supabase. */
  local: boolean;
}

let cached: Promise<Ctx> | null = null;

function envError(msg: string): never {
  // MCP servers must keep stdout clean for JSON-RPC; all diagnostics go to stderr.
  console.error(`[filey-erp-mcp] ${msg}`);
  process.exit(1);
}

/**
 * Lazily build the data context on first tool call.
 *
 * LOCAL MODE (no account, no network) — used when FILEY_LOCAL_DB or FILEY_LOCAL
 * is set, and auto-selected when SUPABASE_URL is absent but the desktop app's
 * database exists on this machine. Reads/writes the app's own SQLite file.
 *   FILEY_LOCAL_DB  — explicit path to filey-erp.db (default: the app-data dir)
 *   FILEY_LOCAL=1   — force local mode even if SUPABASE_URL is set
 *
 * CLOUD MODE — required env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 * Auth (one of):
 *   SUPABASE_ACCESS_TOKEN  — a user JWT pinned via rest.headers.Authorization so RLS runs as that user
 *   FILEY_EMAIL + FILEY_PASSWORD — we sign in with password and pin the returned access token
 */
export function getCtx(): Promise<Ctx> {
  if (!cached) {
    cached = initCtx().catch((err) => {
      cached = null; // allow retry on next call
      throw err;
    });
  }
  return cached;
}

/** Local mode is explicit (FILEY_LOCAL / FILEY_LOCAL_DB) or the only thing that
 *  can work (no SUPABASE_URL, but the desktop database is right there). */
function localDbPath(): string | null {
  const forced = !!process.env.FILEY_LOCAL_DB || process.env.FILEY_LOCAL === "1";
  if (!forced && process.env.SUPABASE_URL) return null;
  const file = resolveDbPath();
  if (!file && forced) {
    envError(
      "Local mode requested but no Filey database found. Set FILEY_LOCAL_DB to " +
        "the full path of filey-erp.db (Settings → Data in the desktop app shows the folder)."
    );
  }
  return file;
}

async function initCtx(): Promise<Ctx> {
  const file = localDbPath();
  if (file) {
    const { userId, orgId } = readLocalIdentity(file);
    console.error(`[filey-erp-mcp] local mode — ${file}`);
    return {
      // The local client implements only the query-builder slice tools.ts uses.
      supabase: createLocalClient(file, { userId, orgId }) as unknown as SupabaseClient,
      userId,
      orgId,
      local: true,
    };
  }

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const email = process.env.FILEY_EMAIL;
  const password = process.env.FILEY_PASSWORD;

  if (!url || !anonKey) {
    envError(
      "Missing SUPABASE_URL and/or SUPABASE_ANON_KEY, and no local Filey " +
        "database was found. Set them in your MCP client config, or point " +
        "FILEY_LOCAL_DB at filey-erp.db to run fully offline (see README)."
    );
  }
  if (!accessToken && !(email && password)) {
    envError(
      "Missing auth: set SUPABASE_ACCESS_TOKEN (a Filey user JWT) " +
        "or FILEY_EMAIL + FILEY_PASSWORD."
    );
  }

  const tokenToPin = accessToken ?? (await signIn(url!, anonKey, email!, password!));

  const supabase = createClient(url!, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${tokenToPin}` },
    },
  });

  // Resolve user id from the JWT payload (sub claim).
  const userId = jwtSub(tokenToPin);
  if (!userId) {
    envError("Could not determine user id from the access token.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId!)
    .single();

  if (error || !profile) {
    envError(
      `Failed to load profile for user ${userId}: ${error?.message ?? "not found"}. ` +
        "Check that the token belongs to a Filey user with a profiles row."
    );
  }

  return {
    supabase,
    userId: profile!.id as string,
    orgId: profile!.org_id as string,
    local: false,
  };
}

async function signIn(url: string, anonKey: string, email: string, password: string): Promise<string> {
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    envError(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`);
  }
  return data.session!.access_token;
}

function jwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}
