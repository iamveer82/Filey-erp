import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";

const fixture = vi.hoisted(() => ({
  scope: "cloud:org:user:alice" as string | null,
  allowed: true, loading: false, error: "", currency: "AED",
  currencyListeners: new Set<() => void>(),
  mounted: vi.fn(), unmounted: vi.fn(), businessMounted: vi.fn(), stop: vi.fn(),
  finish: undefined as undefined | (() => void),
}));
vi.mock("../../lib/agentStorage", () => ({
  AGENT_STORAGE_EVENT: "filey:agent-storage", agentStorageScope: () => fixture.scope,
}));
vi.mock("../../lib/modules", () => ({ useModules: () => ({
  loading: fixture.loading, error: fixture.error, isEnabled: () => fixture.allowed,
  modules: [{ id: "agent", label: "Filey AI", to: "/agent" }], enabledModules: () => [],
}) }));
vi.mock("../../lib/auth", () => ({ useAuth: () => ({ profile: { name: "Alice", email: "alice@example.test" }, signOut: async () => {} }) }));
vi.mock("../../lib/api", () => ({
  billing: { getCompany: async () => ({ currency: "AED" }) },
  followups: { due: async () => [] }, notifs: { list: async () => [] },
}));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../lib/spotlight", () => ({ useGlobalSearch: () => [], useNotifications: () => [] }));
vi.mock("../../lib/smoothScroll", () => ({ attachSmoothScroll: () => () => {} }));
vi.mock("../../lib/ui", () => ({ useUI: () => ({ toast: {} }) }));
vi.mock("../../lib/dataMode", () => ({ isLocalMode: () => false }));
vi.mock("../../lib/nativePlatform", () => ({ isNativeApp: () => false }));
vi.mock("../../lib/useSidebarSwipe", () => ({ useSidebarSwipe: () => {} }));
vi.mock("../../lib/i18n", () => ({ LANGS: {}, useLang: () => ({ lang: "en", t: (value: string) => value, setLang: () => {} }) }));
vi.mock("../../lib/displayCurrency", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    initDisplayCurrency: async () => {},
    useDisplayCurrency: () => ({
      currency: useSyncExternalStore(callback => {
        fixture.currencyListeners.add(callback);
        return () => { fixture.currencyListeners.delete(callback); };
      }, () => fixture.currency),
      setCurrency: () => {},
    }),
  };
});
vi.mock("../WorkspaceNavigation", () => ({ default: () => null }));
vi.mock("../BrowserPanel", () => ({ default: () => null }));
vi.mock("../AnimatedThemeToggler", () => ({ default: () => null }));
vi.mock("../../pages/AgentChat", async () => {
  const { useEffect, useState } = await import("react");
  return { default: function AgentFixture({ active, onStatusChange }: { active: boolean; onStatusChange: (value: unknown) => void }) {
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [approvalPending, setApprovalPending] = useState(false);
    const [reply, setReply] = useState("");
    useEffect(() => { fixture.mounted(); return () => { fixture.unmounted(); }; }, []);
    useEffect(() => { onStatusChange({ busy, approvalPending, stop: fixture.stop }); }, [busy, approvalPending, onStatusChange]);
    fixture.finish = () => { setBusy(false); setReply("Generated task finished."); };
    return <section aria-label="Generated chat fixture" data-active={active}>
      <input aria-label="Generated draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={() => setBusy(true)}>Start generated task</button>
      <button onClick={() => { setBusy(true); setApprovalPending(true); }}>Request generated approval</button>
      <p>{reply}</p>
    </section>;
  } };
});

import Layout from "../Layout";
import PersistentAgentChat from "../PersistentAgentChat";

