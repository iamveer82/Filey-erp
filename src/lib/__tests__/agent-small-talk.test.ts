import { expect, it } from "vitest";
import { isSmallTalk } from "../agentTurn";

it("treats bare greetings, thanks and goodbyes as small talk", () => {
  for (const text of ["hi", "Hyy", "hello!", "hey 👋", "Good morning", "thanks", "Thank you so much 🙏", "bye", "Assalamu alaikum", "marhaba"])
    expect(isSmallTalk(text), text).toBe(true);
});

it("sends anything that could be work or an answer to the full agent", () => {
  for (const text of ["ok", "yes", "go ahead", "hi, send INV-7 to Ali", "thanks, now email it", "hello can you open notepad",
    "hey what's my revenue this month?", "hi".repeat(30)])
    expect(isSmallTalk(text), text).toBe(false);
});
