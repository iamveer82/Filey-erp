import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RowActions } from "../components/RowActions";
import { storedLineAmount } from "../lib/docItems";

/** The Send dropdown once showed WhatsApp only. Every share channel the caller
 *  supplies must reach the menu, and must still fire once it is clicked — the
 *  menu renders in a portal, so a click on it lands outside the trigger's
 *  subtree and the close-on-outside-mousedown handler could eat it. */
describe("RowActions send menu", () => {
  // vitest runs without globals here, so RTL's auto-cleanup never registers.
  afterEach(cleanup);

  const openMenu = () => {
    const onSend = {
      whatsapp: vi.fn(),
      email: vi.fn(),
      sms: vi.fn(),
      copyLink: vi.fn(),
    };
    render(<RowActions onSend={onSend} />);
    fireEvent.click(screen.getByLabelText("Send"));
    return onSend;
  };

  it("lists every channel the caller passes", () => {
    openMenu();
    for (const label of ["WhatsApp", "Email", "SMS", "Copy link"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("still fires a channel that is clicked through the portal", () => {
    const onSend = openMenu();
    const email = screen.getByText("Email");
    // Real pointer order: the document mousedown lands before the click.
    fireEvent.mouseDown(email);
    fireEvent.click(email);
    expect(onSend.email).toHaveBeenCalledTimes(1);
  });

  it("closes when the click is genuinely outside", () => {
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Email")).toBeNull();
  });
});

/** Quick view printed qty × unit_price, which is only the line total for a
 *  plain line. */
describe("storedLineAmount", () => {
  it("multiplies a plain line", () => {
    expect(storedLineAmount({ qty: 10, unit_price: 25 })).toBe(250);
  });

  it("applies a per-line discount", () => {
    expect(
      storedLineAmount({ qty: 10, unit_price: 25, custom: { __disc_pct: "10" } })
    ).toBe(225);
  });

  it("honours a manual amount over qty × price", () => {
    expect(
      storedLineAmount({
        qty: 10,
        unit_price: 25,
        custom: { __calc_mode: "manual", __manual_amount: "999" },
      })
    ).toBe(999);
  });

  it("applies a discount held in a column instead of in meta (quotations)", () => {
    expect(storedLineAmount({ qty: 10, unit_price: 25, discount: 10 })).toBe(225);
  });

  it("uses a document formula column as the multiplier", () => {
    expect(
      storedLineAmount({ qty: 10, unit_price: 25, custom: { area: "3" } }, { a: "area" })
    ).toBe(75);
  });
});
