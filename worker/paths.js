/** Storage download URLs normalize dot segments before the service-role request.
 * Check the complete object key, not just its owner prefix, before building one.
 * Percent escapes are rejected as well: encoded separators/dots can be decoded
 * by the URL parser or storage server into a different owner's path. */
export function ownedInputPath(owner, inputPath) {
  if (typeof owner !== "string" || typeof inputPath !== "string" ||
      /[%\\?#\u0000-\u001f\u007f]/.test(inputPath)) {
    throw new Error("Invalid input storage path.");
  }
  const parts = inputPath.split("/");
  if (parts.length < 2 || parts[0] !== owner ||
      parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("input_path does not belong to the job owner.");
  }
  return inputPath;
}
