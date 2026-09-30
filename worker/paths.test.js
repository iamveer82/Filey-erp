import assert from "node:assert/strict";
import test from "node:test";
import { ownedInputPath } from "./paths.js";

const owner = "11111111-1111-4111-8111-111111111111";
const victim = "22222222-2222-4222-8222-222222222222";

test("rejects paths that a service-role download would normalize outside the owner", () => {
  const traversal = `${owner}/../${victim}/private.pdf`;
  assert.ok(traversal.startsWith(`${owner}/`), "the old prefix check accepts it");
  assert.equal(
    new Request(`https://storage.example.test/storage/v1/object/tool-inputs/${traversal}`).url,
    `https://storage.example.test/storage/v1/object/tool-inputs/${victim}/private.pdf`,
  );
  for (const path of [
    traversal,
    `${owner}/%2e%2e/${victim}/private.pdf`,
    `${owner}/.%2e/${victim}/private.pdf`,
    `${owner}/%252e%252e/${victim}/private.pdf`,
    `${owner}\\..\\${victim}\\private.pdf`,
    `${owner}/%2f../${victim}/private.pdf`,
    `${owner}/folder/../../${victim}/private.pdf`,
    `${owner}/./input.pdf`,
    `${owner}//input.pdf`,
    `${owner}/input.pdf?download=${victim}`,
    `${owner}/input.pdf#fragment`,
    `${owner}/input\n.pdf`,
    `${victim}/input.pdf`,
    `${owner}/`,
    owner,
    null,
    {},
  ]) {
    assert.throws(() => ownedInputPath(owner, path), /input|storage path/);
  }
});

test("accepts unchanged object keys under the job owner's folder", () => {
  for (const path of [`${owner}/1700000000_invoice.pdf`, `${owner}/folder/input.docx`, `${owner}/tax invoice.pdf`]) {
    assert.equal(ownedInputPath(owner, path), path);
    assert.ok(new Request(`https://storage.example.test/storage/v1/object/tool-inputs/${path}`).url
      .includes(`/tool-inputs/${owner}/`));
  }
});
