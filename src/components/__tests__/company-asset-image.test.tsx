import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompanyAssetImage } from "../CompanyAssetImage";
import { AGENT_STORAGE_EVENT } from "../../lib/agentStorage";
import { companyAssetUrl } from "../../lib/files";

const workspace = vi.hoisted(() => ({ scope: "cloud:org-a:user:owner-a" as string | null }));
vi.mock("../../lib/agentStorage", () => ({ AGENT_STORAGE_EVENT: "filey:agent-storage", agentStorageScope: () => workspace.scope }));
vi.mock("../../lib/files", () => ({ companyAssetUrl: vi.fn() }));

beforeEach(() => {
  workspace.scope = "cloud:org-a:user:owner-a";
  vi.mocked(companyAssetUrl).mockReset();
});
afterEach(cleanup);
const path = () => `owner-a/company/${crypto.randomUUID()}/stamp.png`;
const changeScope = (scope: string | null) => act(() => {
  workspace.scope = scope;
  window.dispatchEvent(new Event(AGENT_STORAGE_EVENT));
});

it("reuses a private URL within the same authenticated workspace without signing it again", async () => {
  const src = path(), url = "https://example.test/owner-a-signature";
  vi.mocked(companyAssetUrl).mockResolvedValueOnce(url);
  const first = render(<CompanyAssetImage src={src} alt="Signature" />);
  const firstImage = first.getByAltText("Signature");
  await waitFor(() => expect(firstImage).toHaveAttribute("src", url));
  fireEvent.load(firstImage);
  expect(firstImage).toBeVisible();
  first.unmount();
  const second = render(<CompanyAssetImage src={src} alt="Signature" />);
  expect(second.getByAltText("Signature")).toHaveAttribute("src", url);
  expect(companyAssetUrl).toHaveBeenCalledTimes(1);
});

it.each([
  ["account", "cloud:org-a:user:owner-b"],
  ["workspace", "cloud:org-b:user:owner-a"],
  ["storage mode", "local:org-a:user:owner-a"],
  ["signed-out session", null],
] as const)("does not reuse a private URL after a %s switch, even when its path is unchanged", async (_label, next) => {
  const src = path(), oldUrl = "https://example.test/private-owner-a";
  vi.mocked(companyAssetUrl).mockResolvedValueOnce(oldUrl).mockResolvedValueOnce(null);
  const host = render(<CompanyAssetImage src={src} alt="Stamp" />);
  const image = host.getByAltText("Stamp");
  await waitFor(() => expect(image).toHaveAttribute("src", oldUrl));
  fireEvent.load(image); expect(image).toBeVisible();
  changeScope(next);
  expect(image).not.toHaveAttribute("src", oldUrl);
  expect(image).not.toBeVisible();
  await waitFor(() => expect(image).toHaveAttribute("data-company-asset-status", "error"));
  expect(companyAssetUrl).toHaveBeenCalledTimes(2);
  // Returning to the original authorized session may still reuse its own URL.
  changeScope("cloud:org-a:user:owner-a");
  await waitFor(() => expect(image).toHaveAttribute("src", oldUrl));
  expect(companyAssetUrl).toHaveBeenCalledTimes(2);
});

it("discards an old session's delayed resolution before its scope notification or rerender", async () => {
  const src = path(); let resolveOld!: (url: string) => void;
  vi.mocked(companyAssetUrl).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce("https://example.test/new-owner-a-request");
  const first = render(<CompanyAssetImage src={src} alt="Stamp" />);
  await waitFor(() => expect(companyAssetUrl).toHaveBeenCalledTimes(1));
  workspace.scope = "cloud:org-a:user:owner-b";
  await act(async () => { resolveOld("https://example.test/old-delayed-token"); });
  expect(first.getByAltText("Stamp")).not.toHaveAttribute("src", "https://example.test/old-delayed-token");
  first.unmount();
  workspace.scope = "cloud:org-a:user:owner-a";
  const second = render(<CompanyAssetImage src={src} alt="Stamp" />);
  await waitFor(() => expect(second.getByAltText("Stamp")).toHaveAttribute("src", "https://example.test/new-owner-a-request"));
  expect(companyAssetUrl).toHaveBeenCalledTimes(2);
});

it("discards a delayed expired-URL retry after a scope switch and leaves no reusable old token", async () => {
  const src = path(); let resolveRetry!: (url: string) => void;
  vi.mocked(companyAssetUrl).mockResolvedValueOnce("https://example.test/expired-owner-a")
    .mockReturnValueOnce(new Promise(resolve => { resolveRetry = resolve; }))
    .mockResolvedValueOnce("https://example.test/fresh-owner-a");
  const first = render(<CompanyAssetImage src={src} alt="Signature" />);
  const image = first.getByAltText("Signature");
  await waitFor(() => expect(image).toHaveAttribute("src", "https://example.test/expired-owner-a"));
  fireEvent.error(image);
  await waitFor(() => expect(companyAssetUrl).toHaveBeenCalledTimes(2));
  workspace.scope = "cloud:org-a:user:owner-b";
  await act(async () => { resolveRetry("https://example.test/old-retry-token"); });
  expect(image).not.toHaveAttribute("src", "https://example.test/old-retry-token");
  first.unmount(); workspace.scope = "cloud:org-a:user:owner-a";
  const second = render(<CompanyAssetImage src={src} alt="Signature" />);
  await waitFor(() => expect(second.getByAltText("Signature")).toHaveAttribute("src", "https://example.test/fresh-owner-a"));
  expect(companyAssetUrl).toHaveBeenCalledTimes(3);
});

it("never keeps an anonymous signing result in the reusable authenticated cache", async () => {
  const src = path(); workspace.scope = null;
  vi.mocked(companyAssetUrl).mockResolvedValueOnce("https://example.test/unscoped-preview").mockResolvedValueOnce(null);
  const first = render(<CompanyAssetImage src={src} alt="Stamp" />);
  await waitFor(() => expect(first.getByAltText("Stamp")).toHaveAttribute("src", "https://example.test/unscoped-preview"));
  first.unmount();
  const second = render(<CompanyAssetImage src={src} alt="Stamp" />);
  expect(second.getByAltText("Stamp")).not.toHaveAttribute("src", "https://example.test/unscoped-preview");
  await waitFor(() => expect(second.getByAltText("Stamp")).toHaveAttribute("data-company-asset-status", "error"));
  expect(companyAssetUrl).toHaveBeenCalledTimes(2);
});
