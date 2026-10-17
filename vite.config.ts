import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { AI_DEV_ORIGINS } from "./src/lib/aiEndpoint";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const desktopBuild = !!process.env.TAURI_ENV_PLATFORM;

// https://vite.dev/config/
export default defineConfig(async ({ command }) => ({
  plugins: [react(), ...(command === "serve" ? [{
    name: "filey-development-script-hashes",
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string) {
        // Vite's trusted refresh preamble is inline in development. Allow its
        // exact bytes, while keeping arbitrary inline scripts/eval blocked.
        const hashes = [...html.replace(/\r\n?/g, "\n").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
          .filter((match) => !/\bsrc\s*=/i.test(match[1]) && match[2].trim())
          .map((match) => `'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
        return html.replace(/(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^";]*; script-src)([^;]*)(;)/i,
          (_match, prefix, allowed, end) => `${prefix}${allowed} ${hashes.join(" ")}${end}`);
      },
    },
  }] : []), {
    // Office work apps (public/wordcraft, gridcraft, pdfcraft: 30-80 MB each) are desktop-only for now;
    // web and mobile builds leave them out.
    name: "filey-desktop-only-office",
    apply: "build" as const,
    closeBundle() { if (!desktopBuild) for (const app of ["wordcraft", "gridcraft", "pdfcraft"]) rmSync(`dist/${app}`, { recursive: true, force: true }); },
  }, {
    // Pre-installed agent skills run their Python helpers in Pyodide (skillScripts.worker.ts), whose
    // runtime is served from /pyodide/ and only downloaded the first time a script runs.
    name: "filey-pyodide-runtime",
    // config, not buildStart: the dev server lists public/ before buildStart runs.
    config() {
      mkdirSync("public/pyodide", { recursive: true });
      for (const file of ["pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"])
        copyFileSync(`node_modules/pyodide/${file}`, `public/pyodide/${file}`);
    },
  }],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

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
