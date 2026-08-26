/// UTIF ships as an untyped JS file. The desktop toolchain tolerated the
/// missing declaration; mobile type-checks the shared tree and needs it.
declare module "utif" {
  const UTIF: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    decode(buf: unknown): any[];
    decodeImage(buf: unknown, ifd: any): void;
    toRGBA8(ifd: any): Uint8Array;
    encodeImage(rgba: unknown, w: number, h: number, metadata?: unknown): ArrayBuffer;
    [k: string]: unknown;
  };
  export default UTIF;
}
