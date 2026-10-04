import { expect, it } from "vitest";
import { ConnectionUnavailableError, isTransientConnectionError } from "../connectionError";

it.each([
  new TypeError("Failed to fetch"),
  { code: "", message: "TypeError: Failed to fetch" },
  { name: "NetworkError", message: "Network request failed" },
  { name: "FunctionsFetchError", message: "Failed to fetch the edge function" },
  { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 },
  { code: "ECONNRESET", message: "Connection reset" },
  new ConnectionUnavailableError("Connection unavailable"),
])("recognizes typed transport failures (%j)", error => {
  expect(isTransientConnectionError(error)).toBe(true);
});

it.each([
  new Error("Failed to fetch"), new Error("offline"), new TypeError("Invalid member data"),
  { code: "42501", message: "permission denied", status: 503 },
  { code: "PGRST301", message: "JWT expired" },
  { status: 403, name: "NetworkError", message: "Failed to fetch" },
  { name: "AuthRetryableFetchError", message: "Invalid server response", status: 0 },
  { message: "Membership missing" }, null,
])("does not treat unknown/authentication/validation failures as transport outages (%j)", error => {
  expect(isTransientConnectionError(error)).toBe(false);
});

it.each([502, 503, 504])("recognizes unavailable gateway status %d without overriding SQL denials", status => {
  expect(isTransientConnectionError({ message: "Gateway unavailable" }, status)).toBe(true);
  expect(isTransientConnectionError({ code: "42501", message: "Denied" }, status)).toBe(false);
});
