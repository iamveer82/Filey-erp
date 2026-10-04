/** A failed transport is different from an authenticated denial. This only
 * keeps an already verified, same-identity UI mounted; it never grants access. */
export class ConnectionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionUnavailableError";
  }
}

export function isTransientConnectionError(error: unknown, responseStatus?: number): boolean {
  if (error instanceof ConnectionUnavailableError) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const code = typeof value.code === "string" ? value.code : undefined;
  // Database/authentication errors carry authoritative codes, even when an
  // unavailable gateway happened to use a transient HTTP status.
  if (code && !/^(ECONNRESET|ECONNREFUSED|ENETUNREACH|ETIMEDOUT|EHOSTUNREACH)$/.test(code)) return false;
  const status = responseStatus ?? (typeof value.status === "number" ? value.status : undefined);
  if ([502, 503, 504].includes(status ?? -1)) return true;
  if (status && status !== 0) return false;
  const transportType = error instanceof TypeError || value.name === "NetworkError" ||
    value.name === "FunctionsFetchError" || value.name === "AuthRetryableFetchError" || code === "" || !!code;
  return transportType && typeof value.message === "string" &&
    /(?:failed to fetch|fetch failed|network(?:error| request failed| error)|load failed|connection (?:reset|refused)|timed out)/i.test(value.message);
}
