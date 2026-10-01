import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.filey.app",
  appName: "Filey",
  webDir: "dist",
  backgroundColor: "#0a0a0a",
  android: { path: "mobile/android" },
  ios: { path: "mobile/ios", contentInset: "never" },
  server: { androidScheme: "https" },
};

export default config;
