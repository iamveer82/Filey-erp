import { expect, test, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase: null }));
import { nativeAppRoute } from "./nativeLifecycle";

test("mobile links only navigate allowed destinations and never import a session", () => {
  expect(nativeAppRoute("filey://app/settings")).toBe("/settings");
  expect(nativeAppRoute("filey://app/settings?section=credits&credit_checkout=success&access_token=ignored")).toBe("/settings?section=credits&credit_checkout=success");
  expect(nativeAppRoute("filey://app/portal/1234567890abcdef")).toBe("/portal/1234567890abcdef");
  expect(nativeAppRoute("https://app.gofiley.com/#/reset-password?email=mark%40example.com&token_hash=proof&access_token=untrusted")).toBe("/reset-password?token_hash=proof&email=mark%40example.com");
  for (const link of ["javascript:alert(1)", "filey://evil/settings", "filey://user@app/settings", "filey://app:8080/settings", "https://app.gofiley.com.evil.test/#/settings", "filey://app/invoicing/delete-all", "filey://app/" + "x".repeat(8192)])
    expect(nativeAppRoute(link)).toBeNull();
});
