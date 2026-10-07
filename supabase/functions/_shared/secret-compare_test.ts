import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { secretMatches } from "./secret-compare.ts";

Deno.test("secretMatches accepts only the exact configured secret", async () => {
  assertEquals(await secretMatches("s3cret", "s3cret"), true);
  assertEquals(await secretMatches("s3cret!", "s3cret"), false);
  assertEquals(await secretMatches("s3cre", "s3cret"), false);
  assertEquals(await secretMatches("", "s3cret"), false);
  assertEquals(await secretMatches(null, "s3cret"), false);
  assertEquals(await secretMatches(undefined, "s3cret"), false);
});

Deno.test("secretMatches fails closed when no secret is configured", async () => {
  assertEquals(await secretMatches("", ""), false);
  assertEquals(await secretMatches("anything", ""), false);
});
