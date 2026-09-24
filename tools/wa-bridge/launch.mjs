import path from "node:path";
import { parseArgs } from "node:util";

/** Explicit arguments survive desktop launchers that omit environment variables. */
export function bridgeLaunch(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "state-dir": { type: "string" },
    "owner-number": { type: "string" },
  } });
  if (values["state-dir"] !== undefined && (!values["state-dir"].trim() || !path.isAbsolute(values["state-dir"])))
    throw new Error("WhatsApp pairing directory must be an absolute path.");
  return {
    stateDir: values["state-dir"] ?? (env.FILEY_BRIDGE_STATE || path.join(process.cwd(), "auth")),
    // An explicit empty owner switches to self-chat even if an old env value exists.
    ownerNumber: values["owner-number"] ?? env.FILEY_BRIDGE_OWNER ?? "",
  };
}
