import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { AI_DEV_ORIGINS } from "./src/lib/aiEndpoint";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    chunkSizeWarningLimit: 900,
    // Let route imports determine chunks; forced vendor groups pulled shared
    // React/runtime helpers (and PDF engines) into the initial app download.

  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Native/sidecar output is not frontend source. Bun's temporary executable
      // is locked while building on Windows and would crash the Vite watcher.
      ignored: ["**/src-tauri/**", "**/tools/wa-bridge/**"],
    },
    proxy: Object.fromEntries(AI_DEV_ORIGINS.map((origin, index) => [
      `^/__filey_ai/${index}/`, {
        target: origin,
        changeOrigin: true,
        secure: true,
        followRedirects: false,
        rewrite: (path: string) => path.replace(`/__filey_ai/${index}`, ""),
      },
    ])),
  },
}));
