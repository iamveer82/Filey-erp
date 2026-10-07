import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
const guard = workflow.jobs.build.steps.find(step => step.name === "Validate Intel recovery target");
const code = guard.run.match(/node -e '([^']+)'/)[1];
function accepts(isDraft, names) {
  let rejected = false;
  runInNewContext(code, {
    require: () => ({ isDraft, assets: names.map(name => ({ name })) }),
    process: { exit: () => { rejected = true; } },
  });
  return !rejected;
}

assert.equal(accepts(true, ["latest.json", "Filey.ERP_aarch64.app.tar.gz", "Filey.ERP_3.0.0_x64-setup.exe"]), true);
assert.equal(accepts(false, []), false, "Published releases must never be recovered");
for (const asset of ["Filey.ERP_3.0.0_x64.dmg", "Filey.ERP_x64.app.tar.gz", "Filey.ERP_x64.app.tar.gz.sig"]) {
  assert.equal(accepts(true, [asset]), false, `Existing Intel asset must not be replaced: ${asset}`);
}
const matrices = [...workflow.jobs.build.strategy.matrix.include.matchAll(/'([[][^']+])'/g)].map(match => JSON.parse(match[1]));
assert.equal(matrices[0].length, 1, "Recovery must build one platform only");
assert.equal(matrices[0][0].rust_target, "x86_64-apple-darwin");
assert.equal(matrices[1].length, 4, "Normal releases must retain all platforms");
assert.equal(workflow.jobs.build.steps.find(step => step.uses === "actions/checkout@v4").with.ref, "${{ inputs.intel_recovery_tag || github.ref }}");
const versionGuard = workflow.jobs.build.steps.find(step => step.name === "Check release version");
assert.equal(versionGuard.if, "github.ref_type == 'tag' || inputs.intel_recovery_tag != ''");
assert.equal(versionGuard.env.TAG, "${{ inputs.intel_recovery_tag || github.ref_name }}");
function checkVersion(tag, versions = {}) {
  const version = "3.0.10";
  const files = new Map([
    ["package.json", JSON.stringify({ version: versions.package ?? version })],
    ["package-lock.json", JSON.stringify({ version: versions.lock ?? version, packages: { "": { version: versions.lockRoot ?? version } } })],
    ["src-tauri/tauri.conf.json", JSON.stringify({ version: versions.tauri ?? version })],
    ["src-tauri/Cargo.toml", `[package]\nname = "filey-erp"\nversion = "${versions.cargo ?? version}"\n`],
    ["src-tauri/Cargo.lock", `[[package]]\nname = "filey-erp"\nversion = "${versions.cargoLock ?? version}"\n`],
  ]);
  runInNewContext(versionGuard.run.match(/node -e '([^']+)'/)[1], {
    require: () => ({ readFileSync: path => files.get(path) }),
    process: { env: { TAG: tag } },
  });
}
assert.doesNotThrow(() => checkVersion("v3.0.10"));
for (const field of ["package", "lock", "lockRoot", "tauri", "cargo", "cargoLock"]) {
  assert.throws(() => checkVersion("v3.0.10", { [field]: "3.0.9" }), /Release tag does not match/, `Reject stale ${field} version metadata`);
}
assert.throws(() => checkVersion("v3.00.01"), /Release tag does not match/);

const draftGuard = workflow.jobs.build.steps.find(step => step.name === "Check release draft state");
assert.equal(draftGuard.if, versionGuard.if);
assert.match(draftGuard.run, /set -euo pipefail[\s\S]*gh api --paginate --slurp/, "Unexpected API errors must stop before packaging");
function checkDraftState(releases) {
  runInNewContext(draftGuard.run.match(/node -e '([^']+)'/)[1], {
    require: () => releases,
    process: { env: { TAG: "v3.0.10" } },
  });
}
assert.doesNotThrow(() => checkDraftState([[]]));
assert.doesNotThrow(() => checkDraftState([[{ tag_name: "v3.0.9", draft: false }], [{ tag_name: "v3.0.10", draft: true }]]));
assert.throws(() => checkDraftState([[], [{ tag_name: "v3.0.10", draft: false }]]), /Published releases must not be rebuilt/);

