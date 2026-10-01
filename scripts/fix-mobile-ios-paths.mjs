import { readFileSync, writeFileSync } from "node:fs";

// Capacitor 7 emits Windows separators in Swift package paths.
if (process.env.CAPACITOR_PLATFORM_NAME === "ios") {
  const file = new URL("../mobile/ios/App/CapApp-SPM/Package.swift", import.meta.url);
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("\\", "/"));
}
