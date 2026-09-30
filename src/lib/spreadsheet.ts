/* SheetJS is vendored locally (src/vendor/xlsx.mjs, v0.20.3) rather than the
 * npm `xlsx` package — npm `xlsx` carries a known high-severity
 * prototype-pollution / ReDoS advisory and SheetJS ships fixes only through
 * their own distribution. Self-hosting (vs the CDN) means Excel tools work
 * OFFLINE and aren't blocked by the script-src CSP. Vite code-splits it into a
 * lazy chunk loaded on first use. */
interface XlsxLib {
  read(data: Uint8Array, opts: { type: string; [key: string]: unknown }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_csv(ws: unknown, options?: Record<string, unknown>): string;
    book_new(): unknown;
    aoa_to_sheet(rows: unknown[][]): unknown;
    book_append_sheet(wb: unknown, ws: unknown, name: string): void;
  };
  write(wb: unknown, opts: { type: string; bookType: string }): ArrayBuffer;
}
let xlsxPromise: Promise<XlsxLib> | null = null;
export function loadXlsx(): Promise<XlsxLib> {
  return (xlsxPromise ??= import("../vendor/xlsx.mjs") as unknown as Promise<XlsxLib>);
}
