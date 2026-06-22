// Vendored SheetJS (xlsx.mjs) has no bundled types. The single consumer in
// pdfTools casts the dynamic import to its own XlsxLib interface, so a minimal
// module declaration to satisfy resolution is all that's needed here.
declare module "*/vendor/xlsx.mjs" {
  const xlsx: unknown;
  export default xlsx;
}
