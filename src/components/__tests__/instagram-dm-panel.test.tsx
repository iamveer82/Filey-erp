import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIProvider } from "../../lib/ui";
import { draftFrom, draftProblems, fillTags, instagram, newDraft, parseKeywords, toInput, triggerSummary, type IgAutomation } from "../../lib/instagram";
import InstagramDmPanel from "../InstagramDmPanel";

const media = [{ id: "17890000001", media_type: "IMAGE", media_url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", caption: "New reel" }];
const saved = { ...newDraft(), id: "a1", connection_id: "c1", name: "Reel link", keywords: ["link"], platform_post_id: media[0].id,
  buttons: [{ title: "Get it", url: "https://gofiley.com" }], created_at: "", updated_at: "", stats: { sent: 12, publicReplies: 3, linkClicks: 5 } } as unknown as IgAutomation;

beforeEach(() => {
  vi.spyOn(instagram, "connections").mockResolvedValue([{ id: "c1", ig_user_id: "1", ig_username: "gofiley", account_type: "BUSINESS", connected_at: "", needs_reconnect: false }]);
  vi.spyOn(instagram, "automations").mockResolvedValue([saved]);
  vi.spyOn(instagram, "media").mockResolvedValue(media);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("turns a draft into what the server stores, and says what is missing", () => {
  const d = { ...newDraft(), name: " Giveaway ", keywords: ["link"], platform_post_id: "17890000001", buttons: [{ title: "Get it ", url: " https://x.co " }, { title: "", url: "" }] };
  expect(draftProblems(d)).toEqual([]);
  expect(toInput(d, true)).toMatchObject({ name: "Giveaway", trigger_type: "comment", platform_post_id: "17890000001", keywords: ["link"],
    buttons: [{ title: "Get it", url: "https://x.co" }], comment_reply: null, is_active: true, cooldown_hours: null });
  // Any word, public reply on, any post, every comment with the default cooldown.
  expect(toInput({ ...d, target: "any", match: "any", publicReply: true, repeat_mode: "every_comment" }, false))
    .toMatchObject({ platform_post_id: null, keywords: [], comment_reply: "Sent you a DM 📩", cooldown_hours: 24, is_active: false });
  // Story mentions have no keywords and no comment to reply under.
  expect(toInput({ ...d, target: "story_mention", publicReply: true, also_match_in_dms: true }, true))
    .toMatchObject({ trigger_type: "story_mention", keywords: [], comment_reply: null, also_match_in_dms: false });
  expect(draftProblems(newDraft())).toEqual([
    "Give the automation a name.", "Pick the post or reel to watch.", "Add at least one keyword, or choose “any word”.",
    "Button “Send me the link” needs a full link starting with https://.",
  ]);
  expect(draftFrom(saved)).toMatchObject({ target: "post", match: "words", publicReply: true });
});

it("parses keywords, fills merge tags and summarises triggers", () => {
  expect(parseKeywords("Price, LINK\nshop", ["link"])).toEqual(["link", "price", "shop"]);
  expect(fillTags("Hi {{first_name}} ({{ username }}) !", { username: "sara.d", first_name: "Sara" })).toBe("Hi Sara (sara.d)!");
  expect(triggerSummary({ trigger_type: "comment", platform_post_id: null, keywords: [] })).toBe("Comments on any post · any word");
  expect(triggerSummary({ trigger_type: "story_reply", platform_post_id: null, keywords: ["price"] })).toBe("Replies to your story · PRICE");
});

it("lists automations with their stats and pauses one", async () => {
  const toggle = vi.spyOn(instagram, "toggle").mockResolvedValue({});
  render(<UIProvider><InstagramDmPanel /></UIProvider>);
  expect(await screen.findByText("Reel link")).toBeInTheDocument();
  expect(screen.getByText("@gofiley")).toBeInTheDocument();
  expect(screen.getByText("Comments on one post · LINK")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Turn off Reel link" }));
  await waitFor(() => expect(toggle).toHaveBeenCalledWith("a1", false));
});

it("builds a new automation: post, keyword from the examples, link button, then Go Live", async () => {
  const save = vi.spyOn(instagram, "save").mockResolvedValue("a2");
  render(<UIProvider><InstagramDmPanel /></UIProvider>);
  fireEvent.click((await screen.findAllByRole("button", { name: /New automation/ }))[0]);
  fireEvent.change(screen.getByLabelText("Automation name"), { target: { value: "Price list" } });
  fireEvent.click(await screen.findByRole("option", { name: "New reel" }));
  fireEvent.click(screen.getByRole("button", { name: "Price" }));
  fireEvent.change(screen.getByLabelText("Button 1 link"), { target: { value: "https://gofiley.com/prices" } });
  // The DM preview shows the message as Sara would see it.
  fireEvent.click(screen.getByRole("tab", { name: "DM" }));
  expect(screen.getByText(/Hey Sara! Thanks so much/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Go Live/ }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0]).toBe("c1");
  expect(save.mock.calls[0][1]).toMatchObject({ name: "Price list", keywords: ["price"], platform_post_id: media[0].id, is_active: true,
    buttons: [{ title: "Send me the link", url: "https://gofiley.com/prices" }] });
  expect(save.mock.calls[0][2]).toBeUndefined();
});

it("offers to connect when no account is connected", async () => {
  vi.spyOn(instagram, "connections").mockResolvedValue([]);
  render(<UIProvider><InstagramDmPanel /></UIProvider>);
  expect(await screen.findByRole("button", { name: /Connect Instagram/ })).toBeInTheDocument();
});