function RoutedBusinessPage() {
  const location = useLocation();
  return location.pathname === "/agent" ? null : <BusinessPage />;
}
function BusinessPage() {
  const location = useLocation();
  // Existing business forms must still remount on route/currency changes.
  // The AI fixture is deliberately above that same real Layout boundary.
  useEffect(() => { fixture.businessMounted(); }, []);
  return <p>{location.pathname} business page</p>;
}
function Harness() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate("/agent")}>Open AI section</button>
    <button onClick={() => navigate("/customers")}>Open customers section</button>
    <Layout persistentContent={<PersistentAgentChat />}><RoutedBusinessPage /></Layout>
  </>;
}
function open(initial = "/customers") {
  return render(<MemoryRouter initialEntries={[initial]}><Harness /></MemoryRouter>);
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  fixture.scope = "cloud:org:user:alice";
  fixture.allowed = true; fixture.loading = false; fixture.error = ""; fixture.currency = "AED";
  fixture.finish = undefined;
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("mounts AI only on its first visit and retains its draft/task while section and display currency change", async () => {
  const { container } = open();
  expect(fixture.mounted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open AI section" }));
  const draft = await screen.findByRole("textbox", { name: "Generated draft" });
  fireEvent.change(draft, { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Start generated task" }));
  fireEvent.click(screen.getByRole("button", { name: "Open customers section" }));
  expect(screen.getByRole("status")).toHaveTextContent("Filey AI is continuing your task.");
  expect(screen.queryByRole("textbox", { name: "Generated draft" })).not.toBeInTheDocument();
  const hiddenChat = container.querySelector('[aria-hidden="true"][inert]')!;
  expect(hiddenChat).toHaveAttribute("hidden");
  await act(async () => { fixture.currency = "USD"; fixture.currencyListeners.forEach(changed => changed()); });
  expect(fixture.businessMounted).toHaveBeenCalledTimes(3);
  await act(async () => { fixture.finish?.(); });
  expect(screen.queryByRole("complementary", { name: "Filey AI task" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open AI section" }));
  expect(screen.getByRole("textbox", { name: "Generated draft" })).toBe(draft);
  expect(draft).toHaveValue("Keep my draft");
  expect(screen.getByText("Generated task finished.")).toBeVisible();
  expect(fixture.mounted).toHaveBeenCalledOnce();
  expect(fixture.unmounted).not.toHaveBeenCalled();
});

it("keeps approval pending off-route with an accessible return link and explicit Stop", async () => {
  open("/agent");
  fireEvent.click(await screen.findByRole("button", { name: "Request generated approval" }));
  fireEvent.click(screen.getByRole("button", { name: "Open customers section" }));
  expect(screen.getByRole("status")).toHaveTextContent("Filey AI needs your approval.");
  fireEvent.click(screen.getByRole("button", { name: "Stop Filey AI task" }));
  expect(fixture.stop).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("link", { name: "Return to chat" }));
  expect(screen.getByRole("textbox", { name: "Generated draft" })).toBeVisible();
  expect(fixture.mounted).toHaveBeenCalledOnce();
});

it.each(["denied", "loading", "error"])("releases the mounted task when access is %s", async reason => {
  const view = open("/agent");
  await screen.findByRole("textbox", { name: "Generated draft" });
  fixture.allowed = reason !== "denied";
  fixture.loading = reason === "loading";
  fixture.error = reason === "error" ? "Permissions unavailable" : "";
  view.rerender(<MemoryRouter initialEntries={["/agent"]}><Harness /></MemoryRouter>);
  expect(fixture.unmounted).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox", { name: "Generated draft" })).not.toBeInTheDocument();
});

it("releases an off-route private chat on workspace transition and requires a new visit in the next scope", async () => {
  open("/agent");
  fireEvent.change(await screen.findByRole("textbox", { name: "Generated draft" }), { target: { value: "Alice private draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Start generated task" }));
  fireEvent.click(screen.getByRole("button", { name: "Open customers section" }));
  act(() => { fixture.scope = null; window.dispatchEvent(new Event("filey:workspace-transition")); });
  expect(fixture.unmounted).toHaveBeenCalledOnce();
  expect(screen.queryByRole("complementary", { name: "Filey AI task" })).not.toBeInTheDocument();
  act(() => { fixture.scope = "cloud:other-org:user:bob"; window.dispatchEvent(new Event("filey:agent-storage")); });
  expect(fixture.mounted).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Open AI section" }));
  await waitFor(() => expect(fixture.mounted).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("textbox", { name: "Generated draft" })).toHaveValue("");
});
