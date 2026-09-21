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
console.log("Release recovery preserves existing assets and builds Intel from the original tag.");
