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
    // Short ways people ask: "bill ahmed 500", "inv 23", "charge rennox for 20 pails", "sold 10 to ali".
    words: /\binvoic\w*|\bpro[- ]?forma\b|\bmark(?:ed)? (?:it |as )?paid\b|\bpaid in full\b|\binv\b|\bbill (?!from\b|payment\b|for (?:electricity|water|phone|internet|rent)\b)\w+ (?:for |\d)|\bcharge \w+ (?:for |\d)|\bsold\b|فاتور|فواتير|بعت|بيعة/i,
    tools: ["create_invoice_draft", "revise_invoice", "list_invoices", "get_invoice", "export_invoice_pdf", "send_invoice", "mark_invoice_paid", "record_invoice_payment", "list_invoice_payments"] },
  { name: "Invoice look", page: "settings", does: "logo, stamp, signature, template",
    words: /\b(?:logo|stamp|signature|bank details|letterhead)\b|\binvoice (?:look|design|template|layout|style)\b/i,
    tools: ["update_invoice_appearance", "set_invoice_template", "list_templates"] },
  { name: "Invoice preset", page: "invoicing", does: "always-on columns, e.g. T.Liters = qty × L",
    words: /\bpresets?\b|\balways (?:add|show|use|calculate|put|include)\b|\bt\.?\s?lit(?:er|re)s?\b|\bper (?:litre|liter|kg|kilo)\b|\bcolumns?\b|دائما|عمود/i,
    tools: ["set_invoice_preset"] },
  { name: "Recurring invoices", page: "invoicing", does: "bill a customer every month",
    words: /\brecurring\b|\brepeating\b|\bevery (?:week|month|quarter|year)\b|\bmonthly invoice\b|\bstop (?:the )?(?:repeat|recurr)\w*/i, tools: ["set_recurring", "list_recurring", "cancel_recurring"] },
  { name: "Quoting", page: "quoting", does: "quotation, quote, estimate, proposal",
    // "they accepted Q-0012, invoice it": a quote number or a yes is quote follow-through.
    words: /\bquot(?:e|es|ation|ations)\b|\bestimates?\b|\bproposals?\b|\bQ(?:T|UO)?-?\d{2,}\b|\baccepted\b|عرض سعر|عروض أسعار|عروض اسعار|تسعير/i,
    tools: ["create_quote", "list_quotes", "get_quote", "set_quote_status", "convert_quote_to_invoice"] },
  { name: "Orders", page: "orders", does: "customer sales orders and fulfilment",
    words: /\bsales orders?\b|\bcustomer orders?\b|\bnew orders?\b|\bfulfil\w*|أمر بيع|امر بيع|طلب بيع|طلبية/i, tools: ["create_order", "list_orders", "update_order_status"] },
  { name: "Payment Receipts", page: "payment-receipts", does: "receipt / receipt voucher / payment voucher for money received",
    // "ali paid 500", "got paid", "received 2000 cash from bapco": money in, with or without the word receipt.
    words: /\breceipts?\b|\bvouchers?\b|\bmoney received\b|\breceived (?:a )?payment\b|\bpayment (?:of|for) .{0,30}\bfrom\b|\b(?:got|received) (?:paid|payment|money|cash|\d[\d,.]*)\b|\bpaid (?:me|us)\b|\b(?!(?:i|we)\b)[a-z]\w* paid (?=\d|aed\b|dhs\b|in full\b|the invoice\b)|سند قبض|سند صرف|سند دفع|سندات|إيصال|ايصال|وصل|قسيمة|استلمت|دفع لي/i,
    tools: ["create_payment_receipt", "list_payment_receipts", "update_payment_receipt_status"] },
  { name: "Delivery", page: "delivery-challans", does: "delivery note/challan/order, GRN, returns",
    words: /\bdeliver(?:y|ies)\b|\bchallans?\b|\bdelivery (?:note|order)s?\b|\bgoods received\b|\bGRN\b|\breturns?\b|\bdispatch\w*|\bship(?:ped|ping)? (?:it|them|the|to|out)\b|سند تسليم|إشعار تسليم|اشعار تسليم|مذكرة تسليم|توصيل|تسليم|مرتجع/i,
    tools: ["create_delivery_challan", "list_delivery_challans"] },
  { name: "Packaging List", page: "packaging-list", does: "packing lists and shipment weights",
    words: /\bpack(?:ing|aging) lists?\b|\bshipment weights?\b|قائمة تعبئة|قائمة التعبئة/i, tools: ["create_packing_list", "list_packing_lists"] },
  { name: "Customers", page: "customers", does: "customer directory, TRN, addresses",
    // Advances live on the customer (and supplier) record: deposits, prepayments, money on account.
    words: /\bcustomers?\b|\bclients?\b|\bTRN\b|\badvances?\b|\bdeposits?\b|\bpre-?pa(?:id|yment)s?\b|\bon account\b|عميل|عملاء|زبون|زبائن|دفعة مقدمة|عربون|مقدم/i,
    tools: ["find_customers", "create_customer", "update_customer", "record_advance", "list_advances", "apply_advance_to_invoice"] },
  { name: "Suppliers", page: "suppliers", does: "supplier and vendor directory",
    words: /\bsuppliers?\b|\bvendors?\b|مورد|موردين/i, tools: ["find_suppliers", "create_supplier", "update_supplier"] },
  { name: "Purchase Orders", page: "purchase-orders", does: "LPO / purchase order to a supplier",
    // "order 20 drums from bapco", "reorder oil from bapco": ordering goods FROM someone is buying.
    // "got an order from ali" (a customer's order) does not match: no quantity or item between.
    words: /\bpurchase orders?\b|\bLPOs?\b|\bPOs?\b|\b(?:re)?order (?:\d[^.?!\n]{0,30}|(?:more |some )?\w+ )from\b|أمر شراء|امر شراء|طلب شراء|أوامر شراء/i, tools: ["create_purchase_order", "list_purchase_orders", "get_purchase_order", "record_po_payment"] },
  { name: "Purchase Invoices", page: "purchase-invoices", does: "supplier bills, receive stock",
    words: /\bpurchase invoices?\b|\bsupplier (?:bill|invoice)s?\b|\bvendor bills?\b|\bbills? from\b|\bbought\b|\bpurchased\b|فاتورة مشتريات|فاتورة مورد|فواتير المشتريات|اشتريت/i,
    tools: ["create_purchase_invoice_draft", "list_purchase_invoices"] },
  { name: "Purchase", page: "purchase", does: "expenses: fuel, rent, petty cash",
    // "fuel 200", "rent paid", "salik 50": the thing paid for is often the whole request.
    words: /\bexpenses?\b|\bspen[dt]\w*\b|\bpetty cash\b|\bpaid for\b|\b(?:fuel|petrol|diesel|salik|parking|taxi|rent|dewa|electricity bill|water bill|internet bill|phone bill)\b|مصروف|مصاريف|نفقات|بنزين|ايجار|إيجار/i, tools: ["log_expense", "list_expenses"] },
  { name: "Inventory", page: "inventory", does: "products, stock, adjustments",
    words: /\bproducts?\b|\bstock\b|\binventory\b|\bSKUs?\b|\breorder\b|\brestock\b|\bhow many\b[^.?!\n]{0,30}\bleft\b|\brunning low\b|مخزون|منتج|بضاع|كم باقي/i,
    tools: ["find_products", "create_product", "update_product", "adjust_stock", "stock_history", "reorder_low_stock"] },
  { name: "Accounting", page: "accounting", does: "ledger, P&L, balance sheet, cash flow",
    words: /\bledger\b|\bjournal\b|\bchart of accounts\b|\btrial balance\b|\bP&L\b|\bprofit (?:and|&) loss\b|\bbalance sheet\b|\bcash ?flow\b|\btransactions?\b|قيود|دفتر الأستاذ|الميزانية|قائمة الدخل|أرباح وخسائر|ارباح وخسائر|كشف حساب|معاملات/i,
    tools: ["financial_statements", "list_transactions", "financial_summary", "create_account", "post_journal_entry"] },
  { name: "VAT", page: "accounting", does: "VAT return, output and input VAT",
    words: /\bVAT\b|\btax return\b|\bFTA\b|ضريبة|القيمة المضافة|إقرار ضريبي|اقرار ضريبي/i, tools: ["vat_return"] },
  { name: "Receivables and payables", page: "reports", does: "who owes us, what we owe",
    words: /\boutstanding\b|\boverdue\b|\bage?ing\b|\bowes?\b|\breceivables?\b|\bpayables?\b|\bunpaid\b|\bdues\b|\bwhat'?s due\b|\bpending payments?\b|\bnot (?:yet )?paid\b|\b(?:hasn|haven)'?t paid\b|مستحق|متأخر|مديوني|ديون|ما دفع/i,
    tools: ["receivables_aging", "payables_aging"] },
  { name: "Bank Accounts", page: "bank-accounts", does: "bank accounts, balances",
    words: /\bbank accounts?\b|\bIBAN\b|\bbank balance\b|حساب بنكي|حسابات بنكية|رصيد البنك/i, tools: ["list_bank_accounts", "save_bank_account"] },
  { name: "Cheques", page: "cheques", does: "issued and received cheques, PDCs",
    words: /\bcheques?\b|\bPDCs?\b|\bpost[- ]dated\b|شيك/i, tools: ["list_cheques", "record_cheque", "update_cheque_status"] },
  { name: "Declaration Letter", page: "declaration", does: "UAE VAT supply declaration letters",
    words: /\bdeclarations?\b|إقرار توريد|اقرار توريد/i, tools: ["create_declaration_letter", "list_declaration_letters"] },
  { name: "Letters", page: "office", does: "NOC, certificates: written in Word",
    words: /\bletters?\b|\bNOC\b|\bcertificates?\b|رسالة|خطاب|شهادة|عدم ممانعة/i,
    tools: ["word", "get_letter_context"] },
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
    words: /\bmy files\b|\bsaved files?\b|\battach\w*\b/i, tools: ["list_my_files", "use_saved_file", "read_attached_document", "run_file_tool"] },
  { name: "People", page: "people", does: "employees, payroll, attendance",
    // "sara joined today", "ravi absent", "new hire", "on leave": people news without the word employee.
    words: /\bemployees?\b|\bstaff\b|\battendance\b|\bpayroll\b|\bsalar(?:y|ies)\b|\bWPS\b|\bpayslips?\b|\bnew hire\b|\bhired\b|\bjoin(?:ed|s|ing) (?:us|today|tomorrow|the team|on)\b|\babsent\b|\bon leave\b|\bsick (?:leave|today)\b|\bday off\b|\bovertime\b|موظف|موظفين|حضور|رواتب|راتب|كشف رواتب|غائب|غياب|إجازة|اجازة/i,
    tools: ["list_employees", "create_employee", "update_employee", "mark_attendance", "run_payroll", "mark_salary_paid", "generate_wps_file"] },
  { name: "CRM", page: "crm", does: "leads, deals, pipeline",
    words: /\bleads?\b|\bdeals?\b|\bpipeline\b|\bprospects?\b|\bopportunit\w*|\b(?:add (?:a )?)?note (?:on|about|for|that)\b|عميل محتمل|عملاء محتملين|صفق|ملاحظة/i,
    tools: ["create_lead", "find_leads", "create_deal", "set_deal_stage", "list_deals", "crm_pipeline", "add_crm_note"] },
  { name: "Follow-ups", page: "follow-ups", does: "reminders, to-dos, notifications, automations",
    words: /\bremind\w*|\bfollow[- ]?ups?\b|\bto-?dos?\b|\bdon'?t (?:let me )?forget\b|\bcall (?:\w+ )?(?:back|later|tomorrow)\b|\breschedul\w*|\bpostpone\w*|\bpush (?:it|this|that) to\b|\bnotifications?\b|\bunread\b|\b(?:anything|what'?s) new\b|\bautomat\w*|\b(?:every|each) (?:morning|evening|day|week|hour|month|mon|tue|wed|thu|fri|sat|sun)\w*|\bwhenever\b|\bkeep an eye\b|\bwatch (?:for|out)\b|ذكرني|تذكير|متابعة|إشعارات|اشعارات|أجّل|كل يوم|كل صباح|تلقائي/i,
    tools: ["add_reminder", "list_follow_ups", "complete_follow_up", "reschedule_follow_up", "list_notifications", "create_automation", "list_automations", "update_automation"] },
  { name: "Projects and Helpdesk", page: "projects", does: "projects, tasks, time, tickets",
    words: /\bprojects?\b|\btasks?\b|\btickets?\b|\btime (?:entry|entries|sheet)\b|مشروع|مشاريع|مهمة|مهام|تذكرة/i, tools: ["list_work_items", "save_work_item"] },
  { name: "Marketing", page: "marketing", does: "campaigns and email templates",
    words: /\bcampaigns?\b|\bnewsletters?\b|\bbulk (?:email|message)s?\b|\bemail templates?\b|\blanding pages?\b|\bseo\b|\bad copy\b|\bcopywriting\b|حملة|حملات/i,
    tools: ["create_campaign", "list_campaigns", "list_email_templates", "save_email_template"] },
  { name: "WhatsApp", page: "integrations", does: "send messages and files on WhatsApp",
    words: /\bwhats ?app\b|\bwa\b|\bmsg\b|واتساب|واتس اب|واتس/i, tools: ["send_whatsapp", "send_whatsapp_file", "send_invoice_whatsapp"] },
  { name: "Email", page: "integrations", does: "send email, email an invoice",
    words: /\be-?mail\b|\bgmail\b|\bmail (?:it|this|him|her|them)\b|إيميل|ايميل|بريد/i, tools: ["send_gmail", "email_invoice"] },
  { name: "Social", page: "integrations", does: "read or post on social",
    words: /\b(?:instagram|insta|reels?|facebook|linkedin|tiktok|twitter|youtube|yt|shorts|social (?:media|post))\b|انستغرام|انستقرام|لينكد|يوتيوب/i,
    tools: ["schedule_social_post", "read_social_page", "list_social_posts", "list_social_accounts", "watch_youtube", "workspace_browser"] },
  { name: "Internet", page: "integrations", does: "web search, read links",
    words: /\b(?:search (?:the )?(?:web|internet|online)|google|look (?:it |this |that )?up online|research|internet|online|website|web ?page|news)\b|https?:\/\/|\bwww\.|الإنترنت|انترنت/i,
    tools: ["search_web", "read_web_page", "read_rss", "read_github"] },
  { name: "Reports and Overview", page: "reports", does: "sales, stock, finance reports",
    // "how much did we sell", "sales this month", "profit?", "how's business".
    words: /\breports?\b|\bdashboard\b|\bKPIs?\b|\bsales\b(?! orders?\b)|\brevenue\b|\bturnover\b|\bprofits?\b|\bhow (?:much|many) (?:did|have) (?:we|i)\b|\bhow(?:'s| is) business\b|تقرير|تقارير|مبيعات|أرباح|ارباح/i, tools: ["financial_summary", "get_stats"] },
  { name: "Settings", page: "settings", does: "company, numbering, users", words: /\bsettings?\b|\bnumbering\b/i, tools: ["get_company_profile", "update_company_profile"] },
  { name: "Integrations", page: "integrations", does: "Slack, Teams, Discord, Gmail, Outlook and the other connected apps",
    words: /\bintegrations?\b|\bconnect(?:ed)? apps?\b|\b(?:slack|discord|teams|notion|hubspot|outlook|gmail|google drive|google calendar|calendly|mailchimp|typeform)\b/i,
    tools: ["list_connected_apps", "composio_run"] },
  { name: "Office work", page: "office", does: "saved files",
    words: /\boffice work\b|\bopen (?:the |my )?(?:file|document)\b|\bfile i (?:just )?(?:made|saved|wrote|created)\b/i,
    tools: ["word", "sheet", "pdf", "list_my_files"] },
  { name: "Team channels", page: "team", does: "channels, mentions and threads", words: /\bteam channels?\b|\bin (?:the )?team\b|\bpost (?:a )?message (?:in|to)\b/i, tools: ["list_team_channels", "post_team_message"] },
  { name: "Comms log", page: "comms", does: "email sent and calls logged", words: /\bcomms? log\b|\bcall log\b|\bemail log\b|\bcall history\b/i, tools: ["list_comms_log", "log_call"] },
  { name: "Email Templates", page: "email-templates", does: "reusable email templates with placeholders", words: /\bemail templates?\b|\btemplate (?:library|set|collection)\b/i, tools: ["list_email_templates", "save_email_template", "delete_email_template"] },
];

/** Sections the agent is in or that need no routing. */
export const APP_MAP_EXEMPT = ["agent", "overview", "browser", "sms-templates", "helpdesk"];

/** The tools a request's words point to, for the first round. */
export function toolsForRequest(text: string): string[] {
  return [...new Set(APP_MAP.filter(area => area.words.test(text)).flatMap(area => area.tools))];
}

/** APP MAP for the system prompt: one terse line per SECTION.
 *
 *  It used to be one line per area, and Office work alone held five of them
 *  (Letters, Word, Sheets, PDF editor, Office apps) — five lines of prompt
 *  riding on every request to say one thing: this is the office, start at
 *  `word`. Sections that share a page are now one line, and the line keeps
 *  only what the model needs to choose: what the section is, and the first
 *  tools in it. */
export function appMapPrompt(): string {
  // ponytail: every byte here rides on every request; the size gate counts ~2 tokens a byte.
  const byPage = new Map<string, AppArea[]>();
  for (const area of APP_MAP) {
    const key = area.page || area.name;
    const group = byPage.get(key);
    if (group) group.push(area);
    else byPage.set(key, [area]);
  }
  const lines: string[] = [];
  for (const [page, areas] of byPage) {
    const names = areas.map(a => a.name).join("/");
    const tools = [...new Set(areas.flatMap(a => a.tools))].slice(0, 2).join(", ");
    if (areas.length === 1) lines.push(`- ${names}: ${areas[0].does} → ${tools || `open_page ${page}`}`);
    else lines.push(`- ${names} → ${tools || `open_page ${page}`}`);
  }
  return [
    "APP MAP (section → tool). A receipt, voucher, quote, order, delivery note, PO or letter is never an invoice. More tools: use_toolset, search_tools.",
    ...lines,
  ].join("\n");
}
