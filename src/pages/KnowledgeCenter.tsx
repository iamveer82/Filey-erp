import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowUpRight, BookOpen, Download, Search } from "lucide-react";
import { PageHeader } from "../components/ui";
import { isLocalMode } from "../lib/dataMode";
import { getAgentMode } from "../lib/agentMode";
import { downloadText } from "../lib/localPaths";
import { useUI } from "../lib/ui";

const COUNTRY_COVERAGE = [
  ["UAE", "Invoices, quotes, POs and receipts; AED and foreign-currency documents", "Editable VAT and TRN fields; PINT-AE export", "AED ledger; WPS export fields", "No verified government-gateway submission or filing"],
  ["India", "Invoices, quotes, POs and receipts; INR and other currencies", "GSTIN format and editable tax; country snapshot", "AED ledger; no localized statutory payroll", "No split GST, place-of-supply engine, IRN, e-way bills or returns"],
  ["EU member states", "Individual country selection; EUR and non-euro currencies", "VAT-ID labels and editable line tax", "AED ledger; no national payroll", "No VIES, OSS/IOSS, national e-invoice gateways or returns"],
  ["Saudi Arabia", "Country-aware documents; SAR and other currencies", "Editable VAT and tax-ID fields", "AED ledger; no localized statutory payroll", "No verified government-gateway submission or filing"],
  ["Other countries", "General documents and supported currencies", "Manually configured tax and identifiers", "AED ledger; generic people/pay records", "Country-specific validation, payroll and filings require separate implementation"],
];

