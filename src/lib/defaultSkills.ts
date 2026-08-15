// Default skill pack — seeded once so the Filey agent starts with a broad,
// domain-relevant toolkit instead of an empty brain. These encode the workflows
// a UAE SMB ERP actually needs (VAT/FTA invoicing, purchasing, follow-up, WPS),
// not generic dev skills. The agent can add its own via `learn_skill`; these
// are just the starting set.
import { addSkill } from "./agentSkills";

// Bumped when the pack gains skills, so existing installs get them too.
// addSkill upserts by name, so re-seeding rewrites the pack's own entries and
// leaves anything the owner or the agent wrote alone.
const SEEDED_KEY = "filey.agent.skills.seeded.v2";

interface SeedSkill {
  name: string;
  description: string;
  instructions: string;
}

const PACK: SeedSkill[] = [
  {
    name: "uae-vat-invoice",
    description: "How to create a compliant UAE VAT invoice (5%, TRN, FTA format).",
    instructions:
      "For any UAE invoice: apply 5% VAT to taxable items, zero-rate exports if the buyer is outside the UAE, and confirm the customer's TRN (15 digits, ends 3). Include the seller TRN, invoice date, due date, and AED amounts. Look up the customer and product first — never invent either. When tax is ambiguous, ask the user rather than guessing the rate.",
  },
  {
    name: "quote-to-invoice",
    description: "Convert a quotation to a sales order to an invoice without re-keying.",
    instructions:
      "When a customer accepts a quote, find the quote, convert it to a sales order, then to an invoice — reusing the same items, quantities and prices rather than re-entering them. Confirm the customer and pricing match the accepted quote before converting. If the customer changed something, note it and reflect the change.",
  },
  {
    name: "overdue-followup",
    description: "Draft polite follow-ups for unpaid/overdue invoices.",
    instructions:
      "For overdue invoices, look up each one (customer, number, days overdue, amount) and draft a short, polite payment reminder. Escalate tone only with more days overdue. Never send without the user's approval — sending is a gated action. Reference the invoice number and amount so the customer knows what to pay.",
  },
  {
    name: "purchase-and-stock",
    description: "Create purchase orders and receive stock against them.",
    instructions:
      "To restock, create a purchase order for the supplier with items, quantities and unit costs, then receive the goods against it so stock levels update. Verify the supplier and product exist first. Keep unit costs accurate — they feed cost of goods and margins.",
  },
  {
    name: "low-stock-reorder",
    description: "Spot low-stock items and suggest reorder quantities.",
    instructions:
      "Check each product against its reorder point. For anything at or below it, report the product, current stock, reorder point, and a suggested reorder quantity. Do not create purchase orders automatically — surface the list and let the user decide what to order.",
  },
  {
    name: "customer-onboarding",
    description: "Turn a new lead into a customer record with the right fields.",
    instructions:
      "When onboarding a customer, capture name, TRN (if VAT-registered), phone, email, address, and default payment terms. Check first that they don't already exist to avoid duplicates. For UAE customers, the TRN is what makes their invoice VAT-recoverable, so confirm it.",
  },
  {
    name: "vat-return",
    description: "Prepare the numbers for a UAE VAT return (output vs input tax).",
    instructions:
      "Use the VAT return tools to compute output tax (sales) and input tax (purchases) for the period. Report the net payable or refundable and flag anything that looks off — missing TRNs, zero-rated sales without evidence, or large input claims. Never file; just present the numbers and let the user review.",
  },
  {
    name: "payment-reconciliation",
    description: "Match incoming payments to invoices and mark them paid.",
    instructions:
      "When a payment arrives, find the matching invoice(s) by number or customer, apply the payment, and mark the invoice paid — only after the user confirms. Partial payments should reduce the outstanding balance, not fully mark paid. Note any overpayment or mismatch rather than guessing.",
  },
  {
    name: "export-documents",
    description: "UAE export paperwork — zero-rated invoices and required references.",
    instructions:
      "For exports, invoices are zero-rated VAT (0%) with the buyer's foreign address and, where applicable, their foreign tax ID. Include the incoterm, destination country, and any export declaration reference the user gives. Confirm the buyer is genuinely outside the UAE before zero-rating.",
  },
  {
    name: "document-toolbox",
    description: "How to use the file/OCR/PDF toolbox for documents.",
    instructions:
      "For a file the user attaches or mentions, call list_file_tools with a query (ocr, compress, convert, merge, extract) to find the right tool id, then run_file_tool with its options. OCR scans and extracts text; PDF tools split, merge, compress and convert. Report what you produced and where it was saved.",
  },
  {
    name: "monthly-report",
    description: "Assemble a monthly business report (sales, expenses, receivables).",
    instructions:
      "For a monthly report, gather sales/revenue, top customers, expenses, outstanding receivables and payables, and a short narrative of what changed versus the prior month. Use the reporting tools — never invent numbers. Present plainly in sentences, no markdown.",
  },
  {
    name: "run-a-repo",
    description: "Clone and run an open-source repo the owner points you at.",
    instructions:
      "When the owner sends a git URL and asks you to run it: (1) run_shell `git clone <url>` — with no cwd it lands in the Filey workspace, and the result tells you the directory it ran in; (2) read the README with read_file or `type README.md` / `cat README.md`, run with cwd set to the repo folder, and follow ITS setup steps rather than guessing; (3) install dependencies with whatever the repo uses — npm install, pnpm install, pip install -r requirements.txt, uv sync — passing a longer timeout, installs are slow; (4) if it needs credentials or an API key, ask the owner and save it with save_secret rather than putting it in a file; (5) run it and report what it produced, where the output landed, and any error verbatim. Never run a repo the owner did not ask for. If a step fails, show the actual stderr and say what you would try next — do not silently retry variations.",
  },
  {
    name: "leads-from-a-repo",
    description: "Use an external lead-gen tool and land its output in Filey.",
    instructions:
      "To generate leads with an outside tool: run it per the run-a-repo skill, then bring the results home. Read whatever it wrote — CSV, JSON, a printed table — and for each prospect worth keeping, use the built-in tools rather than re-inventing: score_lead to qualify, enrich_from_website to fill in details from the company's own site, and create the customer record only once the owner approves. Report a short list first (name, site, why it qualifies) and let the owner pick. Never bulk-create customers from a scrape without approval, and never email a scraped list.",
  },
  {
    name: "lead-qualification",
    description: "Score and qualify a prospect before pursuing.",
    instructions:
      "When a lead is passed in, score it (contact info completeness, budget signal, need, timing) and say whether it's worth pursuing. Prefer the built-in scoring tools over your own gut feel. If it's a genuine B2B buyer, flag the best next action — a call, a quote, or a follow-up.",
  },
];

/** Seed the default skill pack once per pack version. */
export function seedDefaultSkills(): void {
  if (localStorage.getItem(SEEDED_KEY)) return;
  localStorage.setItem(SEEDED_KEY, "1");
  for (const s of PACK) {
    addSkill({ name: s.name, description: s.description, instructions: s.instructions });
  }
}
