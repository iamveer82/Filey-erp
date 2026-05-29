declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    [key: string]: unknown;
  }
  const UTIF: {
    decode(buffer: ArrayBuffer | Uint8Array): IFD[];
    decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array;
    encodeImage(rgba: ArrayBuffer | Uint8Array, w: number, h: number): ArrayBuffer;
  };
  export default UTIF;
}