export const GUIDES = [
  {
    id: "international-business", category: "Getting started", title: "Business country, currency and taxes", to: "/settings?section=company",
    summary: "Configure India, UAE or an individual EU country without changing saved documents.",
    steps: [
      "In Company Details choose Business country. Review the default tax percentage; the suggested-rate button is optional and does not classify your goods or services.",
      "The display currency changes displayed totals and new-document currency. It does not choose the tax country. New invoices, quotes, purchase orders and receipts keep a country snapshot.",
      "Existing documents keep their saved rates and country. Older records without a country retain legacy labels until reviewed. Use Tax country in the document editor for an explicit adjustment.",
      "Use a general document template outside UAE. UAE-specific layouts contain UAE legal text. PINT-AE XML is available only for UAE tax documents.",
      "India uses GSTIN labels, UAE uses TRN and EU countries use VAT ID. Format checks do not prove that a registration is valid.",
      "This release does not provide automatic national tax filings, Indian split-GST calculations or country-specific payroll. The underlying ledger is still AED; company and display currencies do not migrate it.",
      "Local storage retains country fields. Cloud administrators must apply the international-business migration before country settings or tagged documents can save or synchronize to cloud.",
    ],
  },
  {
    id: "projects-support", category: "Projects & service", title: "Deliver projects and resolve support tickets", to: "/projects",
    summary: "Connect customer work to tasks, deadlines, invoices and time entries.",
    steps: [
      "Open Projects or Helpdesk from Service. Create a record, set its owner label and priority, and link a saved customer or invoice.",
      "Add checklist tasks and log work in minutes with its date and a note. Save changes commits the record, tasks, time entries and updates together.",
      "Projects move from planned to active, blocked or completed. Tickets move from open to in progress, waiting, resolved or closed. Archive retains the record and its history.",
      "The list defaults to open work. Change its status filter to see completed or archived records. Charts and exported rows use the saved records.",
      "If another window changes a record first, Filey rejects your stale save. Keep your text, reopen the latest version and apply the intended changes.",
      "Filey AI can read and save these records through the Service toolset. Its normal mode and capability checks still apply. Owner names do not grant access; records are currently private to the account.",
      "Local mode needs no new database setup. Cloud administrators must apply the work-items migration before these modules can save or synchronize there.",
    ],
  },
  {
    id: "local-editions", category: "Getting started", title: "Free and paid local editions", to: "/settings?section=datamode",
    summary: "Use core ERP and CRM locally without a paid license.",
    steps: [
      "Core local storage and local invoices are free with no monthly invoice cap. Sign in online once to link the device; later offline password access requires a remembered password sign-in.",
      "Paid Ultra licenses retain their existing benefits, device activation and offline signature verification. They are not required to access your local records.",
      "Hosted cloud quotas and provider charges are separate. Free local software does not include unlimited hosted email, SMS, or external AI usage.",
      "In the desktop app, open Data & Storage to create a full database-and-files backup. The separate summary export is not a complete restorable backup.",
    ],
  },

  {
    id: "start",
    category: "Getting started",
    title: "Set up your business",
    to: "/settings?section=company",
    summary: "Your company details connect every document.",
    steps: [
      "Open Settings and complete your company name, address, currency and contact details. Add tax registration details only where applicable.",
      "Choose your document template and numbering format. Existing documents keep the details saved on them.",
      "Add customers, suppliers and products, or import them using each section's CSV import. Review the preview before saving.",
      "Create a draft invoice to check the details and totals before using it with customers.",
    ],
  },
  {
    id: "login",
    category: "Getting started",
    title: "Password, one-time codes and recovery",
    to: "/settings?section=security",
    summary: "Sign in, recover access and set a password.",
    steps: [
      "Use your account email and password. Passwords are case-sensitive; the show-password button lets you check what you entered.",
      "New passwords need at least eight characters. Sign-in accepts older passwords without applying the new-account strength policy.",
      "Choose Forgot password? on the sign-in screen and request a reset link. Filey sends it through Resend. Open the link, enter your new password twice, and submit. Your old password is not required.",
      "If you enabled two-step verification, enter your authenticator code to finish. After the password is saved, return to sign in. Reset links expire and can be used once; request a fresh link when needed.",
      "Password recovery needs an internet connection in both local and cloud modes. It preserves your business records and refreshes the offline password only for the matching remembered account on this device.",
      "An offline desktop device must first be linked online. A device claimed only by OTP needs one successful online password sign-in before password-based offline access works.",
    ],
  },
  {
    id: "crm",
    category: "Sales & CRM",
    title: "From lead to customer",
    to: "/crm",
    summary: "Keep companies, contacts and opportunities connected.",
    steps: [
      "Capture a lead with its company, contact information and source. Add a task for the next step.",
      "Open the lead and choose Convert. Filey creates a linked company, contact and deal. Repeating a cloud conversion returns the same deal.",
      "Use Deals to change stage, expected close date and probability. Board moves use the stage's default probability.",
      "Attach notes, tasks and activities to records. Company and contact detail views show their related records.",
      "Use Reports to inspect pipeline and forecasts. Forecasts are estimates based on deal values and probabilities, not received cash.",
    ],
  },
  {
    id: "invoices",
    category: "Sales & CRM",
    title: "Create and collect an invoice",
    to: "/invoicing",
    summary: "Draft, review, send and record payment.",
    steps: [
      "Create an invoice and select the customer. Select saved products when you want document lines linked to inventory.",
      "Enter quantities, prices, tax and discounts. Check currency, issue date, due date and the live document preview.",
      "Save the draft before sending. Use the document's email or sharing action to deliver it; saving a draft does not send it.",
      "Record a payment against the invoice when money is received. Check the remaining balance and Payment Receipts.",
      "Review Accounting and Reports for the resulting entries. A sales value and a cash receipt are different measures.",
    ],
  },
  {
    id: "invoice-messages",
    category: "Sales & CRM",
    title: "Send invoices through WhatsApp or Messages",
    to: "/invoicing",
    summary: "Review the recipient and share the saved invoice PDF without an API key.",
    steps: [
      "From an invoice row, choose Send → WhatsApp or SMS. The editor also has WhatsApp and Messages buttons that save before preparing the document.",
      "Check the international phone number and message. Wait for the PDF filename and size to appear. Preparation does not send anything.",
      "Use Share PDF on a supported device and select a messaging app and recipient. Otherwise download the PDF, open the WhatsApp draft and attach the file yourself.",
      "For direct PDF sending in the desktop app, pair WhatsApp under Integrations. Send PDF via paired WhatsApp queues the document; check WhatsApp itself for delivery.",
      "SMS opens your device's messaging app with text and an optional invoice link. SMS does not attach PDFs and carrier charges may apply. A compatible messaging app must be installed.",
      "A hosted cloud app can offer Add invoice link. Anyone with that link can view the invoice. Local mode shares the PDF; localhost links would not work for recipients.",
    ],
  },
  {
    id: "quotes",
    category: "Sales & CRM",
    title: "Quotation to invoice",
    to: "/quoting",
    summary: "Keep accepted work connected to the final sale.",
    steps: [
      "Create a quotation with a customer, line items, validity date and terms.",
      "Review discounts and tax for each line, then save and share the quotation.",
      "Use the quotation's conversion action to create an invoice. Review the new invoice before sending.",
      "Use record links to follow the relationship between the quotation, customer and invoice.",
    ],
  },
  {
    id: "purchasing",
    category: "Purchases & stock",
    title: "Purchase orders and receiving",
    to: "/purchase-orders",
    summary: "Buy from suppliers and receive linked stock.",
    steps: [
      "Choose a saved supplier and products, then enter quantities, unit costs and the expected date.",
      "Review the purchase order and save it as a draft. A draft does not mean goods have arrived.",
      "Receive the purchase order when goods arrive. Linked product quantities increase and accounting records reflect the received purchase.",
      "Receiving the same purchase order again must not add the stock twice. For corrections, check the original receipt and inventory movements before entering an adjustment.",
      "Supplier invoices are available separately under Purchase. Avoid recording the same business event twice.",
    ],
  },
  {
    id: "inventory",
    category: "Purchases & stock",
    title: "Products, stock and reorder levels",
    to: "/inventory",
    summary: "Track quantities and explain each movement.",
    steps: [
      "Create products with a unique SKU, unit, selling price, cost and reorder level. Link a supplier when possible.",
      "Use stock entries for goods in, goods out or a signed adjustment. Decimal quantities are supported for measures such as litres and kilograms.",
      "Add a reference and note so the next person understands the movement.",
      "Review movement history before correcting stock. Negative stock indicates an outstanding quantity; it should not be hidden by resetting it to zero.",
      "Use low-stock replenishment to prepare purchase-order drafts, then review their quantities before ordering.",
    ],
  },
  {
    id: "accounting",
    category: "Finance & people",
    title: "Accounting and reconciliation",
    to: "/accounting",
    summary: "Check records against the actual money movement.",
    steps: [
      "Review accounts, expenses and transactions in Accounting. Keep descriptions and dates meaningful.",
      "Use Payment Receipts for customer collections and keep them linked to invoices where applicable.",
      "Compare bank statements with recorded transactions before marking entries reconciled.",
      "Use Reports for the trial balance, balance sheet and period comparisons. Review source records when a figure appears wrong.",
    ],
  },
  {
    id: "people",
    category: "Finance & people",
    title: "Employees, attendance and payroll",
    to: "/people",
    summary: "Keep employee records and payroll periods consistent.",
    steps: [
      "Add employees with department, hire date and salary information.",
      "Record attendance for the correct day and employee.",
      "Prepare payroll for the intended period and review allowances, deductions and net pay before marking it paid.",
      "Complete the required bank and employee identifiers before exporting a WPS file.",
    ],
  },
  {
    id: "ai-setup",
    category: "Filey AI",
    title: "Local AI, free tiers and your own keys",
    to: "/settings?section=ai",
    summary: "Choose where your model runs and which account pays for hosted requests.",
    steps: [
      "For local inference, install Ollama or LM Studio and download a model that fits your computer. Start its local server, choose its preset in Settings → AI Assistant, then use Find local models and select the installed model ID.",
      "Local Ollama needs no API key. LM Studio accepts keyless requests by default; if you enabled authentication, enter your local server token. Downloaded models run on your hardware; model licenses still apply. A cloud-backed model can still send data online through a local server.",
      "For hosted free inference, choose OpenRouter · free models, Groq or Google Gemini and use Get your API key to open the provider's dashboard. Enter a key from your own account. Availability, region eligibility and quotas vary; Gemini's free tier may use submitted content to improve Google's products. Check Provider setup & limits before sending business data.",
      "Filey supports OpenAI-compatible Chat Completions and Anthropic Messages endpoints. Choose a model with tool calling for business actions and vision for document images. A successful greeting test does not prove all model capabilities.",
      "AI keys are saved in this browser or desktop profile, without application-level encryption, and are used with the selected endpoint. Changing the endpoint origin clears the previous key to avoid sending it to another provider. No shared provider key is bundled with these presets.",
      "Find local models only reads the server catalogue. Test connection sends a short greeting; it does not read or change business records. In a browser, your local server must allow the Filey origin; the installed desktop app uses its native request transport.",
      "Filey's cloud/local record mode and the AI provider are independent choices. Local AI can still invoke enabled online tools. To keep a run offline, use a downloaded local model and disable the online capabilities you do not want.",
    ],
  },
  {
    id: "agent",
    category: "Filey AI",
    title: "Work across Filey with the agent",
    to: "/agent",
    summary: "Give the agent a clear outcome and review its result.",
    steps: [
      "Connect an AI provider in Settings → AI, then open Filey AI. The model needs tool-calling support for business actions.",
      "Name the customer or supplier and provide the item, quantity and rate. Example: Create a draft invoice for Acme, 2 pumps at AED 350 each.",
      "The agent can read business records and run enabled tools. A saved draft is available in the same section as a manually created document.",
      "Accept edits lets the agent prepare records while asking before sensitive actions. Manual asks before writes; Plan prevents writes; Auto uses the permissions you granted.",
      "Review tool results and linked records. If an action fails, its error is evidence of failure; do not assume the record was created.",
      "CRM records tools cover companies, contacts, leads, deals, tasks, notes and activity. For a new relationship, create its parent record first and use the returned ID.",
    ],
  },
  {
    id: "browser",
    category: "Filey AI",
    title: "Use business websites with Filey AI",
    to: "/browser",
    summary: "Open Instagram, WhatsApp and other websites in the Windows app.",
    steps: [
      "Open Browser in the sidebar and choose a website. Windows opens an isolated Filey browser window; the web version opens a normal browser tab.",
      "Sign in to the website yourself. Site logins stay on this device with your Filey account and company, including across local/cloud switching. Changing workspace closes the windows without deleting that profile's cookies.",
      "In Filey AI, enable temporary Computer access and describe the task. The model needs vision and tool support. It can open windows, inspect screenshots and interact with the visible page while access is active.",
      "Review the selected account, recipient and content before publishing or sending. Opening a site or a message draft does not complete the action. You handle passwords, CAPTCHA and site permissions.",
      "Some sites restrict embedded browsers or need popup login flows. Filey shows blocked popup and download notices. Use your regular browser when a site requires it; no authentication or platform restrictions are bypassed.",
      "For invoices, paired WhatsApp sends the actual PDF. Prepare WhatsApp + PDF saves the file and opens an unsent draft; attach the saved PDF and verify the result before treating it as sent.",
    ],
  },
  {
    id: "free-work-tools",
    category: "Integrations",
    title: "Free work tools and your own keys",
    to: "/integrations?tab=services",
    summary: "Use keyless public data and understand optional provider setup.",
    steps: [
      "In Integrations → Free work tools, choose Market facts, Public holidays or Creative assets. Lookups send the entered country, year or public search phrase; they do not change business records.",
      "Market facts include the World Bank observation year. Holidays cover only supported countries and label regional dates. Image results carry source and licence information; keep required attribution when using them.",
      "Ask Filey AI for the same data during research or marketing preparation. A local model can use these online tools, so local inference does not mean every enabled tool is offline.",
      "The catalogue distinguishes local tools, keyless APIs, limited free tiers and providers requiring your account. Provider setup links lead to official sites; Filey does not create or share provider credentials.",
      "Bring your own supported AI, web-research or social-provider key through its setup page. Resend email keys belong in server configuration. Paid quotas and account authorization remain the provider's responsibility.",
    ],
  },
  {
    id: "skills",
    category: "Filey AI",
    title: "Memory, skills and web research",
    to: "/settings?section=capabilities",
    summary: "Extend the agent deliberately.",
    steps: [
      "Enable the capabilities the agent needs. Disabled capabilities produce a clear refusal instead of running the action.",
      "Save reusable procedures as skills and review remembered preferences. These are instructions and context, not automatic model retraining.",
      "Enable Web research in Integrations to read public pages within Jina's keyless limits. Web search requires your own Jina API key; provider allowances, charges and website restrictions still apply.",
      "Connected apps only become usable after their provider setup and authorization succeed. Document or webpage content cannot grant permission to send messages or move money.",
    ],
  },
  {
    id: "charts",
    category: "Troubleshooting",
    title: "Read and troubleshoot charts",
    to: "/reports",
    summary: "Charts are calculated from your records.",
    steps: [
      "Open Reports → Insights and choose a section to explore its record counts and monthly trends. Section insights are collected here.",
      "Overview shows invoiced amounts, confirmed payment receipts and expenses for the last 7, 30 or 90 days. Invoice trends include sent, paid and overdue invoices, while receipt trends include paid receipts on their payment dates.",
      "Empty data shows an empty state. Creating a record without the relevant date will not add a point to a date chart.",
      "Use the chart tooltip and available chart-data table to compare exact values. Export chart CSV for further analysis.",
      "The selected display currency applies to money charts. Invoice payments and separate payment receipts are different records; confirmed receipt totals cover payment receipts only.",
      "If loading fails, use Refresh or retry the page. A failed first database read is shown as an error, rather than an empty business.",
    ],
  },
  {
    id: "email",
    category: "Integrations",
    title: "Email with Resend",
    to: "/integrations",
    summary: "Configure once on the server and send from documents.",
    steps: [
      "The administrator configures RESEND_API_KEY and EMAIL_FROM as Supabase secrets, and deploys the send-email function. Never put the secret key in a browser build.",
        "Verify the sender domain in Resend before sending to customers. Supabase Auth SMTP is configured separately for signup, login and password recovery emails; use Filey's recovery email template for reset links.",
      "Open Integrations → Built-in connections → Check configuration. This checks server setup without sending a message.",
      "Use the email action on an invoice or quotation. Resend free-tier quotas and Filey's daily caps still apply.",
      "Check Communications for send attempts. A successful API send means the provider accepted it; it does not prove delivery to the inbox. The provider dashboard contains delivery and bounce information.",
    ],
  },
  {
    id: "integrations",
    category: "Integrations",
    title: "Connect apps and messaging channels",
    to: "/integrations",
    summary: "All connections live in one section.",
    steps: [
      "Use App directory to find an integration. Provider setup holds connection credentials and the desktop WhatsApp bridge.",
      "Authorize connected apps in the provider's browser window, then refresh connection status. Missing provider setup is different from being signed out of Filey.",
      "Built-in connections include public reference rates, manual WhatsApp and Telegram links, calendar export and Resend email status.",
      "Contact chat links open your own messaging account. Automated bots require their own administrator setup and credentials.",
      "The core CRM needs no enrichment subscription. Optional third-party services have their own pricing, quotas and permissions.",
    ],
  },
  {
    id: "files",
    category: "Documents & data",
    title: "Files, PDF tools and exports",
    to: "/tools",
    summary: "Process documents and keep useful output.",
    steps: [
      "Choose a tool and upload the supported file type. Review any page range, quality or conversion options.",
      "Run the tool and download its output. Some desktop-only tools need the installed Filey app.",
      "Use My Files to manage saved files and attach them to Filey AI when you want to work on their contents.",
      "CSV export contains the current records or filtered view. Calendar export is a snapshot; later edits do not synchronize with an imported calendar.",
    ],
  },
  {
    id: "storage",
    category: "Documents & data",
    title: "Cloud, offline mode and backups",
    to: "/settings?section=datamode",
    summary: "Know where the active workspace is stored.",
    steps: [
      "Cloud mode uses your signed-in account and workspace permissions. Local mode stores business records on the device.",
      "The storage badge in the header identifies the active workspace. In Settings → Data & Storage, review the destination before switching. Existing records stay in their original store unless you explicitly transfer them.",
      "Cloud saves require connectivity. Local saves work offline. Automatic cloud sync is off by default and must be enabled separately for the same account that owns the device workspace.",
      "Switching preserves your session after checking the destination. If a cloud session or a local license is unavailable, the current workspace remains open with an explanation. Other open tabs pause until reloaded.",
      "Export a backup before moving devices or making a large import. Keep backup files in a location you control.",
      "When reporting a problem, include the section, action, error message and whether it happened in cloud or local mode. Do not include passwords or API keys.",
    ],
  },
] as const;

