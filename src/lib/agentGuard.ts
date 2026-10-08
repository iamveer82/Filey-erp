// Run-scoped guard rails for the agent loop.
//
// A tool-calling model repeats itself. It re-reads the same list because it
// lost track, or re-issues a write because the first result didn't look like
// what it expected. Nothing in the loop noticed, which meant two consequences:
// rounds burned re-fetching data already in the conversation, and — the one
// that reaches a customer — the same invoice emailed twice.
//
// This is deliberately small. It is not a planner or a policy engine: it
// remembers what has already been called in THIS run and answers a repeat
// without executing it again.

/** Tools whose names mark them as reads. Everything else is treated as a write,
 *  which is the safe direction to be wrong in: a read wrongly classed as a
 *  write is merely re-executed, a write wrongly classed as a read is a
 *  duplicate side effect. */
const READ_PREFIXES = [
  "get_",
  "list_",
  "find_",
  "read_",
  "search_",
  "recall",
  "vat_",
  "financial_",
  "receivables_",
  "payables_",
  "crm_pipeline",
];

export const isReadOnly = (name: string): boolean =>
  name === "work_service" || READ_PREFIXES.some((p) => name.startsWith(p));

export interface Step {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  invalidArguments?: boolean;
  unconfirmedSave?: boolean;
  invoiceSave?: { number?: string; timedOut: boolean };
  /** Short human line for the run summary. */
  note: string;
}

export interface GuardDecision {
  /** When set, the loop must NOT execute — hand this back to the model. */
  short?: unknown;
}

export interface AgentGuard {
  /** Called before executing. Returns a canned result to skip execution. */
  before(name: string, args: Record<string, unknown>): GuardDecision;
  /** validationRejected is set only by trusted validation before dispatch. */
  after(name: string, args: Record<string, unknown>, result: unknown, validationRejected?: boolean): void;
  /** What happened this run, for the "I couldn't finish" case — a list of
   *  steps taken is worth more to a user than an apology. */
  steps(): Step[];
  unresolvedFailures(): Step[];
  summary(): string;
}

const keyOf = (name: string, args: Record<string, unknown>) => {
  // Stable across key order: the model does not emit arguments consistently.
  try {
    return `${name}:${JSON.stringify(args, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
        : value)}`;
  } catch {
    return `${name}:?`;
  }
};

/** Providers sometimes report a failure flag without an error string. */
export function toolFailure(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    if (typeof r.error === "string") return r.error;
    try { return JSON.stringify(r.error) || "The action returned an error."; }
    catch { return "The action returned an error."; }
  }
  return r.ok === false || r.success === false || r.successful === false || r.isError === true
    ? typeof r.message === "string" && r.message ? r.message : "The action did not complete successfully."
    : null;
}

const shortNote = (name: string, result: unknown): string => {
  const r = result as { message?: string; pending_action?: string } | null;
  const error = toolFailure(result);
  if (error) return `${name} failed: ${error}`;
  if (r?.pending_action) return `${name}: waiting for ${r.pending_action.replace(/_/g, " ")}`;
  if (r?.message) return `${name}: ${r.message}`;
  return `${name}: done`;
};

/** Wrap recoverable failures without widening the user's requested work.
 *
 *  A bare {error: "..."} is what made the agent give up on the first refusal:
 *  it looks terminal. Telling it how many steps remain, and that adapting is
 *  expected, is the difference between one failed call ending the task and the
 *  agent routing around it. */
export function coachResult(result: unknown, roundsLeft: number): unknown {
  const err = toolFailure(result);
  if (!err) return result;
  const storageQuota = /QuotaExceededError|^The quota has been exceeded\.?$|(?:localStorage|sessionStorage|(?:browser|device|local) storage)[\s\S]*(?:quota|full)|(?:setItem|setting the value)[\s\S]*exceeded (?:the )?quota/i.test(err);
  const planLimit = /\bplan limit reached\b/i.test(err);
  if (storageQuota || planLimit) return {
    ...(result as Record<string, unknown>),
    error: err,
    failure_kind: storageQuota ? "storage_quota" : "plan_limit",
    steps_remaining: roundsLeft,
    what_to_do: storageQuota
      ? "Browser or device storage is full. This error does not establish an invoice count or a plan limit; do not infer either from existing records. Explain the storage failure. Do not probe other writes or create a quotation, order, purchase document or other substitute unless the user requested it. Verify any uncertain save before retrying the requested invoice."
      : "Respect this explicit plan limit. Do not retry through a different tool, change workspaces or create another document to bypass it. Explain the reported limit without inventing a usage count; continue only with independently requested work.",
  };
  if ((result as { retry_safe?: boolean } | null)?.retry_safe === false) return result;
  const refused =
    /not approve|owner-only|capability.*(off|disabled)|Plan mode|permission|access.*(disabled|enable|expired|denied|revoked)|requires? (an? )?(owner|admin)|role.*(required|allowed|does not)|only a workspace owner|not allowed|cannot control this computer|personal browser is unavailable/i.test(
      String(err)
    );
  return {
    ...(result as Record<string, unknown>),
    error: err,
    steps_remaining: roundsLeft,
    what_to_do: refused
      ? "Respect this access or approval boundary. Do not retry through a different tool or channel. Explain what access or decision is needed; continue only with independently authorized work."
      : roundsLeft <= 1
        ? "This was the last step. Tell the user plainly what worked, what didn't, and what you'd try next."
        : "This attempt failed. Try a DIFFERENT approach within the user's requested work: correct the arguments or use read tools to check the cause. Do not probe unrelated writes or substitute a quotation, order, purchase document or other record unless the user requested it. Repeating this identical call will be refused.",
  };
}

