// assertEquals shim — maps the deno.land/std assert import to vitest's
// deep-equality so the same test files run under both runtimes.
import { expect } from "vitest";

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  expect(actual, msg).toEqual(expected);
}

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  expect(String(actual), msg).toContain(expected);
}

/** std's assertRejects: runs `fn`, requires a rejection, and hands it back so
 *  the caller can make further assertions about the error it got. */
export async function assertRejects(
  fn: () => Promise<unknown>,
  // deno-lint-ignore no-explicit-any
  ErrorClass?: new (...args: any[]) => Error,
  msgIncludes?: string,
  msg?: string,
): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (ErrorClass) expect(err, msg).toBeInstanceOf(ErrorClass);
    if (msgIncludes) expect(err.message, msg).toContain(msgIncludes);
    return err;
  }
  throw new Error(msg ?? "Expected the call to reject, but it resolved.");
}
