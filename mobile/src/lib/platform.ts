/**
 * Platform surface for the mobile shell. Capacitor's WebView satisfies the
 * shared layer's browser assumptions; native bridges are added here as the
 * app grows (share, haptics, push). Everything degrades to plain web.
 */
export const isNative = (): boolean =>
  typeof window !== "undefined" &&
  // @ts-expect-error Capacitor global
  !!window.Capacitor?.isNativePlatform?.();

/** The desktop app's Tauri layer is never present on mobile — the shared lib
 *  checks this exact string, so desktop-only features (WhatsApp bridge sidecar,
 *  native file dialogs) report themselves honestly as unavailable. */
export const hasDesktopBridge = (): boolean => false;