// These creators save different business documents; none is a diagnostic probe
// or an equivalent route to saving the invoice the user requested.
const DOCUMENT_CREATORS: Record<string, "quote" | "order" | "purchase_order" | "bill" | "letter"> = {
  create_quote: "quote",
  create_order: "order",
  create_purchase_order: "purchase_order",
  create_purchase_invoice_draft: "bill",
  create_letter_draft: "letter",
};

const INVOICE_WRITES = new Set(["create_invoice_draft", "revise_invoice", "create_purchase_invoice_draft", "retry_invoice_save"]);

function requestedDocument(kind: typeof DOCUMENT_CREATORS[string], request: string): boolean {
  const noun = {
    quote: "(?:quotes?|quotations?)",
    order: "(?:sales\\s+orders?|orders?)",
    purchase_order: "(?:purchase\\s+orders?|POs?)",
    bill: "(?:supplier\\s+(?:bills?|invoices?)|purchase\\s+invoices?|bills?)",
    letter: "(?:(?:company|authorization|declaration)\\s+)?letters?",
  }[kind];
  const article = "(?:(?:an?|the|new|draft)\\s+)*";
  const action = "\\b(?:create|draft|prepare|make|generate|raise|issue|add)\\s+";
  if (new RegExp(`\\b(?:do not|don't|never)\\s+(?:create|draft|prepare|make|generate|raise|issue|add)\\b[^.!?\\n]*\\b${noun}\\b|\\bwithout\\s+${article}${noun}\\b`, "i").test(request)) return false;
  // Accept an explicit imperative or a separately named document in a creation
  // request. A source reference such as "invoice from quote QT-1" grants none.
  return new RegExp(`${action}${article}${noun}\\b`, "i").test(request) ||
    (new RegExp(action, "i").test(request) && new RegExp(`(?:\\band\\b|\\bplus\\b|[,;])\\s+${article}${noun}\\b`, "i").test(request));
}

