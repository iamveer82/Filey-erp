import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const result = spawnSync(
  windows ? "cmd.exe" : "sh",
  windows
    ? ["/d", "/s", "/c", "gradlew.bat --no-daemon assembleDebug"]
    : ["./gradlew", "--no-daemon", "assembleDebug"],
  {
    cwd: fileURLToPath(new URL("../mobile/android/", import.meta.url)),
    stdio: "inherit",
  }
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
