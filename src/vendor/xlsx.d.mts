/** Minimal surface of the vendored SheetJS build used by lib/pdfTools.
 *  The desktop toolchain tolerated the missing declaration; declaring it here
 *  makes the file usable from any sub-project (mobile) that type-checks
 *  across trees. Extend as more of the library is exercised. */
declare const XLSX: {
  read(data: unknown, opts?: unknown): unknown;
  write(wb: unknown, opts?: unknown): unknown;
  utils: Record<string, (...a: unknown[]) => unknown>;
};
export default XLSX;
