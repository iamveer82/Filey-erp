export const EMAIL_WORKSPACE_CHANGED = "Your workspace changed. Review the email again before sending.";

/** Older clients omit this intent. Provided intent must identify one workspace. */
export function validEmailWorkspaceIntent(expected: unknown): boolean {
  return expected === undefined || (typeof expected === "string" && expected.length > 0
    // eslint-disable-next-line no-control-regex -- Intentionally reject control bytes in a workspace identifier.
    && expected.length <= 255 && expected === expected.trim() && !/[\u0000-\u001f\u007f]/.test(expected));
}

/** Authenticated accounts without a selected cloud organization use default. */
export function emailWorkspaceMatches(expected: unknown, current: string | null | undefined): boolean {
  return validEmailWorkspaceIntent(expected) && (expected === undefined || expected === (current || "default"));
}