export function createGuard(userRequest = ""): AgentGuard {
  const seen = new Map<string, unknown>();
  const log: Step[] = [];
  const unresolvedFailures = () => [...new Map(log.map(step => [keyOf(step.name, step.args), step])).values()].filter(step => {
    if (step.ok) return false;
    if (!step.invalidArguments) return true;
    // ponytail: bounded run history; index rejected calls by target if task budgets grow.
    const target = ["invoice_number", "letter_id", "letter_number", "id", "record_id", "customer_name", "employee_name", "name"].find(key => step.args[key] !== undefined);
    if (!target) return true; // No record identity: another success cannot prove this request was corrected.
    return !log.slice(log.indexOf(step) + 1).some(next => next.ok && next.name === step.name && next.args[target] === step.args[target]);
  });

  return {
    before(name, args) {
      if (name === "retry_invoice_save" && (!/\b(?:retry|continue|try\s+(?:it\s+)?again)\b/i.test(userRequest) ||
          /\b(?:do not|don't|never|stop)\b[^.!?\n]*\b(?:retry|continue|try)\b/i.test(userRequest))) return {
        short: { error: "The user has not asked to retry the earlier invoice save. Verify it with get_invoice first.", retry_safe: false },
      };
      if (name === "retry_invoice_save" && ![...seen].some(([key, result]) =>
        key.startsWith("list_pending_invoice_saves:") && Array.isArray(result)
          ? result.some(save => save?.request_id === args.request_id)
          : INVOICE_WRITES.has(key.split(":")[0]) &&
            (result as { save_outcome?: string; save_request_id?: string } | null)?.save_outcome === "unconfirmed" &&
            (result as { save_request_id?: string }).save_request_id === args.request_id)) return {
        short: { error: "Discover the original request with list_pending_invoice_saves from the sales toolset before retrying. Never guess a request ID or ask the user for one.", retry_safe: false },
      };
      const unconfirmed = unresolvedFailures().filter(step => step.unconfirmedSave);
      const exactRetry = name === "retry_invoice_save" && unconfirmed.some(step =>
        (seen.get(keyOf(step.name, step.args)) as { save_request_id?: string } | undefined)?.save_request_id === args.request_id);
      if (INVOICE_WRITES.has(name) && unconfirmed.length && !exactRetry) return {
        short: {
          error: "An earlier invoice save is unconfirmed — not repeating or changing it in this task.",
          save_outcome: "unconfirmed", retry_safe: false,
          hint: "Read the exact invoice to verify its outcome. A failed lookup does not prove it is absent. Keep the user's prices, quantities and custom fields unchanged; do not create another invoice or allocate a new number to bypass this check.",
        },
      };
      const documentKind = DOCUMENT_CREATORS[name];
      if (documentKind && unresolvedFailures().some(step => ["create_invoice_draft", "revise_invoice"].includes(step.name)) &&
          !requestedDocument(documentKind, userRequest)) return {
        short: {
          error: "The requested invoice failed. Creating a different business document was not requested, so this action was not run.",
          code: "unrequested_document_fallback",
          retry_safe: false,
          hint: "Keep the requested document type. Check the invoice failure with read tools, correct valid invoice arguments, or ask whether the user wants a different document. Do not use another write as a probe.",
        },
      };
      if (["workspace_browser", "get_video_job", "list_video_jobs", "use_saved_file", "current_time", "export_invoice_pdf", "export_letter_pdf"].includes(name)) return {};
      // Screen observations are perishable; reusing one can target a changed window.
      if (
        (name === "computer_use" || name === "agent_computer" || name === "browser") &&
        ["screenshot", "snapshot", "list", "list_windows", "list_tabs"].includes(
          String(args.action)
        )
      )
        return {};
      const k = keyOf(name, args);
      if (!seen.has(k)) return {};
      const prior = seen.get(k);
      if (isReadOnly(name))
        // Already answered this exact question — hand back the same answer
        // rather than spending a round on it.
        return toolFailure(prior) ? {} : { short: prior };
      // A write. Refuse, and say what happened the first time so the model can
      // move on instead of concluding the call failed and trying again.
      return {
        short: {
          error: `Already ran ${name} with these exact arguments in this task — not repeating it.`,
          previous_result: prior,
          retry_safe: false,
          hint: "Use the confirmed earlier result. If its outcome is uncertain, verify it before acting again. Never change arguments solely to bypass duplicate protection.",
        },
      };
    },
    after(name, args, result, validationRejected = false) {
      const k = keyOf(name, args);
      const failed = !!toolFailure(result);
      // Only the API's exact pending-payload comparison can confirm a lost
      // acknowledgement. An invoice existing under the same number is not
      // enough: it could have different lines or be an older revision.
      if ((name === "get_invoice" || name === "retry_invoice_save") && !failed && result && typeof result === "object") {
        const read = result as { id?: number; number?: string; ok?: boolean; verified_save_requests?: string[]; confirmed_save_request?: string };
        const confirmed = name === "retry_invoice_save" && read.ok === true && read.confirmed_save_request === args.request_id
          ? [read.confirmed_save_request] : name === "get_invoice" ? read.verified_save_requests : undefined;
        if (Number.isSafeInteger(read.id) && Number(read.id) > 0 && Array.isArray(confirmed)) {
          for (const step of log.filter(previous => previous.unconfirmedSave)) {
            const writeKey = keyOf(step.name, step.args);
            const pending = seen.get(writeKey) as { save_request_id?: string; invoice_number?: string; invoice_id?: number } | undefined;
            if (!pending?.save_request_id || !confirmed.includes(pending.save_request_id) ||
                !pending.invoice_number || read.number !== pending.invoice_number ||
                (pending.invoice_id !== undefined && read.id !== pending.invoice_id)) continue;
            step.ok = true;
            step.unconfirmedSave = false;
            step.note = `${step.name}: saved invoice verified`;
            seen.set(writeKey, { ok: true, id: read.id, number: read.number, message: "The saved invoice was verified." });
          }
        }
      }
      if (!validationRejected && !isReadOnly(name)) {
        // A failed acknowledgement can follow a committed mutation. Verify
        // current records even after errors; only trusted preflight proves no
        // write ran. Keep the write receipt below to prevent duplicate actions.
        for (const key of seen.keys())
          if (isReadOnly(key.split(":")[0])) seen.delete(key);
      }
      seen.set(k, result);
      const unconfirmedSave = failed && !validationRejected && INVOICE_WRITES.has(name) &&
        (result as { save_outcome?: string } | null)?.save_outcome === "unconfirmed";
      const save = result as { invoice_number?: unknown; save_failure?: unknown } | null;
      const number = typeof save?.invoice_number === "string" && save.invoice_number.length <= 160 &&
        !Array.from(save.invoice_number).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ? save.invoice_number.trim() : undefined;
      log.push({ name, args, ok: !failed, ...(validationRejected ? { invalidArguments: true } : {}),
        ...(unconfirmedSave ? { unconfirmedSave: true, invoiceSave: { number, timedOut: save?.save_failure === "timeout" } } : {}), note: shortNote(name, result) });
    },
    steps() {
      return [...log];
    },
    unresolvedFailures,
    summary() {
      if (!log.length) return "";
      const done = log.filter((s) => s.ok).map((s) => s.note);
      const failed = unresolvedFailures().map((s) => s.note);
      const parts: string[] = [];
      if (done.length) parts.push(`Done: ${done.join("; ")}`);
      if (failed.length) parts.push(`Failed: ${failed.join("; ")}`);
      return parts.join(". ");
    },
  };
}
