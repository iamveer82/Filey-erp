// assertEquals shim — maps the deno.land/std assert import to vitest's
// deep-equality so the same test files run under both runtimes.
import { expect } from "vitest";

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  expect(actual, msg).toEqual(expected);
}

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
