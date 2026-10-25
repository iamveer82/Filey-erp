/* Routes a user message onto one connected agent pack. The note rides the user
 * message, like the memory nudge, so the system prompt stays cacheable. */
const LAB = /\b(?:synthesi[sz]e|pathogen|bioweapon|gain[- ]of[- ]function|plasmid|primer design|culture (?:the|a) (?:virus|bacteria))\b/i;

/** A website task that needs a look-then-act loop, not only a tab opening. */
export function browserTask(text: string): boolean {
  return /\b(?:website|browser|sign in|log in|fill (?:in|out)|click|book)\b|https?:\/\//i.test(text)
    && /\b(?:open|go to|navigate|browse|sign in|log in|fill|click|book|type)\b/i.test(text);
}

/** The pre-installed skill that owns this message, or null when none does. */
export function stackSkill(text: string): string | null {
  if (/\b(?:openviking|viking:\/\/)\b/i.test(text)) return "openviking";
  if (!LAB.test(text) && /\b(?:literature review|scientific paper|citation|peer review|p-value|hypothesis)\b/i.test(text)) return "scientific";
  if (/\b(?:remember this|what do you know about me|my preference)\b/i.test(text)) return "agentmemory";
  if (browserTask(text)) return "browser-use";
  if (/\b(?:research|look (?:this |it )?up|what are people saying)\b|https?:\/\/|(?:youtube|github)\.com/i.test(text)) return "agent-reach";
  if (/\b(?:\/persona|mascot|slack|microsoft teams|discord)\b/i.test(text)) return "opendots";
  if (/\b(?:several steps|step by step|break this (?:task|work) down)\b/i.test(text)) return "harness";
  return null;
}

export function stackHint(text: string): string | undefined {
  const skill = stackSkill(text);
  if (!skill) return undefined;
  return `\n\n[Filey runtime, not the user: load use_skill ${skill} and follow it before other work. Ignore this note when it does not fit the message above.]`;
}
