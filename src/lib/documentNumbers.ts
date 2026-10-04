import { getCacheOrg, getCacheScope } from "./api";
import { requireAgentStorageScope } from "./agentStorage";
import { isLocalMode } from "./dataMode";
import { nextFromPattern } from "./docNumber";
import { withLocalTransaction } from "./localdb";
import { DOC_NUMBER_KINDS, type DocFormats, type DocNumberKind } from "./numberFormat";
import { sb } from "./supabase";

const shapes: Record<DocNumberKind, [string, string, string]> = {
  invoice: ["invoice_docs", "number", "invoice"],
  purchase_invoice: ["invoice_docs", "number", "invoice"],
  quote: ["quotations", "number", "quote"],
  purchase_order: ["purchase_orders", "po_number", "purchase_order"],
  sales_order: ["orders", "order_number", "sales_order"],
  payment_receipt: ["payment_receipts", "number", "payment_receipt"],
  letter: ["app_settings", "letters", "letter"],
  packaging_list: ["app_settings", "packaging_lists", "packaging_list"],
  delivery_challan: ["app_settings", "delivery_challans", "delivery_challan"],
  declaration_letter: ["app_settings", "declaration_letters", "declaration_letter"],
};

/** Allocate, rather than predict, a number. Unused reservations leave harmless
 * gaps; numbers are never recycled after a draft is abandoned or deleted. */
export async function allocateDocumentNumber(
  kind: DocNumberKind,
  existing: string[] = [],
  formats: DocFormats = {},
  requestId = crypto.randomUUID(),
): Promise<string> {
  const scope = requireAgentStorageScope();
  const account = getCacheScope(), org = getCacheOrg();
  const actor = account?.slice(account.lastIndexOf(":user:") + 6);
  const spec = DOC_NUMBER_KINDS.find(item => item.kind === kind);
  if (!spec || !account || !org) throw new Error("Select your workspace before creating a document.");
  const year = new Date().getFullYear();
  const pattern = formats[kind] && /\{\d+\}/.test(formats[kind]!)
    ? formats[kind]! : `${spec.prefix}-{YYYY}-{0001}`;
  const tokens = pattern.match(/\{\d+\}/g);
  if (pattern.length > 120 || Array.from(pattern).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || tokens?.length !== 1 || tokens[0].length > 14 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new Error("Use a number format with one counter, for example INV-{YYYY}-{0001}.");
  const current = () => { requireAgentStorageScope(scope); };
  if (!isLocalMode()) {
    const client = sb();
    const { data: session, error: sessionError } = await client.auth.getSession();
    current();
    if (sessionError || !session.session || !account.endsWith(`:user:${session.session.user.id}`))
      throw new Error("Your account changed. Reopen the document.");
    const { data, error } = await client.rpc("filey_reserve_document_number", {
      p_kind: kind, p_pattern: pattern, p_year: year, p_request: requestId,
      p_actor: session.session.user.id, p_org: org,
    }).setHeader("Authorization", `Bearer ${session.session.access_token}`);
    current();
    if (error) throw error;
    if (typeof data !== "string" || !data.trim()) throw new Error("A document number could not be reserved. Retry creating the document.");
    return data;
  }
  return withLocalTransaction(async client => {
    current();
    const [table, field, namespace] = shapes[kind];
    const held = await client.from("document_number_reservations").select("*");
    if (held.error) throw held.error;
    const reservations = (held.data ?? []).filter((row: any) => row.namespace === namespace &&
      (row.org_id === org || (!row.org_id && row.scope === account)));
    const replay = reservations.find((row: any) => row.request_id === requestId);
    if (replay) {
      if (replay.pattern !== pattern || replay.year !== year || (replay.user_id && replay.user_id !== actor)) throw new Error("This number request changed. Start a new document.");
      return replay.number as string;
    }
    const rows = await client.from(table).select("*");
    if (rows.error) throw rows.error;
    const numbers = [...existing, ...reservations.map((row: any) => String(row.number))];
    for (const row of rows.data ?? []) {
      if (row.org_id && row.org_id !== org) continue;
      if (table !== "app_settings") { if (typeof row[field] === "string") numbers.push(row[field]); continue; }
      if (row.key !== field) continue;
      const records: unknown = JSON.parse(row.value);
      if (!Array.isArray(records)) throw new Error("Saved document numbers could not be read. Original records were preserved.");
      for (const record of records) {
        const number = record?.form?.number ?? record?.number ?? record?.ref;
        if (typeof number === "string") numbers.push(number);
      }
    }
    const number = nextFromPattern({ pattern, existing: numbers, year });
    if (numbers.some(value => value.trim().toLowerCase() === number.trim().toLowerCase()))
      throw new Error("This number format cannot allocate a unique number. Change the format.");
    current();
    const saved = await client.from("document_number_reservations").insert({
      request_id: requestId, scope: account, org_id: org, user_id: actor, namespace, pattern, year, number,
    });
    if (saved.error) throw saved.error;
    current();
    return number;
  }, { retrySafe: true });
}
