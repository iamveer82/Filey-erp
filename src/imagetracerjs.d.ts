declare module "imagetracerjs" {
  interface ImageTracerStatic {
    imagedataToSVG(
      imgd: ImageData,
      options?: string | Record<string, unknown>
    ): string;
    optionpresets: Record<string, Record<string, unknown>>;
  }
  const ImageTracer: ImageTracerStatic;
  export default ImageTracer;
}
