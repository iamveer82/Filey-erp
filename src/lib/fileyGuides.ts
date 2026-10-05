/** Shared, device-readable instructions. Reading a guide never performs its actions. */
export interface FileyGuide {
  id: string;
  category: string;
  title: string;
  to: string;
  summary: string;
  steps: readonly string[];
  stepTitles?: readonly string[];
  targets?: readonly string[];
  moduleId?: string;
}

export const GUIDES: readonly FileyGuide[] = [
  {
    "id": "remote-agent",
    "category": "Integrations",
    "title": "Your Filey agent on WhatsApp and Telegram",
    "to": "/integrations?tab=free",
    "summary": "Request work from your phone and receive documents through a securely paired desktop agent.",
    "steps": [
      "First configure your AI model in Settings → AI Assistant. The phone connection uses the same Filey tools, memories, saved procedures and workspace permissions as chat in the app.",
      "For WhatsApp, open Integrations → Built-in connections in Filey desktop and scan the QR through WhatsApp's Linked devices. Use Message yourself, or set a separate owner number for a spare paired phone. Other senders are ignored.",
      "For Telegram, create a dedicated bot with @BotFather → /newbot and enter its token in Built-in connections. Open its private chat and send the exact PAIR code shown in Filey within ten minutes. Groups and other accounts are ignored.",
      "Keep the signed-in desktop app open and online. Switching account or workspace stops remote work; reconnect in the desired workspace. These desktop connections do not run from a closed app or a mobile browser.",
      "Ask to find records, prepare or revise a draft, export an invoice PDF, or process a document. Generated files are returned to the originating chat when the provider accepts them. Check the actual file; a reply alone is not delivery proof.",
      "Sensitive actions show the exact tool and arguments. Reply YES within fifteen minutes to authorize that one action once. A different recipient, amount or operation requires a new approval. Capabilities and your workspace role still apply. Use /status for readiness, /help for examples, /stop to cancel queued work, or /new to also reset the conversation. Cancellation cannot undo a write or provider request that was already accepted; inspect Filey before repeating it. WhatsApp supports text, documents and configured speech providers. Telegram supports text, photos and documents up to 12 MB; voice is not implemented there. Interactive editing and paid media review happen in Filey. Optional agent computers stay separate from personal browser tabs."
    ],
    "moduleId": "integrations"
  },
  {
    "id": "international-business",
    "category": "Getting started",
    "title": "Business country, currency and taxes",
    "to": "/settings?section=company",
    "summary": "Configure India, UAE or an individual EU country without changing saved documents.",
    "steps": [
      "In Company Details choose Business country. Review the default tax percentage; the suggested-rate button is optional and does not classify your goods or services.",
      "The display currency changes displayed totals and new-document currency. It does not choose the tax country. New invoices, quotes, purchase orders and receipts keep a country snapshot.",
      "Existing documents keep their saved rates and country. Older records without a country retain legacy labels until reviewed. Use Tax country in the document editor for an explicit adjustment.",
      "Use a general document template outside UAE. UAE-specific layouts contain UAE legal text. PINT-AE XML is available only for UAE tax documents.",
      "India uses GSTIN labels, UAE uses TRN and EU countries use VAT ID. Format checks do not prove that a registration is valid.",
      "This release does not provide automatic national tax filings, Indian split-GST calculations or country-specific payroll. The underlying ledger is still AED; company and display currencies do not migrate it. Local storage retains country fields. Cloud administrators must apply the international-business migration before country settings or tagged documents can save or synchronize to cloud."
    ],
    "moduleId": "settings"
  },
  {
    "id": "directories",
    "category": "Sales & CRM",
    "title": "Customers and suppliers",
    "to": "/customers",
    "summary": "Save contact details once and reuse them in business documents.",
    "steps": [
      "Create a customer in Customers or a supplier in Suppliers. Enter the company, contact details, address and tax identifier that apply to that business.",
      "Review each contact before saving. Export the current directory as CSV when you need a copy; an exported file does not import or update contacts.",
      "Select the saved party when creating a document. Review its copied address and contact details; changing the directory later does not rewrite previously saved documents.",
      "Open the party's detail page to review linked documents, payments, notes and follow-ups. Use Statement of Account when you need a summary of its recorded balance.",
      "A directory entry is a business contact. Creating one does not invite that person into your Filey workspace or send a message."
    ],
    "moduleId": "customers"
  },
  {
    "id": "orders",
    "category": "Sales & CRM",
    "title": "Record a sales order",
    "to": "/orders",
    "summary": "Keep the order, its products and fulfilment status together.",
    "steps": [
      "Choose New order, select a customer and add the ordered products, quantities and rates. Review the total before saving.",
      "Use the order's edit action to update its status and details. Inspect the linked product quantities and movement history when completing or correcting fulfilment.",
      "Use quick view for a summary and the export action for the current order records. Share actions prepare a message in your chosen channel; verify the recipient before sending.",
      "An order and an invoice are separate records. Review invoicing and received payments separately; saving an order does not mean the customer has paid."
    ],
    "moduleId": "orders"
  },
  {
    "id": "packing-lists",
    "category": "Sales & CRM",
    "title": "Prepare a packing list",
    "to": "/packaging-list",
    "summary": "Describe the goods being sent, their packages and shipment weights.",
    "steps": [
      "Open Sales → Packaging List and choose New packaging list. Enter the recipient and delivery address; an invoice reference is optional.",
      "Add each item's description, quantity and unit. Duplicate repeated items or move them into delivery order. Optionally enter the package type, package count and net or gross weight per quantity unit. Filey calculates the shipment weights without combining different quantity units.",
      "Choose a packing-list template, review every preview page and Save. Download PDF or choose a sharing action, then check the recipient before sending.",
      "Update the status as the shipment progresses. A packing list is independent of invoices, stock movements and accounting; saving or dispatching it does not change those records."
    ],
    "moduleId": "packaging-list"
  },
  {
    "id": "letters",
    "category": "Documents & data",
    "title": "Create and issue a company letter",
    "to": "/letters",
    "summary": "Build custom correspondence on your company's letterhead and keep the issued copy.",
    "steps": [
      "Open Tools → Letter and choose New letter. Company details, logo, saved letterhead, signature and stamp are copied from Company Details; review them in Details and Appearance.",
      "Enter a letter title and recipient. Start with authorization or general declaration wording, or write your own text. Replace bracketed starter instructions before issuing.",
      "Use Add block for paragraphs, custom label/value fields, dates, signatures or stamps. Drag a block by its handle, use the up/down arrows, or use the keyboard to change its order.",
      "In Content, choose a Formatting target: All body text, Letter title, or a specific paragraph, field or date. Clicking a paragraph also selects it. Apply a font, point size, bold, italic, underline, color, alignment, line spacing or paragraph spacing to that target.",
      "In Appearance, choose a layout and use the switches for company details, saved company letterhead, company logo, saved signature and company stamp. Show letter reference is optional; the internal letter number still identifies the saved letter.",
      "Review every preview page and save a draft while preparing the document. Choose Issue letter after reviewing the content. Issuing saves its content, formatting, layout and company asset references. Download the PDF; issuing alone does not send a message or prove the recipient received it. Find issued letters on the Letter dashboard. To revise an issued letter, duplicate it into a new draft. Cloud workspaces require the Letter migration and access to the Letter module."
    ],
    "moduleId": "letters"
  },
  {
    "id": "receipts",
    "category": "Finance & people",
    "title": "Issue a payment receipt",
    "to": "/payment-receipts",
    "summary": "Record the receipt and produce a PDF for the payer.",
    "steps": [
      "Create a receipt, choose the payer and enter the payment date, currency, amount, method and reference. Link a saved invoice when it belongs to that collection.",
      "Review the company details, bank details and document preview, then Save. A failed save keeps the current receipt open for correction or retry.",
      "Download PDF to produce the receipt, or use the document's sharing action. Review its status and the linked invoice balance before treating the payment as settled.",
      "A payment receipt records a payment; it does not charge a card or move money. Avoid entering the same collection again as a separate unrelated payment."
    ],
    "moduleId": "payment-receipts"
  },
  {
    "id": "bank-cheques",
    "category": "Finance & people",
    "title": "Bank details, reconciliation and cheques",
    "to": "/bank-accounts",
    "summary": "Keep payment instructions and recorded bank movements clear.",
    "steps": [
      "Add a bank account with its currency and country-specific account identifiers. Review these details before copying or sharing payment instructions.",
      "For reconciliation, upload a bank statement CSV with Date, Description and Amount, or Debit and Credit columns. Filey proposes matches by amount and nearby dates.",
      "Inspect matched and unmatched rows before confirming. Confirmation marks the selected recorded transactions as reconciled; it does not connect or authorize your bank account.",
      "Open Cheques to record a received or issued cheque with its number, party, amount, issue date and due date. Update its status only when the corresponding real-world event occurs.",
      "Saving bank details or a cheque is recordkeeping. Filey does not initiate a bank transfer or clear a cheque."
    ],
    "moduleId": "bank-accounts"
  },
  {
    "id": "delivery-declarations",
    "category": "Documents & data",
    "title": "Delivery documents and declarations",
    "to": "/delivery-challans",
    "summary": "Prepare supporting documents without changing their business purpose.",
    "steps": [
      "In Delivery, create the appropriate delivery, received-goods or return document. Enter the party, products, quantities, date and reference.",
      "Review its template and saved company details, then Save and download the PDF. Keep its status aligned with the actual delivery or return.",
      "Use Declaration Letter for a statement your company needs to issue. Review the recipient, reference, quantities, amount and editable body before saving or signing.",
      "A supporting document is separate from an invoice, stock adjustment or payment. Check the source records rather than assuming a PDF has completed those actions."
    ],
    "moduleId": "delivery-challans"
  },
  {
    "id": "communications",
    "category": "Integrations",
    "title": "Communication history and email templates",
    "to": "/comms",
    "summary": "Check outbound attempts and keep reusable wording safe.",
    "steps": [
      "Open Comms log to review Email, Calls or WhatsApp invoice jobs. This section is an outbound history, not an incoming email inbox.",
      "Choose Log a call to record who you contacted, direction, duration, outcome and notes. Logging a call does not dial a number.",
      "Email Templates stores reusable subjects and bodies. Create your own or explicitly choose Use starter templates; use the listed placeholders when preparing document messages.",
      "Wait for template saving to finish. If it fails, your entered text stays open so you can retry. A connection failure does not mean the saved templates have been deleted.",
      "A provider-accepted email or queued WhatsApp PDF is not proof of recipient delivery. Check the channel or provider's delivery result when that confirmation matters."
    ],
    "moduleId": "comms"
  },
  {
    "id": "follow-ups",
    "category": "Sales & CRM",
    "title": "Reminders, notes and marketing follow-up",
    "to": "/follow-ups",
    "summary": "Keep the next action attached to the right business contact.",
    "steps": [
      "In Follow-ups, choose the customer or supplier side, add a reminder and set its due date. Mark it complete only after the task has been done.",
      "Use customer or supplier notes for working context. The dashboard separates overdue, due-today and open reminders.",
      "In Marketing, review suggested contacts based on recorded trading history. Optional lookup and enrichment services require their own configured providers.",
      "Review the campaign recipients, exclusions and message before sending. A saved draft does not send a campaign; third-party messaging charges and quotas still apply."
    ],
    "moduleId": "follow-ups"
  },
  {
    "id": "projects-support",
    "category": "Projects & service",
    "title": "Deliver projects and resolve support tickets",
    "to": "/projects",
    "summary": "Connect customer work to tasks, deadlines, invoices and time entries.",
    "steps": [
      "Open Projects or Helpdesk from Service. Create a record, set its owner label and priority, and link a saved customer or invoice.",
      "Add checklist tasks and log work in minutes with its date and a note. Save changes commits the record, tasks, time entries and updates together.",
      "Projects move from planned to active, blocked or completed. Tickets move from open to in progress, waiting, resolved or closed. Archive retains the record and its history.",
      "The list defaults to open work. Change its status filter to see completed or archived records. Charts and exported rows use the saved records.",
      "If another window changes a record first, Filey rejects your stale save. Keep your text, reopen the latest version and apply the intended changes.",
      "Filey AI can read and save these records through the Service toolset. Its normal mode and capability checks still apply. Owner names do not grant access; records are currently private to the account. Local mode needs no new database setup. Cloud administrators must apply the work-items migration before these modules can save or synchronize there."
    ],
    "moduleId": "projects"
  },
  {
    "id": "local-editions",
    "category": "Getting started",
    "title": "Free offline Filey and optional cloud upgrades",
    "to": "/settings?section=datamode",
    "summary": "Use the full local app free after one verified account setup.",
    "steps": [
      "All core local modules, documents and invoices are free with no monthly cap. Local PDFs have no Filey branding. Your records stay on this device until you choose to transfer them.",
      "Create and verify a free Filey account online, then sign in on this device once. Later offline password access requires a remembered online password sign-in on this device.",
      "Use the same account if you later choose Pro or Ultra for paid cloud benefits. Paid upgrades are optional; a paid license is not required to use the local app. Manage plans and purchased-license activations in Billing & Subscription and Devices.",
      "Hosted cloud quotas and provider charges are separate. Free local software does not include unlimited hosted email, SMS, or external AI usage.",
      "In the desktop app, open Data & Storage to create a full database-and-files backup. The separate summary export is not a complete restorable backup."
    ],
    "moduleId": "settings"
  },
  {
    "id": "start",
    "category": "Getting started",
    "title": "Set up your business",
    "to": "/settings?section=company",
    "summary": "Choose storage, save your company identity and prepare a first draft without sending it.",
    "steps": [
      "Confirm the storage badge before entering business records. Local keeps records on this device; cloud uses your signed-in workspace. Change storage only through Settings → Data & Storage and review its transfer confirmation.",
      "In Company Details, save your company name, address, contact details and Business country. Add your own applicable tax and legal registration identifiers; the country and display currency are separate choices.",
      "Review the new-document currency, tax rate, template and numbering defaults. Add only company logo, letterhead, signature and stamp assets you are authorized to use. Defaults do not rewrite previously saved documents.",
      "Add a customer in Customers and, if needed, a supplier and products. Review the legal name, address, tax identifier and opening balance labels before saving a contact.",
      "Create a draft invoice with one sample line, quantity, unit and price. Review tax, discount, dates and company details in Preview. For UAE electronic invoicing use Check e-invoice to identify required details.",
      "Choose Save and confirm the draft appears in Invoicing before using it with customers. A guide, preview or saved draft sends no message. Review your backup options before a large import or moving devices."
    ],
    "stepTitles": [
      "Choose where records live",
      "Save company details",
      "Review document defaults",
      "Add your business contacts",
      "Prepare a first draft",
      "Verify the saved result"
    ],
    "moduleId": "settings",
    "targets": [
      "",
      "company-identity",
      "",
      "",
      "",
      ""
    ]
  },
  {
    "id": "login",
    "category": "Getting started",
    "title": "Password, one-time codes and recovery",
    "to": "/settings?section=security",
    "summary": "Sign in, recover access and set a password.",
    "steps": [
      "Use your account email and password. Passwords are case-sensitive; the show-password button lets you check what you entered.",
      "New passwords need at least eight characters. Sign-in accepts older passwords without applying the new-account strength policy.",
      "Choose Forgot password? on the sign-in screen and request a reset link. Filey sends it through Resend. Open the link, enter your new password twice, and submit. Your old password is not required.",
      "If you enabled two-step verification, enter your authenticator code to finish. After the password is saved, return to sign in. Reset links expire and can be used once; request a fresh link when needed.",
      "Password recovery needs an internet connection in both local and cloud modes. It preserves your business records and refreshes the offline password only for the matching remembered account on this device.",
      "An offline desktop device must first be linked online. A device claimed only by OTP needs one successful online password sign-in before password-based offline access works."
    ],
    "moduleId": "settings"
  },
  {
    "id": "crm",
    "category": "Sales & CRM",
    "title": "From lead to customer",
    "to": "/crm",
    "summary": "Keep companies, contacts and opportunities connected.",
    "steps": [
      "Capture a lead with its company, contact information and source. Add a task for the next step.",
      "Open the lead and choose Convert. Filey creates a linked company, contact and deal. Repeating a cloud conversion returns the same deal.",
      "Use Deals to change stage, expected close date and probability. Board moves use the stage's default probability.",
      "Attach notes, tasks and activities to records. Company and contact detail views show their related records.",
      "Use Reports to inspect pipeline and forecasts. Forecasts are estimates based on deal values and probabilities, not received cash."
    ],
    "moduleId": "crm"
  },
  {
    "id": "invoices",
    "category": "Sales & CRM",
    "title": "Create and collect an invoice",
    "to": "/invoicing",
    "summary": "Draft, review, send and record payment.",
    "steps": [
      "Create an invoice and select the customer. Select saved products when you want document lines linked to inventory. Check copied contact details, issue date, due date, tax country and currency.",
      "Enter quantities, units, prices, tax and discounts. For a custom calculation such as total litres, choose the intended multiplication fields and compare the displayed line amount with your calculation. Review the live document preview.",
      "Choose Check e-invoice in the main toolbar. Review Invoice, Seller, Buyer, Items and Tax & payment, then use Edit beside a missing detail to fix it. Use your business’s own FTA-issued TIN for its electronic address, separate from the VAT TRN; a tax group’s representative TRN must not replace a member’s own identity. Changes stay in your draft until you save.",
      "Review every preview page, payment instructions, notes and final total. Checking and exporting supported UAE PINT-AE XML is free. A validated export is not a submitted or government-approved invoice: network submission requires a configured accredited provider. Unsupported complex transaction types are blocked from export.",
      "Save the draft and confirm it appears in Invoicing, then download PDF or use the saved document’s email or sharing action. Verify the recipient and attachment before sending. Saving a draft or opening a message does not send it, and a provider accepting a send is not proof of delivery.",
      "Record a payment against the invoice only when money is received. Check its remaining balance and Payment Receipts, then review Accounting and Reports. A sales value and a cash receipt are different measures; avoid recording the same collection twice."
    ],
    "stepTitles": [
      "Choose the customer",
      "Calculate the lines",
      "Check electronic-invoice details",
      "Review the preview",
      "Save before sharing",
      "Record and verify payment"
    ],
    "moduleId": "invoicing",
    "targets": [
      "invoice-customer",
      "invoice-items",
      "invoice-einvoice",
      "invoice-preview",
      "invoice-save",
      ""
    ]
  },
  {
    "id": "invoice-messages",
    "category": "Sales & CRM",
    "title": "Send invoices through WhatsApp or Messages",
    "to": "/invoicing",
    "summary": "Review the recipient and share the saved invoice PDF without an API key.",
    "steps": [
      "From an invoice row, choose Send → WhatsApp or SMS. The editor also has WhatsApp and Messages buttons that save before preparing the document.",
      "Check the international phone number and message. Wait for the PDF filename and size to appear. Preparation does not send anything.",
      "Use Share PDF on a supported device and select a messaging app and recipient. Otherwise download the PDF, open the WhatsApp draft and attach the file yourself.",
      "For direct PDF sending in the desktop app, pair WhatsApp under Integrations. Send PDF via paired WhatsApp queues the document; check WhatsApp itself for delivery.",
      "SMS opens your device's messaging app with text and an optional invoice link. SMS does not attach PDFs and carrier charges may apply. A compatible messaging app must be installed.",
      "A hosted cloud app can offer Add invoice link. Anyone with that link can view the invoice. Local mode shares the PDF; localhost links would not work for recipients."
    ],
    "moduleId": "invoicing"
  },
  {
    "id": "quotes",
    "category": "Sales & CRM",
    "title": "Quotation to invoice",
    "to": "/quoting",
    "summary": "Keep accepted work connected to the final sale.",
    "steps": [
      "Create a quotation with a customer, line items, validity date and terms.",
      "Review discounts and tax for each line, then save and share the quotation.",
      "Use the quotation's conversion action to create an invoice. Review the new invoice before sending.",
      "Use record links to follow the relationship between the quotation, customer and invoice."
    ],
    "moduleId": "quoting"
  },
  {
    "id": "purchasing",
    "category": "Purchases & stock",
    "title": "Purchase orders and receiving",
    "to": "/purchase-orders",
    "summary": "Buy from suppliers and receive linked stock.",
    "steps": [
      "Choose a saved supplier and products, then enter quantities, unit costs and the expected date.",
      "Review the purchase order and save it as a draft. A draft does not mean goods have arrived.",
      "Receive the purchase order when goods arrive. Linked product quantities increase and accounting records reflect the received purchase.",
      "Receiving the same purchase order again must not add the stock twice. For corrections, check the original receipt and inventory movements before entering an adjustment.",
      "Supplier invoices are available separately under Purchase. Avoid recording the same business event twice."
    ],
    "moduleId": "purchase-orders"
  },
  {
    "id": "inventory",
    "category": "Purchases & stock",
    "title": "Products, stock and reorder levels",
    "to": "/inventory",
    "summary": "Track quantities and explain each movement.",
    "steps": [
      "Create products with a unique SKU, unit, selling price, cost and reorder level. Link a supplier when possible.",
      "Use stock entries for goods in, goods out or a signed adjustment. Decimal quantities are supported for measures such as litres and kilograms.",
      "Add a reference and note so the next person understands the movement.",
      "Review movement history before correcting stock. Negative stock indicates an outstanding quantity; it should not be hidden by resetting it to zero.",
      "Use low-stock replenishment to prepare purchase-order drafts, then review their quantities before ordering."
    ],
    "moduleId": "inventory"
  },
  {
    "id": "accounting",
    "category": "Finance & people",
    "title": "Accounting and reconciliation",
    "to": "/accounting",
    "summary": "Check records against the actual money movement.",
    "steps": [
      "Review accounts, expenses and transactions in Accounting. Keep descriptions and dates meaningful.",
      "Use Payment Receipts for customer collections and keep them linked to invoices where applicable.",
      "Compare bank statements with recorded transactions before marking entries reconciled.",
      "Use Reports for the trial balance, balance sheet and period comparisons. Review source records when a figure appears wrong."
    ],
    "moduleId": "accounting"
  },
  {
    "id": "people",
    "category": "Finance & people",
    "title": "Employees, attendance and payroll",
    "to": "/people",
    "summary": "Keep employee records and payroll periods consistent.",
    "steps": [
      "Add employees with department, hire date and salary information.",
      "Record attendance for the correct day and employee.",
      "Prepare payroll for the intended period and review allowances, deductions and net pay before marking it paid.",
      "Complete the required bank and employee identifiers before exporting a WPS file."
    ],
    "moduleId": "people"
  },
  {
    "id": "ai-setup",
    "category": "Filey AI",
    "title": "Local AI, free tiers and your own keys",
    "to": "/settings?section=ai",
    "summary": "Use Filey AI with Coin, connect your own provider, or run a downloaded model locally.",
    "steps": [
      "Open Settings → AI Assistant and choose your AI payment method. Filey AI uses your account’s Coin balance; your own API key or local model uses its own connection. Filey does not automatically spend Coin if your personal connection fails.",
      "For Filey AI, open Coin wallet and confirm your available balance. New reasoning settings start at Fast with reasoning off. In the chat composer, use the effort slider or Advanced → Reasoning when a more complex task needs additional reasoning.",
      "For local inference install Ollama or LM Studio, download a model that fits your computer and start its local server. Select the preset, use Find local models and choose its model ID. Ollama needs no key; LM Studio uses a token only if you enabled authentication. A cloud-backed model behind a local server can still send data online.",
      "For your own hosted connection, get a key from your provider, enter its endpoint and select a model with tool calling for business actions and vision for document images. Filey supports OpenAI-compatible Chat Completions and Anthropic Messages endpoints. Provider charges, region availability and model licenses remain separate.",
      "Desktop API keys are kept in the operating system's credential store for your signed-in account and workspace. Web and mobile keys stay in memory until the page reloads; enter them again after reloading. Keys belong to the selected endpoint origin; changing providers does not send another provider’s key to the new endpoint. No shared provider key is bundled with these presets.",
      "Save your connection and use Test connection only when you are ready for a short provider greeting. It does not read or change business records and cannot prove every model capability. Cloud/local record mode and AI inference are independent; use a downloaded model and disable online capabilities when you want a run to stay offline."
    ],
    "moduleId": "settings"
  },
  {
    "id": "agent",
    "category": "Filey AI",
    "title": "Work across Filey with the agent",
    "to": "/agent",
    "summary": "Prepare records quickly, control reasoning and verify what the agent actually saved.",
    "steps": [
      "Choose Filey AI with Coin, your own provider, or a local model in Settings → AI Assistant, then open Filey AI. Business actions need a tool-capable connection and the permissions of your current workspace.",
      "Choose a conversation starter to prepare an editable prompt, or name the party and provide the item, quantity, currency and rate. Example: Create a draft invoice for Acme, 2 pumps at AED 350 each. A starter does not send an AI request until you press Send.",
      "Use Fast for everyday work; it starts with reasoning off for new settings. Move the effort slider or use Advanced → Reasoning to enable Low, High or Maximum reasoning for a difficult task. More reasoning can take longer; a clear instruction still needs valid fields and an actual saved result.",
      "Choose an action mode before the request: Accept edits prepares records while asking before sensitive actions, Manual asks before writes, Plan prevents writes, and Auto uses permissions you granted. Capabilities, module access and workspace roles still restrict every mode.",
      "Review the answer and open the corresponding saved record. CRM tools use returned IDs to link child records. If a save cannot be confirmed, inspect Filey before repeating it; a failed or incomplete response is not proof that nothing changed.",
      "You may navigate to another Filey section while the mounted chat continues. Keep the app or browser available: a closed page or a suspended connection has different limits. Stop ends further work where possible, but cannot undo accepted writes or provider usage. Use conversation history to resume, rename or export a chat; finish or stop the current reply before switching chats."
    ],
    "moduleId": "agent"
  },
  {
    "id": "browser",
    "category": "Filey AI",
    "title": "Use business websites with Filey AI",
    "to": "/browser",
    "summary": "Open Instagram, WhatsApp and other websites in the Windows app.",
    "steps": [
      "Use the browser icon in Filey AI. It opens a collapsible browser panel beside the conversation. Use its address bar, website shortcuts and tabs in the Windows desktop app.",
      "Interactive browsing requires the installed Windows app. The web and mobile versions show the browser panel's availability message; they cannot control another browser tab.",
      "Sign in to the website yourself. Site logins stay on this device with your Filey account and company, including across local/cloud switching. Changing workspace closes the windows without deleting that profile's cookies.",
      "In Filey AI, enable temporary Computer access and describe the task. The model needs vision and tool support. It can open windows, inspect screenshots and interact with the visible page while access is active.",
      "Review the selected account, recipient and content before publishing or sending. Opening a site or a message draft does not complete the action. You handle passwords, CAPTCHA and site permissions.",
      "Some sites restrict embedded browsers or need popup login flows. Filey shows blocked popup and download notices. Use your regular browser when a site requires it; no authentication or platform restrictions are bypassed. For invoices, paired WhatsApp sends the actual PDF. Prepare WhatsApp + PDF saves the file and opens an unsent draft; attach the saved PDF and verify the result before treating it as sent."
    ],
    "moduleId": "browser"
  },
  {
    "id": "file-tools",
    "category": "Workflows",
    "title": "Convert, unlock and prepare files",
    "to": "/tools",
    "summary": "Create a new file on your device, download it or continue with another tool.",
    "steps": [
      "Open Tools and search for the task, such as merge, compress, OCR or Remove PDF Password. Each tool shows its accepted file types and whether it needs one file or several.",
      "Choose files from your device or drag them into the tool. Review Tool settings before running. Tools with a page editor let you adjust the document first; your original file stays unchanged.",
      "To remove a PDF password, choose Remove PDF Password, add the protected PDF and enter its current password. Run the tool to create a copy that opens without the password. An incorrect password leaves the original protected.",
      "When Your files are ready appears, choose Download results for every output or Download beside an individual file. Results remain available while you stay in that tool.",
      "To continue working, search the Next tool menu and choose Continue. Filey passes the generated files directly into the selected tool. Adjust again returns to the current tool's settings.",
      "If a conversion fails, correct the settings or replace the input and run it again. Large or unsupported HEIC photos may need exporting as JPEG or PNG first. Cancel stops supported long-running conversions. OCR and table extraction need a clear source. Office conversions preserve supported content rather than the complete original layout. Redaction and sanitization create rasterized pages; keep the original if you also need selectable text."
    ],
    "moduleId": "tools"
  },
  {
    "id": "free-work-tools",
    "category": "Integrations",
    "title": "Free work tools and your own keys",
    "to": "/integrations?tab=services",
    "summary": "Use keyless public data and understand optional provider setup.",
    "steps": [
      "In Integrations → Free work tools, choose Market facts, Public holidays or Creative assets. Lookups send the entered country, year or public search phrase; they do not change business records.",
      "Market facts include the World Bank observation year. Holidays cover only supported countries and label regional dates. Image results carry source and licence information; keep required attribution when using them.",
      "Ask Filey AI for the same data during research or marketing preparation. A local model can use these online tools, so local inference does not mean every enabled tool is offline.",
      "The catalogue distinguishes local tools, keyless APIs, limited free tiers and providers requiring your account. Provider setup links lead to official sites; Filey does not create or share provider credentials.",
      "Bring your own supported AI, web-research or social-provider key through its setup page. Local Resend keys belong in Settings → Email; hosted cloud sender keys belong in server configuration. Paid quotas and account authorization remain the provider's responsibility."
    ],
    "moduleId": "integrations"
  },
  {
    "id": "skills",
    "category": "Filey AI",
    "title": "Memory, skills and web research",
    "to": "/agent",
    "summary": "Extend the agent deliberately.",
    "steps": [
      "Open Filey AI and review its capability controls before running a task. Enable only the tools it needs; disabled capabilities refuse the action instead of running it.",
      "Use conversation options to review Memory and saved procedures. Reusable skills are instructions and context, not model retraining. Check their content before letting the agent use them with business records.",
      "Enable Web research in Integrations to read public pages within Jina’s keyless limits. Web search requires your own Jina key; provider charges and website restrictions still apply. A local model can use enabled online tools.",
      "Connect external apps only after provider setup and authorization succeed. Document, webpage and message content cannot grant permission to send messages or move money."
    ],
    "moduleId": "agent"
  },
  {
    "id": "charts",
    "category": "Troubleshooting",
    "title": "Read and troubleshoot charts",
    "to": "/reports",
    "summary": "Charts are calculated from your records.",
    "steps": [
      "Open Reports → Insights and choose a section to explore its record counts and monthly trends. Section insights are collected here.",
      "Overview shows invoiced amounts, confirmed payment receipts and expenses for the last 7, 30 or 90 days. Invoice trends include sent, paid and overdue invoices, while receipt trends include paid receipts on their payment dates.",
      "Empty data shows an empty state. Creating a record without the relevant date will not add a point to a date chart.",
      "Use the chart tooltip and available chart-data table to compare exact values. Export chart CSV for further analysis.",
      "The selected display currency applies to money charts. Invoice payments and separate payment receipts are different records; confirmed receipt totals cover payment receipts only.",
      "If loading fails, use Refresh or retry the page. A failed first database read is shown as an error, rather than an empty business."
    ],
    "moduleId": "reports"
  },
  {
    "id": "email",
    "category": "Integrations",
    "title": "Email with Resend",
    "to": "/settings?section=email",
    "summary": "Use your own Resend connection locally or your workspace’s configured cloud sender.",
    "steps": [
      "Open Settings → Email and check whether records are in local or cloud mode. Local mode uses Personal email with your own Resend account on supported app runtimes; the ordinary web browser shows an availability message where direct sending is not supported.",
      "For local email, create a sending-access Resend key, verify your sender domain with Resend and save the key, sender email and optional sender name in Personal email. Desktop keys use the account/workspace device vault; other supported runtimes keep the key in session memory. Filey does not upload your local communication history to its cloud.",
      "For cloud email, the workspace administrator configures RESEND_API_KEY and EMAIL_FROM as Supabase secrets and deploys send-email. Never put that secret in a browser build. Supabase Auth SMTP for sign-in and recovery email is configured separately.",
      "Use Check saved setup or Check connection to review configuration without sending a message. A local check does not verify the key with Resend; Resend verifies the key and sender during a real send. Configure the sender before testing delivery to a customer.",
      "Use the invoice or quotation’s email action, review the recipient, subject, message and saved PDF, and send only when ready. Resend receives the selected message and attachments; its quotas and charges apply. Filey never silently switches a failed personal connection to its hosted sender.",
      "Inspect Comms log and the provider’s delivery or bounce information. A successful API send means the provider accepted it, not that it reached the inbox. Avoid repeating an uncertain send until you have checked the original attempt."
    ],
    "moduleId": "settings"
  },
  {
    "id": "integrations",
    "category": "Integrations",
    "title": "Connect apps and messaging channels",
    "to": "/integrations",
    "summary": "All connections live in one section.",
    "steps": [
      "Use App directory to find an integration. Provider setup holds optional provider credentials. Built-in connections contains Connect WhatsApp in the installed desktop app.",
      "Authorize connected apps in the provider's browser window, then refresh connection status. Missing provider setup is different from being signed out of Filey.",
      "Built-in connections include public reference rates, manual WhatsApp and Telegram links, calendar export and Resend email status.",
      "Contact chat links open your own messaging account. Automated bots require their own administrator setup and credentials.",
      "The core CRM needs no enrichment subscription. Optional third-party services have their own pricing, quotas and permissions."
    ],
    "moduleId": "integrations"
  },
  {
    "id": "files",
    "category": "Documents & data",
    "title": "Organise and share saved files",
    "to": "/files",
    "summary": "Keep saved documents in the right folder and review them before sharing.",
    "steps": [
      "Open My Files in the intended account, workspace and storage mode. Use Upload to select a file and wait for confirmation; choosing a file alone does not complete an upload.",
      "Create a named folder and open it to organise documents. Drag files or folders to move them, or use the file’s Move action; check the destination after the saved change.",
      "Search by name or use the available tool filters. Open a file to review its preview and Download to keep a copy on your device; downloading does not move or delete the saved original.",
      "Review the chosen file and intended recipient before sharing. Cloud Share creates a link valid for seven days; anyone who has it can access that file during that period. Use Download for a local copy. Copying a link does not send it or prove someone opened it.",
      "Rename or delete only through the intended file’s action. Confirm deletion carefully and keep a copy you need. My Files records are separate from the invoice, letter or other source business record."
    ],
    "moduleId": "files"
  },
  {
    "id": "storage",
    "category": "Documents & data",
    "title": "Cloud, offline mode and backups",
    "to": "/settings?section=datamode",
    "summary": "Know where the active workspace is stored.",
    "steps": [
      "Cloud mode uses your signed-in account and workspace permissions. Local mode stores business records on the device.",
      "In Settings → Data & Storage, turn Store in my Filey account on to upload this device's pending changes before continuing in Filey Cloud. If an edited record differs in both places, this switch keeps the device's edited version; cloud-only records remain.",
      "Turn the switch off to save the latest cloud records and files on this device before working locally. Switching needs a connection to finish the transfer. The destination opens only after the transfer succeeds.",
      "Cloud saves require connectivity. Local saves stay on your device even while online. A verified account stores your login identity; turning on cloud storage explicitly uploads your workspace after confirmation. Sending email or using an AI provider is a separate action that sends the content you select.",
      "The storage badge identifies the active store. If a transfer cannot finish, Filey keeps the current store open and offers Try again. Your account stays signed in; other open tabs pause until reloaded.",
      "Export a backup before moving devices or making a large import. Keep backup files in a location you control. When reporting a problem, include the section, action, error message and whether it happened in cloud or local mode. Do not include passwords or API keys."
    ],
    "moduleId": "settings"
  },
  {
    "id": "overview",
    "category": "Business",
    "title": "Read your business overview",
    "to": "/overview-modern",
    "summary": "Understand the snapshot and follow a figure back to its records.",
    "steps": [
      "Confirm the current account, workspace and storage badge. Overview reads the records available in that workspace; it does not create transactions.",
      "Review Invoiced sales, Orders, Customers and Outstanding. Open the relevant section from a metric when you need the underlying records, rather than treating the headline as a bank balance.",
      "Choose the 7, 30 or 90 day chart range. Invoice series use issue dates; payment sources use payment dates. Invoice payments and separate receipt documents can describe the same collection, so do not add those series together.",
      "Use chart tooltips and available data tables for exact values. Compare source currencies and saved exchange rates before interpreting displayed totals.",
      "If the snapshot looks wrong, inspect the underlying document status, date and currency. Empty data and a failed read are different states; use the shown refresh or retry action for a loading failure."
    ],
    "moduleId": "overview"
  },
  {
    "id": "reports",
    "category": "Business",
    "title": "Choose and verify a report",
    "to": "/reports",
    "summary": "Use saved records to investigate sales, inventory and finance.",
    "steps": [
      "Choose Dashboard, Sales, Inventory, Financial, Customers, Suppliers or Insights. Each tab answers a different question about the current workspace.",
      "Review the report’s date scope, currency and included document statuses. Sales, outstanding amounts, inventory value and received money are different measures.",
      "Use available chart tooltips and tables to inspect the underlying values. Open the related source section when you need to correct a record.",
      "Export the tab’s CSV only after its data loads successfully. Inspect the downloaded columns and keep the file private; exporting does not change any business record.",
      "Use Insights for section trends and source records for decisions. If data cannot be loaded, refresh or retry rather than treating a blank report as a zero balance."
    ],
    "moduleId": "reports"
  },
  {
    "id": "suppliers",
    "category": "Purchases & stock",
    "title": "Set up and review a supplier",
    "to": "/suppliers",
    "summary": "Keep supplier identity, payable history and document references consistent.",
    "steps": [
      "Choose New supplier and enter its legal name, contact person, email, phone, address and applicable tax identifier. Add useful notes, then save and confirm the supplier is listed.",
      "Search or sort the directory and open Quick view to verify contact details. Use the export action for a CSV copy; the list’s open balance is derived from purchase orders and their recorded payments.",
      "Select the saved supplier in purchase orders and purchase invoices, then check the copied identity. Later directory edits do not rewrite previously saved documents.",
      "Open the supplier detail page for linked records, payments, notes and Statement of Account. Compare its recorded balance with your supporting documents before correcting it.",
      "Saving a supplier does not invite it to your workspace, send email or transfer money. Send messages only through an explicit reviewed action."
    ],
    "moduleId": "suppliers"
  },
  {
    "id": "purchase",
    "category": "Purchases & stock",
    "title": "Log and verify an expense",
    "to": "/purchase",
    "summary": "Keep the purchase details, payment account and supporting receipt together.",
    "steps": [
      "In Purchase choose Log expense. Select the supplier when relevant and enter the date, category, currency and a useful description.",
      "Add the bought items, quantities and unit prices. Review the subtotal, discount, tax and Total paid; foreign-currency expenses require the receipt’s saved exchange rate to AED.",
      "Choose Payment method and Paid from account, then optionally attach a receipt. In cloud mode the selected receipt uploads privately when saved; local records and their supporting file stay on the device.",
      "Choose Save expense and verify the new entry appears in Purchase. Open its details to review the saved lines and receipt; a download or preview alone does not record the expense.",
      "Compare the account transaction and source receipt before logging a similar expense. An uncertain save may already have committed, so check the original record before repeating it."
    ],
    "moduleId": "purchase"
  },
  {
    "id": "supplier-invoices",
    "category": "Purchases & stock",
    "title": "Record a supplier invoice",
    "to": "/purchase-invoices",
    "summary": "Keep a supplier bill separate from ordering, receiving and payment.",
    "steps": [
      "Open Purchase Invoices, create the document and select the supplier. Copy the supplier’s reference, invoice date, currency and applicable tax information from its bill.",
      "Enter the supplied items, quantities, units, prices, discounts and tax. Check copied supplier details and totals against the original invoice.",
      "Review the document template and preview, then Save. Confirm the document appears in Purchase Invoices before using its record actions.",
      "Use its available payment actions to record an actual payment, and inspect the remaining balance. Saving the supplier invoice does not make a bank transfer.",
      "Compare any related purchase order, received-stock event and logged expense before recording the bill. Avoid treating several documents for the same business event as several separate purchases."
    ],
    "moduleId": "purchase-invoices"
  },
  {
    "id": "marketing",
    "category": "Sales & CRM",
    "title": "Prepare a marketing follow-up",
    "to": "/marketing",
    "summary": "Review leads, campaigns and opt-outs before contacting anyone.",
    "steps": [
      "Review Leads and their recorded trading history. Filter or search the list to find the relevant contacts; a suggested lead is not a verified new customer.",
      "Optional lookup or enrichment uses the configured provider. Review its returned fields and source before explicitly saving them to a contact.",
      "Open Campaigns and prepare the intended audience and message. Check exclusions and Opt-outs so you do not contact an excluded recipient.",
      "Review the channel connection, recipient list and message before an explicit send. Saving a draft or exporting CSV does not send a campaign.",
      "Check the send attempt and channel results after sending. Provider limits and charges apply; acceptance or queueing does not prove recipient delivery."
    ],
    "moduleId": "marketing"
  },
  {
    "id": "cheques",
    "category": "Finance & people",
    "title": "Track a cheque through its real status",
    "to": "/cheques",
    "summary": "Record issued or received cheques without implying a bank transfer.",
    "steps": [
      "Choose New cheque and select issued or received. Enter the cheque number, party, bank and amount in AED; this register currently records AED amounts.",
      "Check issue date and due date against the cheque, then create or save the record. Optionally attach its scan and verify the saved amount in the register.",
      "Keep the status pending until the real event is known, then mark cleared, bounced or cancelled as appropriate. A future due date alone does not prove clearance.",
      "Review any linked accounting entries and payment records before correcting the cheque. Recording or changing its status does not authorize your bank to move money."
    ],
    "moduleId": "cheques"
  },
  {
    "id": "declaration",
    "category": "Documents & data",
    "title": "Prepare a declaration letter",
    "to": "/declaration",
    "summary": "Review the statement and supporting references before issuing a copy.",
    "steps": [
      "Create a declaration and enter its recipient, date and applicable reference. Select the relevant company details and document layout.",
      "Review the quantities, amount and editable declaration body against your source records. Replace sample wording with the company’s intended statement.",
      "Check the signature, stamp and each preview page. Use only assets your company authorizes, then Save and confirm the declaration is listed.",
      "Download or explicitly share the PDF after checking the recipient. Saving a declaration does not send it or change an invoice, inventory movement or payment."
    ],
    "moduleId": "declaration"
  },
  {
    "id": "helpdesk",
    "category": "Projects & service",
    "title": "Track a support ticket",
    "to": "/helpdesk",
    "summary": "Keep the customer issue, tasks, time and resolution history together.",
    "steps": [
      "Create a ticket, describe the issue and select a priority and owner label. Link the saved customer or invoice when helpful.",
      "Add a checklist and log work minutes with a date and note. Save changes to commit the ticket and its associated work together.",
      "Move the ticket through open, in progress, waiting, resolved or closed only as work progresses. Owner labels do not grant access or send assignment notifications.",
      "Change the list filter to see completed or archived work. Archive keeps the ticket’s history; reports and exports use the saved records.",
      "If a stale save is rejected because another window changed the ticket, keep your text, reopen the latest record and apply the intended changes. These records are currently private to the account; cloud setup needs the work-items migration."
    ],
    "moduleId": "helpdesk"
  },
  {
    "id": "team",
    "category": "Team & communication",
    "title": "Chat with your team",
    "to": "/team",
    "summary": "Find a teammate or choose a channel in the right cloud workspace.",
    "steps": [
      "Open the cloud workspace you intend to use. Direct teammate messages require cloud mode; local mode shows the availability message instead of pretending those messages are shared.",
      "In Chats, search for and select the teammate. If none appear, review invitations and accepted members in Settings → Teams.",
      "In Channels, select a channel or use New channel to name one. Check the channel name or recipient in the conversation header before composing.",
      "Write the message and use the chat’s explicit send action. Check for a saved message or an error; typing a draft does not send it.",
      "Use unread indicators to find new messages. On phones use the conversation’s back control to return to the people or channel list. Workspace access still controls which conversations are available."
    ],
    "moduleId": "team"
  },
  {
    "id": "email-templates",
    "category": "Team & communication",
    "title": "Make a reusable email template",
    "to": "/email-templates",
    "summary": "Save reviewed wording without sending a message.",
    "steps": [
      "Create a template with a useful name and the intended subject and body, or explicitly choose Use starter templates.",
      "Use only the supported placeholders listed in the editor. Check the wording for the intended document and remove unfinished sample instructions.",
      "Save the template and wait for confirmation. On failure keep the entered text open and correct the issue; a connection failure does not mean previously saved templates were deleted.",
      "Choose the template when preparing a document email, then review the actual substituted values and recipient before sending. Saving a template sends nothing."
    ],
    "moduleId": "email-templates"
  },
  {
    "id": "coin",
    "category": "Filey AI",
    "title": "Add Coin and verify your balance",
    "to": "/settings?section=credits",
    "summary": "Use an optional account wallet for Filey AI without confusing it with a subscription.",
    "steps": [
      "Open Coin wallet and refresh your available balance and Activity. Coin belongs to the signed-in account and is separate from the Basic, Pro or Ultra plan.",
      "Choose Quick recharge, a listed amount or an available custom amount. Review the Coin amount, service fee, any eligible discount and total before continuing to secure payment.",
      "Complete checkout only when the reviewed amount is correct, then return to Filey for payment verification. A redirect or a payment screen alone is not credited balance; confirm the successful top-up in the wallet and Activity.",
      "Choose Filey AI as the AI payment method. Requests deduct Coin for work performed; if credit is insufficient, add Coin before starting another paid request. No automatic recharge or subscription is created by a top-up.",
      "Coin cannot be withdrawn or exchanged for cash. Top-ups are final and non-refundable except where required by law; paid Coin does not expire. A stopped request can still use Coin for work already performed.",
      "Use your own provider key for separate image, video, voice or external services when required. Filey currently has no included video-generation model; those provider costs are separate from Filey AI chat."
    ],
    "moduleId": "settings"
  },
  {
    "id": "chat-history",
    "category": "Filey AI",
    "title": "Keep, find and recover a conversation",
    "to": "/agent",
    "summary": "Return to a saved chat without discarding unfinished work.",
    "steps": [
      "Use chat history to find a conversation by its title or message text. Finish or Stop a running reply before choosing a different conversation.",
      "Conversation options lets you rename the active chat. A manual name stays unchanged as new messages arrive; Use automatic title restores a title derived from the conversation.",
      "Export conversation to save a plain-text copy on your device. Keep exports private; exporting a chat does not export every generated attachment or change business records.",
      "Confirm Delete conversation only when you want to remove that device’s chat history entry. Deleting a conversation does not delete invoices, payments or other records the agent created.",
      "If history cannot save, export the current conversation before closing Filey. Recover history is explicit: it keeps an original backup on the device before replacing damaged entries with readable ones. Storage failures keep the original unchanged.",
      "History is scoped to this account, workspace and storage mode. Desktop/native output references can survive; browser download links belong to the current page and are released on workspace changes or reload."
    ],
    "moduleId": "agent"
  },
  {
    "id": "company-details",
    "category": "Workspace setup",
    "title": "Save your company and document identity",
    "to": "/settings?section=company",
    "summary": "Review defaults and company assets before they appear on new documents.",
    "steps": [
      "Complete Company name, address and contact details. Review the spelling and contact information that should appear on new documents; leave the final save until the remaining sections are checked.",
      "Choose Business country and review its tax labels and default rate. Enter your applicable legal and tax identifiers. Display currency does not select the tax country; new documents keep their saved country, rate and currency.",
      "For supported UAE electronic invoices, complete Electronic invoicing identity using the company’s own identifiers. Keep TIN and VAT TRN separate and use the invoice’s Check e-invoice results to review required details.",
      "Review Document Presets and numbering. Add authorized company logo, letterhead, stamp or signature assets, then check them in an actual document preview. Defaults do not rewrite previously saved documents.",
      "Complete Bank Details with the payment instructions you want on documents. Check the account holder, bank name and applicable account identifiers against your bank’s details; preview their placement before sharing an invoice.",
      "Choose Save Changes and wait for the result. If company details save but a bank or asset section fails, correct the reported section before relying on it. Confirm the saved defaults in a new document draft; saving setup does not send a document or transfer money."
    ],
    "moduleId": "settings",
    "stepTitles": [
      "Review company identity",
      "Choose country and tax defaults",
      "Review electronic-invoice identity",
      "Set document defaults and assets",
      "Check bank details",
      "Save and verify setup"
    ],
    "targets": [
      "company-identity",
      "company-country",
      "",
      "",
      "company-bank",
      "company-save"
    ]
  },
  {
    "id": "account-setup",
    "category": "Workspace setup",
    "title": "Update your account and profile",
    "to": "/settings?section=account",
    "summary": "Manage your display identity separately from company and document details.",
    "steps": [
      "Review Profile Information and edit your permitted name and phone fields. Use the avatar picker for a photo or a supported shape and colour.",
      "Review language, timezone, date format and time format preferences. These display choices do not alter the underlying amounts or dates saved in business records.",
      "Use the page’s save action and wait for confirmation. A selected avatar preview is not proof that the profile has saved.",
      "Use Login Credentials for an available email or password change flow and complete its verification. Keep codes private; verify the displayed account before confirming an identity change."
    ],
    "moduleId": "settings"
  },
  {
    "id": "workspace-team",
    "category": "Workspace setup",
    "title": "Invite teammates and review access",
    "to": "/settings?section=teams",
    "summary": "Set the workspace and permissions before starting shared work.",
    "steps": [
      "Confirm the signed-in cloud identity and active team workspace. Team membership is separate from a saved customer or supplier contact.",
      "If your role permits, create or select the intended workspace. Review its name before inviting people; switching workspace changes the records and conversations you access.",
      "Invite a teammate using the correct email, role and allowed access. Review module access before submitting; an invitation is an external action, not part of reading this guide.",
      "Have the recipient accept the invitation and inspect pending versus accepted members. An unsent or unaccepted invitation does not grant access.",
      "Use member access controls deliberately and verify the updated role. Owner/admin controls are permission-gated; a chat-only member does not automatically receive business-record access."
    ],
    "moduleId": "settings"
  },
  {
    "id": "apps-settings",
    "category": "Workspace setup",
    "title": "Choose the modules you need",
    "to": "/settings?section=apps",
    "summary": "Keep navigation useful without deleting existing records.",
    "steps": [
      "Open Apps & Modules and review the module descriptions. Core modules stay enabled; optional modules follow workspace configuration and your access.",
      "Turn on a module you intend to use, or turn off an optional section you do not need. Use Enable all only when you want the full available workspace.",
      "Wait for the saved state and confirm the section appears in navigation. A configuration or access failure should be corrected before assuming the module is available.",
      "Changing enabled modules changes access and navigation; it is not a document-delete action. Ask a workspace administrator when a section is disabled by permissions."
    ],
    "moduleId": "settings"
  },
  {
    "id": "appearance",
    "category": "Workspace setup",
    "title": "Choose a comfortable appearance",
    "to": "/settings?section=appearance",
    "summary": "Adjust theme, accents and assistant movement without changing documents.",
    "steps": [
      "Choose Light or Dark and check the workspace preview. The current screen changes immediately; print-document layouts keep their own styling.",
      "Select an accent colour for shared controls and charts. Red, green and other status colours continue to describe their existing business states.",
      "Adjust Smooth scrolling if useful. The system’s reduced-motion preference takes priority over decorative movement.",
      "Review the Filey AI look, colour and movement controls. These are appearance preferences, not changes to the AI model, billing or business records."
    ],
    "moduleId": "settings"
  },
  {
    "id": "preferences",
    "category": "Workspace setup",
    "title": "Review workspace preferences",
    "to": "/settings?section=preferences",
    "summary": "Distinguish document defaults from display choices.",
    "steps": [
      "Review the displayed currency, invoice template and default tax rate under Document defaults. Use Edit document defaults to change them in Company Details.",
      "Choose Rows per page for tables and the available workspace brand colour. Fields save when you leave them; inspect any reported failure before relying on the change.",
      "Check a list and a new-document draft after changing a default. Previously saved documents retain their saved values."
    ],
    "moduleId": "settings"
  },
  {
    "id": "billing",
    "category": "Workspace setup",
    "title": "Review your plan and payments",
    "to": "/settings?section=billing",
    "summary": "Keep cloud plan usage separate from free local workflows and AI Coin.",
    "steps": [
      "Review Current plan and Usage for the signed-in account. Local core workflows are free; hosted cloud allowances and optional plan benefits are separate.",
      "Compare the available plans and stated billing terms before choosing one. Review the checkout summary and total before making a payment.",
      "Return from checkout and wait for verification, then confirm the plan status. A checkout page or return redirect does not by itself prove activation.",
      "Use Coin wallet for Filey AI usage credits and Devices for eligible device slots. A Coin top-up does not upgrade a subscription, and a subscription is not unlimited external-provider usage."
    ],
    "moduleId": "settings"
  },
  {
    "id": "devices",
    "category": "Workspace setup",
    "title": "Review plan access on your devices",
    "to": "/settings?section=devices",
    "summary": "Use the account’s available device slots without affecting business data.",
    "steps": [
      "Sign in with the account that owns the purchased plan, then open Devices and wait for its status to load.",
      "Review the listed active devices and available slots. Use the shown device action to apply or restore eligible access on this installation.",
      "Remove an old device only when you intend to free its plan slot. This changes plan access; it does not transfer, back up or delete that device’s business records.",
      "Confirm the updated device status. Basic already includes local storage and core offline tools; eligible Ultra device benefits and offline activation are separate."
    ],
    "moduleId": "settings"
  },
  {
    "id": "security",
    "category": "Workspace setup",
    "title": "Protect your sign-in",
    "to": "/settings?section=security",
    "summary": "Complete verification before treating a security change as active.",
    "steps": [
      "Open Security while online with the intended account. Use Change Password and verify with your current password or a fresh email code; complete two-factor verification if requested.",
      "For Two-Factor Authentication, start setup, add the displayed secret to your authenticator and enter its current code to verify. Keep a safe copy of the secret before completing enrolment.",
      "Check the verified On/Off status after the operation. A displayed setup QR alone does not mean two-factor authentication is active.",
      "Use Forgot password on sign-in for recovery when needed. Active Sessions is currently marked unavailable; this guide does not promise session-management controls that are not implemented."
    ],
    "moduleId": "settings"
  },
  {
    "id": "notifications",
    "category": "Workspace setup",
    "title": "Choose your in-app reminders",
    "to": "/settings?section=notifications",
    "summary": "Control useful alerts while Filey is open.",
    "steps": [
      "Review Low-stock alerts, New order received, Quotation accepted and Weekly Reports reminder.",
      "Turn each option on or off and wait for the automatically saved workspace preference. Do not rely on a change if its save reports an error.",
      "Review notifications while Filey is open. The weekly option reminds you to review Reports when opening Filey on Monday; it is not an automatic emailed report.",
      "These preferences do not replace checking overdue records or channel delivery. They do not grant browser push permissions or schedule an external message."
    ],
    "moduleId": "settings"
  },
  {
    "id": "backups",
    "category": "Workspace setup",
    "title": "Choose the right backup or export",
    "to": "/settings?section=backup",
    "summary": "A summary export and a full restorable backup are different files.",
    "steps": [
      "Use Export summaries to download selected business data as JSON. It includes listed summaries, not every module, document line or attachment.",
      "Wait for the download result and inspect the saved file. A cancelled save or failed source read is not a completed export.",
      "For a full desktop backup, open Data & Storage. The full backup includes the local database and saved files; preserve its recovery information privately.",
      "Restore only through the supported desktop restore flow after reviewing its confirmation and keeping a current backup. Cloud disaster recovery uses the administrator’s Supabase database and Storage backups.",
      "Keep backup files somewhere you control. Exporting or watching this guide does not copy records to another workspace or prove a restore has succeeded."
    ],
    "moduleId": "settings"
  }
];
