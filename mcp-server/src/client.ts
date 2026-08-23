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
 *   FILEY_EMAIL + FILEY_PASSWORD — we sign in with password and supabase-js keeps the session refreshed
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

/** Cap every outbound request so a hung connection can never stall the tool
 *  loop. Merges with any signal the caller already set instead of overwriting. */
function timedFetch(ms: number): typeof fetch {
  return async (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
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

  let userId: string | null;

  let supabase: SupabaseClient;
  if (accessToken) {
    // Pinned-token path: the JWT comes from outside, so there is no refresh
    // token to use — keep pinning it exactly as before.
    supabase = createClient(url!, anonKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
        fetch: timedFetch(15_000),
      },
    });
    userId = jwtSub(accessToken);
  } else {
    // Password grant: sign in ON the main client with sessions enabled, so
    // supabase-js keeps refreshing the access token for as long as this server
    // runs. (Pinning the returned JWT used to kill every install after ~1h.)
    supabase = createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: timedFetch(15_000) },
    });
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email!,
      password: password!,
    });
    if (error || !data.session) {
      envError(`Sign-in failed for ${email}: ${error?.message ?? "no session"}`);
    }
    userId = jwtSub(data.session!.access_token);
  }

  if (!userId) {
    envError("Could not determine user id from the access token.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, org_id")
    .eq("id", userId!)
    .single();

  if (error || !profile) {
    const expired =
      !!error &&
      ((error as any).code === "PGRST301" ||
        /expired|jwt|401|invalid signature/i.test(error.message ?? ""));
    envError(
      `Failed to load profile for user ${userId}: ${error?.message ?? "not found"}.` +
        (expired
          ? " The access token looks expired — restart the MCP server or re-authenticate " +
            "(refresh SUPABASE_ACCESS_TOKEN, or switch to FILEY_EMAIL + FILEY_PASSWORD so " +
            "the session refreshes automatically)."
          : " Check that the token belongs to a Filey user with a profiles row.")
    );
  }

  return {
    supabase,
    userId: profile!.id as string,
    orgId: profile!.org_id as string,
    local: false,
  };
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
