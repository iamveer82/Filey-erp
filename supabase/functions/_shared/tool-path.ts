/** Storage SDK requests normalize URL dot segments. Prefix checks alone allow
 *  OWNER/../VICTIM/file.pdf to escape the caller's storage folder. */
/* eslint-disable no-control-regex -- Reject control characters at the storage-path boundary. */
export function ownedToolPath(path: unknown, ownerId: string): path is string {
  if (typeof path !== "string" || !ownerId || path.length > 1024 || /[\\%?#\u0000-\u001f\u007f]/.test(path)) return false;
  const segments = path.split("/");
  return segments.length >= 2 && segments[0] === ownerId &&
    segments.every(segment => segment !== "" && segment !== "." && segment !== "..");
}

export const toolFilename = (name: string) =>
  name.replace(/[\\/%?#\u0000-\u001f\u007f]/g, "_").slice(0, 160) || "document";