const verifyJob = workflow.jobs["verify-release-assets"];
assert.equal(verifyJob.needs, "build", "Sanitize only after every platform finishes merging latest.json");
const protect = verifyJob.steps.find(step => step.name === "Protect legacy Linux updaters");
const manifestGuard = protect.run.match(/node -e '([^']+)'/)[1];
function sanitizeManifest(manifest, isDraft = true) {
  const files = new Map([
    ["release.json", JSON.stringify({ isDraft })],
    ["updater/latest.json", JSON.stringify(manifest)],
  ]);
  runInNewContext(manifestGuard, {
    require: () => ({ readFileSync: path => files.get(path), writeFileSync: (path, content) => files.set(path, content) }),
  });
  return { manifest: JSON.parse(files.get("updater/latest.json")), changed: files.has("updater/changed") };
}
const manifest = {
  version: "3.0.10", notes: "Release notes", platforms: {
    "linux-x86_64": { url: "https://example.com/filey.deb", signature: "deb-signature" },
    "linux-x86_64-deb": { url: "https://example.com/filey.deb", signature: "deb-signature" },
    "linux-x86_64-rpm": { url: "https://example.com/filey.rpm", signature: "rpm-signature" },
    "darwin-aarch64": { url: "https://example.com/filey.app.tar.gz", signature: "mac-signature" },
  },
};
const safe = sanitizeManifest(manifest);
const expected = structuredClone(manifest);
delete expected.platforms["linux-x86_64"];
assert.deepEqual(safe.manifest, expected, "Remove the AppImage fallback while preserving every explicit package target and signature");
assert.equal(safe.changed, true);
assert.equal(sanitizeManifest(safe.manifest).changed, false, "Do not replace an unchanged manifest");
assert.throws(() => sanitizeManifest(manifest, false), /Published release assets must not be replaced/);
assert.match(protect.run, /if \[ -f updater\/changed \]; then/, "Only changed drafts should be uploaded");
assert.match(workflow.jobs.build.steps.find(step => step.name === "Upload installers as workflow artifacts").with.path, /\*\*\/\*\.app\.tar\.gz/);
const bridgeBuild = workflow.jobs.build.steps.find(step => step.name === "Build WhatsApp bridge sidecar").run;
assert.match(bridgeBuild, /set -euo pipefail/, "A failed native media check must stop packaging");
assert.match(bridgeBuild, /bun build-sidecar\.mjs --outfile "\$HOST_BIN"/, "Host builds must include sharp's native addon and libvips");
assert.match(bridgeBuild, /"\$HOST_BIN" --check-media --media-dir "\$MEDIA_DIR"/, "Exercise native media from the compiled host binary before packaging");
assert.match(bridgeBuild, /bun build-sidecar\.mjs --target "\$\{\{ matrix\.bun_target \}\}"/, "Cross builds must select the target's native media");
assert.doesNotMatch(bridgeBuild, /bun build --compile/, "Plain Bun compilation omits sharp's external native files");
const tauri = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
assert.equal(tauri.bundle.resources["binaries/wa-media/"], "wa-media/", "Preserve native addon/libvips directories at the runtime resource path; a glob would flatten them");
for (const filename of ["build.ps1", "build-nosign.ps1"]) {
  const script = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
  assert.match(script, /\$PSScriptRoot/, "Local builds must use their checkout rather than the primary workspace");
  assert.match(script, /bun build-sidecar\.mjs/, "Local desktop builds need the same native media builder");
  assert.match(script, /--check-media --media-dir/, "Local desktop builds must exercise the compiled native media before bundling");
  assert.doesNotMatch(script, /bun build --compile/);
}
// Frontend storage mocks cannot catch an unknown native IPC command.
const deviceStorage = readFileSync(new URL("../src/lib/deviceStorage.ts", import.meta.url), "utf8");
const nativeHandler = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const nativeCache = readFileSync(new URL("../src-tauri/src/modules/sync.rs", import.meta.url), "utf8");
const cacheCommands = [...new Set([...deviceStorage.matchAll(/invoke(?:<[^()]*>)?\(\s*"(cache_[a-z_]+)"/g)].map(match => match[1]))];
assert.ok(cacheCommands.includes("cache_compare_set_many"), "Cover the durable local save command");
for (const command of cacheCommands) {
  assert.ok(nativeHandler.includes(`modules::sync::${command},`), `Native cache command is not registered: ${command}`);
  assert.match(nativeCache, new RegExp(`pub async fn ${command}\\b`), `Native cache command is not implemented: ${command}`);
}
console.log("Release guards preserve safe recovery, version checks, updater targets, native cache commands and compiled media packaging.");
