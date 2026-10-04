const walletMessages = new Map([
  [
    "This request was already submitted. Refresh your balance before retrying.",
    "This request was already submitted. Refresh your Coin balance before trying again.",
  ],
  [
    "AI credits are paused while a payment dispute is reviewed.",
    "Coin spending is paused while a payment dispute is reviewed.",
  ],
  [
    "AI request limit reached. Wait a minute.",
    "AI request limit reached. Wait a minute before trying again.",
  ],
  [
    "Not enough available AI credits for this request. Add credits or lower the output limit.",
    "Insufficient credit. Add Coin to continue.",
  ],
  [
    "Insufficient credit. Add Coin to continue.",
    "Insufficient credit. Add Coin to continue.",
  ],
  [
    "Daily AI spending limit reached. Adjust it in AI Credits.",
    "Coin spending is temporarily unavailable. Refresh your wallet and try again.",
  ],
  [
    "Task spending limit reached. Adjust it in AI Credits or reduce the task.",
    "Coin spending is temporarily unavailable. Refresh your wallet and try again.",
  ],
]);

/** Translate service failures without exposing provider, SQL or runtime details. */
export async function serviceError(error: unknown, fallback: string): Promise<Error> {
  const value = error as {
    message?: string;
    context?: { status?: number; json?: () => Promise<{ error?: unknown }> };
  } | null;
  let detail = value?.message ?? "";
  try {
    const body = await value?.context?.json?.();
    if (typeof body?.error === "string") detail = body.error;
  } catch {
    /* A gateway error may not have a JSON body. */
  }
  const status = value?.context?.status;
  const walletMessage = walletMessages.get(detail);
  if (walletMessage) return new Error(walletMessage);
  if (detail === "Connection lost")
    return new Error(
      "Connection lost. Refresh to check whether your request completed before trying again."
    );
  if (/^Free allowance exhausted/.test(detail))
    return new Error(
      "Free allowance exhausted. Try again later or use your own model key."
    );
  if (/^Filey-funded AI is not configured yet/.test(detail))
    return new Error(
      "Shared AI models aren’t available yet. You can use your own model key in AI settings."
    );
  if (/^Attachments are too large\./.test(detail))
    return new Error("This attachment is too large. Choose a smaller image.");
  if (/^Choose a payment and provide a reason/.test(detail))
    return new Error(
      "Choose a payment and add a reason between 10 and 2,000 characters."
    );
  if (/^Set a task limit from/.test(detail))
    return new Error(
      "Set a task limit from $0.01 to $50, and a daily limit between your task limit and $100."
    );
  if (
    [
      "Choose an AI credit amount from $5.00 to $100.00, in whole cents.",
      "Choose one AI credit pack or enter a custom amount.",
      "Custom AI credit amounts are not available yet.",
      "Filey AI has no available model for this request. Try a smaller conversation or use your own API key.",
      "Workspace changed. Reopen Billing before continuing.",
      "This account already owns Ultra.",
      "This workspace already has a paid plan. Use Manage billing.",
      "This workspace already includes cloud access through Ultra.",
      "Only the workspace owner or an admin can manage billing.",
      "No subscription on this workspace yet.",
      "Verify your email before adding AI credits.",
      "Balance too low",
      "Choose an available AI credit pack.",
      "Filey-funded AI is not available yet.",
      "Coin payments are not available yet.",
      "This AI credit pack is not configured correctly.",
      "This Coin promotion is not available for this account or amount.",
      "This Coin promotion has already been opened. Complete your original checkout.",
    ].includes(detail)
  )
    return new Error(detail);
  if (/^All \d+ device slots are in use\./.test(detail))
    return new Error(
      "All your device slots are in use. Remove an old device from Billing to continue."
    );
  if (detail === "No active license on this account")
    return new Error(
      "No Ultra purchase was found for this account. Sign in with the email used at checkout."
    );
  if (status === 401 || /^(Unauthorized|Invalid JWT|JWT expired)$/i.test(detail))
    return new Error("Please sign in to your Filey account again, then try this action.");
  if (status === 429 || /^(Rate limit|Too many attempts)/i.test(detail))
    return new Error("Too many attempts. Please wait a few minutes and try again.");
  // Do not forward the tail of a provider/database error just because its
  // beginning resembles a friendly instruction.
  if (/^Sign in to/.test(detail))
    return new Error("Please sign in to your Filey account again, then try this action.");
  if (/^Your (account|workspace) changed\./.test(detail))
    return new Error("Your account or workspace changed. Reopen this section before trying again.");
  if (status === 403)
    return new Error(
      "You don’t have permission to do this. Ask your workspace owner for help."
    );
  if (/network|failed to fetch|failed to send a request|timeout|timed out/i.test(detail))
    return new Error(
      "We couldn’t connect. Check your internet connection and try again."
    );
  return new Error(fallback);
}
