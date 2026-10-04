/** Billing is a public endpoint; never buffer an unlimited checkout/webhook body. */
export class BillingRequestError extends Error {
  constructor() {
    super("The billing request is too large.");
  }
}

export async function readBillingBody(req: Request, limit: number): Promise<string> {
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new BillingRequestError();
  const reader = req.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let raw = "", bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        try { await reader.cancel(); } catch { /* Reject even if stream cleanup fails. */ }
        throw new BillingRequestError();
      }
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
