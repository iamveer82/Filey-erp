import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Markdown from "../Markdown";

describe("Markdown", () => {
  it("renders bold, italic and inline code as elements, not punctuation", () => {
    const { container } = render(
      <Markdown text="Total is **AED 1,200** and *due* today, ref `INV-9`." />
    );
    expect(container.querySelector("strong")?.textContent).toBe("AED 1,200");
    expect(container.querySelector("em")?.textContent).toBe("due");
    expect(container.querySelector("code")?.textContent).toBe("INV-9");
    expect(container.textContent).not.toContain("**");
  });

  it("renders bullet and numbered lists", () => {
    const { container } = render(
      <Markdown text={"- one\n- two\n\n1. first\n2. second"} />
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("keeps fenced code verbatim, markers and all", () => {
    const { container } = render(
      <Markdown text={"Here:\n```\nconst a = **not bold**;\n```"} />
    );
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("const a = **not bold**;");
  });

  it("links only http(s) — a javascript: url renders as plain text", () => {
    const { container } = render(
      <Markdown text="[safe](https://gofiley.com) and [bad](javascript:alert(1))" />
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://gofiley.com");
    expect(container.textContent).toContain("bad");
  });

  it("renders headings without showing the hashes", () => {
    const { container } = render(<Markdown text={"## Summary\nRevenue is up."} />);
    expect(container.textContent).toContain("Summary");
    expect(container.textContent).not.toContain("##");
  });

  it("survives an unterminated code fence mid-stream", () => {
    const { container } = render(<Markdown text={"Working:\n```\nhalf a line"} />);
    expect(container.querySelector("pre")?.textContent).toBe("half a line");
  });
});
