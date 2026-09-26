import { appCheckoutReturn } from "./checkout-return.ts";
Deno.test(
  "checkout returns inside the app hash router and rejects invalid origins",
  () => {
    const previous = Deno.env.get("FILEY_APP_URL");
    try {
      Deno.env.delete("FILEY_APP_URL");
      const url = new URL(
        appCheckoutReturn({ section: "billing", plan: "ultra", checkout: "success" })
      );
      if (
        url.origin !== "https://app.gofiley.com" ||
        url.hash !== "#/settings?section=billing&plan=ultra&checkout=success"
      )
        throw new Error("Wrong return route");
      for (const invalid of [
        "http://app.gofiley.com",
        "javascript:alert(1)",
        "https://user:pass@app.gofiley.com",
        "ftp://localhost",
      ]) {
        Deno.env.set("FILEY_APP_URL", invalid);
        let rejected = false;
        try {
          appCheckoutReturn({ section: "credits" });
        } catch {
          rejected = true;
        }
        if (!rejected) throw new Error("Unsafe origin was accepted");
      }
    } finally {
      if (previous === undefined) Deno.env.delete("FILEY_APP_URL");
      else Deno.env.set("FILEY_APP_URL", previous);
    }
  }
);
