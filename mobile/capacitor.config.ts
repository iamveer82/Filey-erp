import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Filey mobile. The webDir is the Vite build of this folder; `npm run cap:sync`
 * copies it into the native projects. appId mirrors the desktop updater's
 * bundle so a shared identity is possible later.
 */
const config: CapacitorConfig = {
  appId: "com.filey.app",
  appName: "Filey",
  webDir: "dist",
  backgroundColor: "#0a0a0a",
  ios: {
    contentInset: "always",
    scrollEnabled: true,
  },
  server: {
    // Live reload on device: `npm run dev -- --host`, then set lan() here.
    // androidScheme https keeps storage/cookies consistent with production.
    androidScheme: "https",
  },
};

export default config;
