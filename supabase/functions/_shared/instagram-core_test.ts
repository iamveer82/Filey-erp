import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyMergeTags, matchesKeywords, parseFollowGatePayload, followGatePayload, validateAutomationInput } from "./instagram-core.ts";

Deno.test("keyword matching: word, exact, contains, typos and exclusions", () => {
  assert(matchesKeywords("Send me the LINK please", ["link"], [], "word"));
  assert(!matchesKeywords("unlinked", ["link"], [], "word"));
  assert(matchesKeywords("unlinked", ["link"], [], "contains"));
  assert(matchesKeywords("price", ["price"], [], "exact"));
  assert(!matchesKeywords("price?", ["price"], [], "exact"));
  assert(matchesKeywords("whats the prise", ["price"], [], "word", true));
  assert(matchesKeywords("lnk", ["link"], [], "word", true));
  assert(!matchesKeywords("bye", ["buy"], [], "word", true)); // under 4 letters: no fuzzing
  assert(!matchesKeywords("link but not spam", ["link"], ["spam"], "word"));
  assert(matchesKeywords("anything", [], [], "word")); // no keywords = any comment
  assert(matchesKeywords("أريد السعر", ["السعر"], [], "word"));
});

Deno.test("merge tags drop the space a blank name leaves", () => {
  assertEquals(applyMergeTags("Hi {{first_name}}, here you go", { first_name: "Sara" }), "Hi Sara, here you go");
  assertEquals(applyMergeTags("Hi {{first_name}}, here you go", {}), "Hi, here you go");
});

Deno.test("follow-gate payload round trip", () => {
  assertEquals(parseFollowGatePayload(followGatePayload("abc")), "abc");
  assertEquals(parseFollowGatePayload("other"), null);
});

Deno.test("automation validation", () => {
  const base = { name: "Reel", trigger_type: "comment", dm_message: "Here you go", keywords: ["Link", "link "], buttons: [{ title: "Open", url: "https://gofiley.com" }] };
  const ok = validateAutomationInput(base);
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.value.keywords, ["link"]);
    assertEquals(ok.value.cooldown_hours, null);
  }
  const bad = validateAutomationInput({ ...base, name: "", buttons: [{ title: "Open", url: "javascript:alert(1)" }], dm_delay_seconds: 60, platform_post_id: "abc" });
  assert(!bad.ok);
  if (!bad.ok) {
    assert(bad.errors.some((e) => e.includes("name")));
    assert(bad.errors.some((e) => e.includes("http(s) URL")));
    assert(bad.errors.some((e) => e.includes("Delayed sends")));
    assert(bad.errors.some((e) => e.includes("numeric Instagram media id")));
  }
  const long = validateAutomationInput({ ...base, dm_message: "x".repeat(700) });
  assert(!long.ok && long.errors.some((e) => e.includes("640")));
});
