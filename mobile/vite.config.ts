import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// The mobile app is a thin shell over the desktop app's brain: everything in
// ../src/lib (api, auth, agent, formats) is imported through the @shared
// alias. The shared layer's Tauri branches are guarded by runtime checks and
// never activate here; the tauri packages are installed only so those imports
// resolve.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../src/lib"),
      "@mobile": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    // The shared agent layer is dynamic-import heavy; a single vendor split
    // keeps the Capacitor webview load simple.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Phone testing on the LAN: vite --host exposes dev to the device.
    host: true,
  },
});
