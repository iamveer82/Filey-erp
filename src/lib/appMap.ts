/* The agent's map of Filey: every area of the app, the words people use for it, and the
 * tools that do the work there. One table drives three things:
 *  - APP MAP in the agent's prompt, so it knows where a request belongs and which tool to use
 *    ("payment voucher" is a Payment Receipt, never an invoice);
 *  - the tools offered on the first round (`toolsForRequest`), so the right one is already in
 *    hand instead of the model guessing from the core set;
 *  - tests that keep it complete: every section placed, every tool real, every phrase routed.
 * Static and local: it needs no network, so offline (local mode) agents get the same map. */

export interface AppArea {
  /** What users see: the section name in the sidebar, or the kind of work. */
  name: string;
  /** The section's page for open_page, when it has one. */
  page?: string;
  /** What it is for, in a few words, including the names people give it. */
  does: string;
  /** Words in a request that mean this area. Keep them specific: every match costs schema bytes. */
  words: RegExp;
  /** The tools that do the work, most used first. Empty: open the page and guide the user. */
  tools: string[];
}

export const APP_MAP: AppArea[] = [
  { name: "Invoicing", page: "invoicing", does: "tax invoices, proforma; send, PDF, mark paid",
    words: /\binvoic\w*|\bpro[- ]?forma\b|\bmark(?:ed)? (?:it |as )?paid\b|فاتور|فواتير/i,
    tools: ["create_invoice_draft", "revise_invoice", "list_invoices", "get_invoice", "export_invoice_pdf", "send_invoice", "mark_invoice_paid"] },
  { name: "Invoice look", page: "settings", does: "logo, stamp, signature, template",
    words: /\b(?:logo|stamp|signature|bank details|letterhead)\b|\binvoice (?:look|design|template|layout|style)\b/i,
    tools: ["update_invoice_appearance", "set_invoice_template", "list_templates"] },
  { name: "Invoice preset", page: "invoicing", does: "always-on columns, e.g. T.Liters = qty × L",
    words: /\bpresets?\b|\balways (?:add|show|use|calculate|put|include)\b|\bt\.?\s?lit(?:er|re)s?\b|\bper (?:litre|liter|kg|kilo)\b|\bcolumns?\b|دائما|عمود/i,
    tools: ["set_invoice_preset"] },
  { name: "Recurring invoices", page: "invoicing", does: "bill a customer every month",
    words: /\brecurring\b|\bevery (?:week|month|quarter|year)\b|\bmonthly invoice\b/i, tools: ["set_recurring"] },
  { name: "Quoting", page: "quoting", does: "quotation, quote, estimate, proposal",
    words: /\bquot(?:e|es|ation|ations)\b|\bestimates?\b|\bproposals?\b|عرض سعر|عروض أسعار|عروض اسعار|تسعير/i, tools: ["create_quote", "list_quotes"] },
  { name: "Orders", page: "orders", does: "customer sales orders and fulfilment",
    words: /\bsales orders?\b|\bcustomer orders?\b|\bnew orders?\b|\bfulfil\w*|أمر بيع|امر بيع|طلب بيع|طلبية/i, tools: ["create_order", "list_orders"] },
  { name: "Payment Receipts", page: "payment-receipts", does: "receipt / receipt voucher / payment voucher for money received",
    words: /\breceipts?\b|\bvouchers?\b|\bmoney received\b|\breceived (?:a )?payment\b|\bpayment (?:of|for) .{0,30}\bfrom\b|سند قبض|سند صرف|سند دفع|سندات|إيصال|ايصال|وصل|قسيمة/i,
    tools: ["create_payment_receipt", "list_payment_receipts"] },
  { name: "Delivery", page: "delivery-challans", does: "delivery note/challan/order, GRN, returns",
    words: /\bdeliver(?:y|ies)\b|\bchallans?\b|\bdelivery (?:note|order)s?\b|\bgoods received\b|\bGRN\b|\breturns?\b|سند تسليم|إشعار تسليم|اشعار تسليم|مذكرة تسليم|توصيل|تسليم|مرتجع/i,
    tools: ["create_delivery_challan", "list_delivery_challans"] },
  { name: "Packaging List", page: "packaging-list", does: "packing lists and shipment weights",
    words: /\bpack(?:ing|aging) lists?\b|\bshipment weights?\b|قائمة تعبئة|قائمة التعبئة/i, tools: ["create_packing_list", "list_packing_lists"] },
  { name: "Customers", page: "customers", does: "customer directory, TRN, addresses",
    words: /\bcustomers?\b|\bclients?\b|\bTRN\b|عميل|عملاء|زبون|زبائن/i, tools: ["find_customers", "create_customer"] },
  { name: "Suppliers", page: "suppliers", does: "supplier and vendor directory",
    words: /\bsuppliers?\b|\bvendors?\b|مورد|موردين/i, tools: ["find_suppliers", "create_supplier"] },
  { name: "Purchase Orders", page: "purchase-orders", does: "LPO / purchase order to a supplier",
    words: /\bpurchase orders?\b|\bLPOs?\b|\bPOs?\b|أمر شراء|امر شراء|طلب شراء|أوامر شراء/i, tools: ["create_purchase_order"] },
  { name: "Purchase Invoices", page: "purchase-invoices", does: "supplier bills, receive stock",
    words: /\bpurchase invoices?\b|\bsupplier (?:bill|invoice)s?\b|\bvendor bills?\b|\bbills? from\b|فاتورة مشتريات|فاتورة مورد|فواتير المشتريات/i,
    tools: ["create_purchase_invoice_draft", "list_purchase_invoices"] },
  { name: "Purchase", page: "purchase", does: "expenses: fuel, rent, petty cash",
    words: /\bexpenses?\b|\bspen[dt]\w*\b|\bpetty cash\b|\bpaid for\b|مصروف|مصاريف|نفقات/i, tools: ["log_expense", "list_expenses"] },
  { name: "Inventory", page: "inventory", does: "products, stock, adjustments",
    words: /\bproducts?\b|\bstock\b|\binventory\b|\bSKUs?\b|\breorder\b|مخزون|منتج|بضاع/i, tools: ["find_products", "create_product", "adjust_stock"] },
  { name: "Accounting", page: "accounting", does: "ledger, P&L, balance sheet, cash flow",
    words: /\bledger\b|\bjournal\b|\bchart of accounts\b|\btrial balance\b|\bP&L\b|\bprofit (?:and|&) loss\b|\bbalance sheet\b|\bcash ?flow\b|\btransactions?\b|قيود|دفتر الأستاذ|الميزانية|قائمة الدخل|أرباح وخسائر|ارباح وخسائر|كشف حساب|معاملات/i,
    tools: ["financial_statements", "list_transactions", "financial_summary"] },
  { name: "VAT", page: "accounting", does: "VAT return, output and input VAT",
    words: /\bVAT\b|\btax return\b|\bFTA\b|ضريبة|القيمة المضافة|إقرار ضريبي|اقرار ضريبي/i, tools: ["vat_return"] },
  { name: "Receivables and payables", page: "reports", does: "who owes us, what we owe",
    words: /\boutstanding\b|\boverdue\b|\bage?ing\b|\bowes?\b|\breceivables?\b|\bpayables?\b|مستحق|متأخر|مديوني|ديون/i,
    tools: ["receivables_aging", "payables_aging"] },
  { name: "Bank Accounts", page: "bank-accounts", does: "bank accounts, balances",
    words: /\bbank accounts?\b|\bIBAN\b|\bbank balance\b|حساب بنكي|حسابات بنكية|رصيد البنك/i, tools: ["list_bank_accounts"] },
  { name: "Cheques", page: "cheques", does: "issued and received cheques, PDCs",
    words: /\bcheques?\b|\bPDCs?\b|\bpost[- ]dated\b|شيك/i, tools: ["list_cheques", "record_cheque"] },
  { name: "Declaration Letter", page: "declaration", does: "UAE VAT supply declaration letters",
    words: /\bdeclarations?\b|إقرار توريد|اقرار توريد/i, tools: ["create_declaration_letter", "list_declaration_letters"] },
  { name: "Letters", page: "office", does: "NOC, salary/experience certificate",
    words: /\bletters?\b|\bNOC\b|\bcertificates?\b|رسالة|خطاب|شهادة|عدم ممانعة/i,
    tools: ["get_letter_context", "create_letter_draft", "get_letter", "revise_letter_draft", "list_letters", "export_letter_pdf"] },
  { name: "Word", page: "office", does: "Word documents (.docx)",
    words: /\bdocx\b|\bword\s+(?:docs?|documents?|files?)\b|\b(?:in|open|use|using|with|on|into)\s+(?:ms\s+)?word\b|مستند وورد|ملف وورد|وورد/i, tools: ["word"] },
  { name: "Sheets", page: "office", does: "spreadsheets: Excel, xlsx, csv",
    words: /\b(?:excel|spreadsheets?|workbooks?|xlsx|xls|ods|csv)\b|\b(?:in|open|use|using|with|on|into)\s+(?:the\s+)?sheets?\b|إكسل|اكسل|جدول بيانات|اكسيل/i, tools: ["sheet"] },
  { name: "PDF editor", page: "office", does: "edit, sign, redact a PDF",
    words: /\b(?:edit|annotate|highlight|redact|sign|fill|rotate|organi[sz]e|reorder)\w*\b[^.?!\n]{0,40}\bpdfs?\b|\bpdfs?\b[^.?!\n]{0,20}\b(?:editor|edit\w*|pages?)\b|\b(?:in|open|use|using|with|on|into)\s+(?:the\s+)?pdf(?:\s+editor)?\b/i,
    tools: ["pdf"] },
  { name: "Office apps", page: "office", does: "decks, layouts, UI designs, logos",
    words: /\b(?:presentations?|slides?|slide ?decks?|decks?|pptx|power ?point|keynote|brochures?|flyers?|posters?|magazines?|catalogu?es?|booklets?|page layouts?|in ?design|idml|figma|wireframes?|mockups?|prototypes?|ui designs?|app screens?|vectors?|svg|logos?|illustrations?|illustrator|icons?)\b|عرض تقديمي|شرائح|بروشور|ملصق|شعار|تصميم/i,
    tools: ["slides", "design", "fig", "vector"] },
  { name: "File jobs", page: "files", does: "merge, split, compress, convert, OCR",
    words: /\b(?:merge|split|compress|watermark|unlock|ocr|convert)\w*\b|\bto pdf\b|\bpassword\b|دمج|ضغط|تحويل/i, tools: ["run_file_tool", "list_file_tools"] },
  { name: "My Files", page: "files", does: "saved files and attachments",
    words: /\bmy files\b|\bsaved files?\b|\battach\w*\b/i, tools: ["list_my_files", "use_saved_file", "read_attached_document"] },
  { name: "People", page: "people", does: "employees, attendance, payroll, WPS, payslips",
    words: /\bemployees?\b|\bstaff\b|\battendance\b|\bpayroll\b|\bsalar(?:y|ies)\b|\bWPS\b|\bpayslips?\b|موظف|موظفين|حضور|رواتب|راتب|كشف رواتب/i,
    tools: ["list_employees", "mark_attendance", "run_payroll", "list_payroll", "generate_wps_file"] },
  { name: "CRM", page: "crm", does: "leads, deals, pipeline, contacts, activities",
    words: /\bleads?\b|\bdeals?\b|\bpipeline\b|\bprospects?\b|\bopportunit\w*|عميل محتمل|عملاء محتملين|صفق/i,
    tools: ["create_lead", "find_leads", "create_deal", "set_deal_stage", "list_deals", "crm_pipeline"] },
  { name: "Follow-ups", page: "follow-ups", does: "reminders and to-dos",
    words: /\bremind\w*|\bfollow[- ]?ups?\b|\bto-?dos?\b|ذكرني|تذكير|متابعة/i, tools: ["add_reminder", "list_reminders", "remind_me"] },
  { name: "Projects and Helpdesk", page: "projects", does: "projects, tasks, time, tickets",
    words: /\bprojects?\b|\btasks?\b|\btickets?\b|\btime (?:entry|entries|sheet)\b|مشروع|مشاريع|مهمة|مهام|تذكرة/i, tools: ["list_work_items", "save_work_item"] },
  { name: "Marketing", page: "marketing", does: "campaigns and email templates",
    words: /\bcampaigns?\b|\bnewsletters?\b|\bbulk (?:email|message)s?\b|\bemail templates?\b|حملة|حملات/i,
    tools: ["create_campaign", "list_campaigns", "list_email_templates"] },
  { name: "WhatsApp", page: "integrations", does: "send messages and files on WhatsApp",
    words: /\bwhats ?app\b|واتساب|واتس اب|واتس/i, tools: ["send_whatsapp", "send_whatsapp_file", "send_invoice_whatsapp"] },
  { name: "Email", page: "integrations", does: "send email, email an invoice",
    words: /\be-?mail\b|\bgmail\b|إيميل|ايميل|بريد/i, tools: ["send_gmail", "email_invoice"] },
  { name: "Social", page: "integrations", does: "read or post on social",
    words: /\b(?:instagram|insta|reels?|facebook|linkedin|tiktok|twitter|youtube|yt|shorts|social (?:media|post))\b|انستغرام|انستقرام|لينكد|يوتيوب/i,
    tools: ["schedule_social_post", "read_social_page", "list_social_posts", "list_social_accounts", "watch_youtube", "workspace_browser"] },
  { name: "Internet", page: "integrations", does: "web search, read links",
    words: /\b(?:search (?:the )?(?:web|internet|online)|google|look (?:it |this |that )?up online|research|internet|online|website|web ?page|news)\b|https?:\/\/|\bwww\.|الإنترنت|انترنت/i,
    tools: ["search_web", "read_web_page", "read_rss", "read_github"] },
  { name: "Reports and Overview", page: "reports", does: "sales, stock, finance reports",
    words: /\breports?\b|\bdashboard\b|\bKPIs?\b|تقرير|تقارير/i, tools: ["financial_summary", "get_stats"] },
  { name: "Settings", page: "settings", does: "company, numbering, users", words: /\bsettings?\b|\bnumbering\b/i, tools: [] },
  { name: "Integrations", page: "integrations", does: "connected apps and services", words: /\bintegrations?\b|\bconnect(?:ed)? apps?\b/i, tools: ["list_connected_apps"] },
  { name: "Team and Comms log", page: "team", does: "team channels, email and call log", words: /\bteam channels?\b|\bcomms? log\b|\bcall log\b/i, tools: [] },
];

/** Sections the agent is in or that need no routing. */
export const APP_MAP_EXEMPT = ["agent", "overview", "browser", "sms-templates", "email-templates", "comms", "helpdesk"];

/** The tools a request's words point to, for the first round. */
export function toolsForRequest(text: string): string[] {
  return [...new Set(APP_MAP.filter(area => area.words.test(text)).flatMap(area => area.tools))];
}

/** APP MAP for the system prompt: one terse line per area. */
export function appMapPrompt(): string {
  // ponytail: every byte here rides on every request; the size gate counts ~2 tokens a byte.
  return [
    "APP MAP (area: what it is → tool). Use the area's tool: a receipt, voucher, quote, order, delivery note, PO or letter is never an invoice. Not loaded yet: use_toolset or search_tools.",
    ...APP_MAP.map(a => `- ${a.name}: ${a.does} → ${a.tools.length ? a.tools.slice(0, 2).join(", ") : `open_page ${a.page}`}`),
  ].join("\n");
}
