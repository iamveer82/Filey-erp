#!/usr/bin/env node
/* Launch the Filey Agent terminal CLI from a checkout.
 *
 * The desktop app runs this same Python agent as its sidecar; this is the
 * front door for running it yourself in a terminal, with its full shell,
 * file, browser and Filey tool surface. Any `filey` subcommand passes through.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const venv = process.platform === "win32"
  ? join(root, "agent", ".venv", "Scripts", "filey.exe")
  : join(root, "agent", ".venv", "bin", "filey");
const args = process.argv.slice(2);
const [command, commandArgs] = existsSync(venv)
  ? [venv, args]
  : [process.platform === "win32" ? "python" : "python3", [join(root, "agent", "cli.py"), ...args]];

const child = spawn(command, commandArgs, { stdio: "inherit", cwd: root });
child.on("error", (error) => {
  console.error(`Could not start the Filey Agent: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