export default function KnowledgeCenter() {
  const help = useLocation().pathname === "/help";
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const { toast } = useUI();
  const article = GUIDES.find((g) => g.id === params.get("article"));
  const filtered = GUIDES.filter((g) =>
    `${g.title} ${g.category} ${g.summary} ${g.steps.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const download = async () => {
    try {
      await downloadText(
        "filey-diagnostics.txt",
        [
          "Filey support diagnostics",
          `Generated: ${new Date().toISOString()}`,
          `Storage: ${isLocalMode() ? "local" : "cloud"}`,
          `Network: ${navigator.onLine ? "online" : "offline"}`,
          `Runtime: ${"__TAURI_INTERNALS__" in window ? "desktop" : "browser"}`,
          `Agent mode: ${getAgentMode()}`,
          "",
          "Add the section, steps, expected result and exact error before sharing.",
          "No business records, logs, account identifiers or credentials are included.",
        ].join("\n"),
        "text/plain"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="pb-10">
      <PageHeader
        title={help ? "Help Center" : "Documentation"}
        subtitle={
          help
            ? "Find an answer and get back to work."
            : "Practical guides for your connected Filey workspace."
        }
        action={
          <Link className="btn-secondary" to={help ? "/docs" : "/help"}>
            {help ? "Browse documentation" : "Get help"}
            <ArrowUpRight size={14} />
          </Link>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <label className="flex items-center gap-2 border border-border rounded-lg px-3 bg-card">
            <Search size={16} className="text-muted-foreground" />
            <input
              className="input border-0 bg-transparent px-0 shadow-none"
              aria-label="Search help articles"
              placeholder="Search guides…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="Choose a help article"
            className="select mt-3 lg:hidden"
            value={article?.id || ""}
            onChange={(e) => setParams(e.target.value ? { article: e.target.value } : {})}
          >
            <option value="">Choose a guide</option>
            {filtered.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <nav aria-label="Help topics" className="hidden lg:block mt-4 space-y-5">
            {[...new Set(filtered.map((g) => g.category))].map((category) => (
              <div key={category}>
                <h2 className="text-xs font-semibold text-muted-foreground mb-2">
                  {category}
                </h2>
                {filtered
                  .filter((g) => g.category === category)
                  .map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setParams({ article: g.id })}
                      aria-current={article?.id === g.id ? "page" : undefined}
                      className={`block text-left w-full text-sm px-3 py-2 rounded-md ${article?.id === g.id ? "bg-hover font-medium" : "hover:bg-hover text-muted-foreground"}`}
                    >
                      {g.title}
                    </button>
                  ))}
              </div>
            ))}
            {!filtered.length && (
              <p role="status" className="text-sm text-muted-foreground">
                No matching guides. Try “invoice”, “password” or “stock”.
              </p>
            )}
          </nav>
        </aside>
        <div className="min-w-0">
          {article ? (
            <article className="max-w-3xl">
              <p className="text-sm text-muted-foreground mb-2">{article.category}</p>
              <h2 className="text-2xl font-semibold tracking-tight">{article.title}</h2>
              <p className="text-muted-foreground mt-2">{article.summary}</p>
              <ol className="mt-7 space-y-5 list-decimal pl-5 text-sm leading-7">
                {article.steps.map((step) => (
                  <li key={step} className="pl-2">
                    {step}
                  </li>
                ))}
              </ol>
              {article.id === "international-business" && <section className="mt-7" aria-label="Country capability matrix">
                <h3 className="text-lg font-semibold">Country coverage</h3><p className="help mb-3">Current implementation · ledger amounts remain AED. Country-aware documents do not provide complete national accounting or filing support.</p>
                <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Region","Documents","Tax handling","Accounting & payroll","Not included"].map(heading=><th key={heading} className="border-b border-border px-3 py-2 font-medium">{heading}</th>)}</tr></thead><tbody>{COUNTRY_COVERAGE.map(row=><tr key={row[0]}>{row.map((cell,index)=><td key={index} className="min-w-40 border-b border-border px-3 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div>
                <p className="help mt-3">English, Arabic and Hindi interfaces use English fallbacks where untranslated. PDF output depends on the selected layout and available fonts. Project and helpdesk owner names are labels; they do not send assignment notifications.</p>
              </section>}
              <Link className="btn-primary mt-7" to={article.to}>
                Open section
                <ArrowUpRight size={14} />
              </Link>
              <p className="mt-8 pt-4 border-t border-border text-xs text-muted-foreground">
                Applies to the current Filey workspace. Available actions depend on your
                permissions and enabled modules.
              </p>
            </article>
          ) : (
            <>
              <div className="bg-card border border-border rounded-xl p-6 md:p-8">
                <BookOpen size={26} className="mb-5 text-primary-500" />
                <h2 className="text-2xl font-semibold tracking-tight">
                  {help
                    ? "What do you need help with?"
                    : "One workspace, connected workflows."}
                </h2>
                <p className="text-sm text-muted-foreground leading-6 mt-3 max-w-xl">
                  Start with a customer, create a quotation, issue an invoice and record
                  payment. These guides explain how the records connect and what to check
                  when something goes wrong.
                </p>
                <button
                  className="btn-primary mt-5"
                  onClick={() => setParams({ article: help ? "login" : "start" })}
                >
                  {help ? "Fix a sign-in problem" : "Set up Filey"}
                </button>
              </div>
              <h2 className="text-base font-semibold mt-7 mb-2">
                {query ? "Search results" : "Common workflows"}
              </h2>
              <div className="divide-y divide-border">
                {(query
                  ? filtered
                  : GUIDES.filter((g) =>
                      [
                        "crm",
                        "invoices",
                        "purchasing",
                        "agent",
                        "charts",
                        "email",
                      ].includes(g.id)
                    )
                ).map((g) => (
                  <button
                    key={g.id}
                    className="w-full text-left py-4 flex items-start gap-4 hover:text-primary-600"
                    onClick={() => setParams({ article: g.id })}
                  >
                    <div className="flex-1">
                      <h3 className="text-sm font-medium">{g.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{g.summary}</p>
                    </div>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
          {help && (
            <section className="mt-8 border-t border-border pt-6">
              <h2 className="text-base font-semibold">Report a reproducible problem</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                Write down the section, action, expected result and exact error. Download
                a small environment summary to attach to your report. Share it through
                your existing support contact.
              </p>
              <button className="btn-secondary mt-4" onClick={() => void download()}>
                <Download size={14} />
                Download diagnostics
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
