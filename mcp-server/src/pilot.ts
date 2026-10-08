import type { Ctx } from "./client.js";

/** This policy belongs to one child process and never accepts model-provided scope. */
export interface PilotBinding {
  version: 1;
  user_id: string;
  org_id: string;
  data_mode: "cloud";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_ERROR = "Filey Hermes pilot access could not be verified. Restart the task from Filey.";
const ENV_KEYS = ["FILEY_MCP_MODE", "FILEY_HERMES_BINDING", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_ACCESS_TOKEN",
  "FILEY_LOCAL", "FILEY_LOCAL_DB", "FILEY_LOCAL_USER_ID", "FILEY_EMAIL", "FILEY_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"] as const;

/** Explicitly reviewed reads only. Adding a tool requires its module and test coverage. */
export const pilotToolModules: Readonly<Record<string, readonly string[]>> = Object.freeze({
  get_financial_summary: ["accounting", "invoicing", "inventory"],
  list_invoices: ["invoicing"], get_invoice: ["invoicing"],
  list_quotes: ["quoting"], list_orders: ["orders"], list_purchase_orders: ["purchase-orders"],
  list_customers: ["customers"], find_customer: ["customers"],
  list_products: ["inventory"], list_low_stock: ["inventory"], run_report: ["reports", "invoicing"],
});

function denied(): never { throw new Error(GENERIC_ERROR); }
function claims(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)) || token.length > 16_384) return denied();
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return denied();
    return parsed as Record<string, unknown>;
  } catch { return denied(); }
}

export class PilotPolicy {
  readonly binding!: Readonly<PilotBinding>;
  readonly url!: string;
  readonly anonKey!: string;
  readonly accessToken!: string;
  private readonly environment: (string | undefined)[];

  constructor(env: NodeJS.ProcessEnv) {
    this.environment = ENV_KEYS.map(key => env[key]);
    try {
      const binding: unknown = JSON.parse(env.FILEY_HERMES_BINDING ?? "");
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) return denied();
      const value = binding as Record<string, unknown>;
      if (Object.keys(value).sort().join(",") !== "data_mode,org_id,user_id,version" || value.version !== 1 || value.data_mode !== "cloud" ||
          typeof value.user_id !== "string" || !UUID.test(value.user_id) || typeof value.org_id !== "string" ||
          !value.org_id.trim() || value.org_id !== value.org_id.trim() || value.org_id.length > 200 || /[\x00-\x1f\x7f]/.test(value.org_id)) return denied();
      this.binding = Object.freeze(value as unknown as PilotBinding);
      if (["FILEY_LOCAL", "FILEY_LOCAL_DB", "FILEY_LOCAL_USER_ID", "FILEY_EMAIL", "FILEY_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]
        .some(key => !!env[key])) return denied();
      this.url = env.SUPABASE_URL ?? "";
      const url = new URL(this.url);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (!(url.protocol === "https:" || url.protocol === "http:" && loopback) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return denied();
      this.anonKey = env.SUPABASE_ANON_KEY ?? "";
      if (!(this.anonKey.startsWith("sb_publishable_") && this.anonKey.length > 20) && claims(this.anonKey).role !== "anon") return denied();
      this.accessToken = env.SUPABASE_ACCESS_TOKEN ?? "";
      this.assertToken();
    } catch { return denied(); }
  }

  private assertToken(): void {
    const token = claims(this.accessToken);
    if (token.role !== "authenticated" || token.sub !== this.binding.user_id || !Number.isSafeInteger(token.exp) ||
        (token.exp as number) <= Math.floor(Date.now() / 1000)) denied();
  }

  assertCurrent(): void {
    if (ENV_KEYS.some((key, index) => process.env[key] !== this.environment[index])) denied();
    this.assertToken();
  }

  /** Server-verified user plus live profile/module permissions, never JWT decoding alone. */
  async authorize(ctx: Ctx, toolName?: string): Promise<void> {
    this.assertCurrent();
    if (ctx.local || ctx.userId !== this.binding.user_id || ctx.orgId !== this.binding.org_id) denied();
    const modules = toolName === undefined ? [] : Object.hasOwn(pilotToolModules, toolName) ? pilotToolModules[toolName] : undefined;
    if (!modules) denied();
    const { data: user, error: authError } = await ctx.supabase.auth.getUser(this.accessToken);
    this.assertCurrent();
    if (authError || user.user?.id !== this.binding.user_id) denied();
    const { data: profile, error: profileError } = await ctx.supabase.from("profiles")
      .select("id, org_id").eq("id", this.binding.user_id).single();
    this.assertCurrent();
    if (profileError || profile?.id !== this.binding.user_id || profile.org_id !== this.binding.org_id) denied();
    const { data: access, error: permissionError } = await ctx.supabase.rpc("filey_module_access");
    this.assertCurrent();
    if (permissionError || !access || access.allowed !== true || typeof access.admin !== "boolean" ||
        (access.modules !== null && (!Array.isArray(access.modules) || access.modules.some((id: unknown) => typeof id !== "string")))) denied();
    if (!access.admin && access.modules !== null && modules.some(module => !access.modules.includes(module))) denied();
  }
}

/** Absent mode preserves the existing local/cloud MCP interface and lazy startup. */
export function createPilotPolicy(env: NodeJS.ProcessEnv = process.env): PilotPolicy | null {
  if (env.FILEY_MCP_MODE === undefined || env.FILEY_MCP_MODE === "standard") return null;
  if (env.FILEY_MCP_MODE !== "hermes-pilot") return denied();
  return new PilotPolicy(env);
}

export const pilotPolicy = createPilotPolicy();
export const pilotFailure = () => ({ error: GENERIC_ERROR, code: "pilot_access_denied", retry_safe: false });
