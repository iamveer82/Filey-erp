// ProfileSetup is the FIRST screen a brand-new account sees, and it calls
// useNavigate() at the top level. It used to be returned by Gate() above the
// <HashRouter>, so signing in with a new account crashed the whole app with
// "useNavigate() may be used only in the context of a <Router>" before the
// form could render. Anything Gate can return before the routed shell must
// survive being mounted with router hooks in it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProfileSetup from "../pages/ProfileSetup";

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ createProfile: vi.fn() }),
}));

afterEach(cleanup);

describe("ProfileSetup outside a routed shell", () => {
  it("throws without a Router — the crash a new account used to hit", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ProfileSetup />)).toThrow(/useNavigate|Router/i);
    quiet.mockRestore();
  });

  it("renders once a Router is present, which is how App now mounts Gate", async () => {
    const { MemoryRouter } = await import("react-router-dom");
    render(
      <MemoryRouter>
        <ProfileSetup />
      </MemoryRouter>
    );
    // The form is on screen rather than an error boundary.
    expect(screen.getByText(/first/i)).toBeTruthy();
  });
});
