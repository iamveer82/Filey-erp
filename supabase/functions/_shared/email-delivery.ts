/** An HTTP success without a provider receipt cannot confirm acceptance. */
export function acceptedEmailId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}
