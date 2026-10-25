import { beforeEach, describe, expect, it } from "vitest";
import { setCacheOrg } from "../api";
import { connectViking, vikingServer } from "../viking";

describe("OpenViking connection", () => {
  beforeEach(() => {
    localStorage.setItem("filey_data_mode", "local");
    setCacheOrg("test-org", "test-user");
  });

  it("stores only a bare http(s) address", () => {
    expect(connectViking("not a server")).toEqual({ error: expect.stringContaining("http") });
    expect(connectViking("https://user:secret@viking.example")).toEqual({ error: expect.stringContaining("password") });
    expect(connectViking("http://127.0.0.1:1933/")).toEqual({ ok: true, server: "http://127.0.0.1:1933" });
    expect(vikingServer()).toBe("http://127.0.0.1:1933");
  });
});
