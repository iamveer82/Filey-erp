# Vyapar App Analysis — Filey ERP Improvement Guide

> Captured via computer-use automation on 11 July 2026
> Vyapar app running as **Dune Lubricants & Oil IND L.L.C SP** (free trial)
> Purpose: Identify layout patterns, flows, and features Filey ERP should adopt

---

## Table of Contents

1. [App Architecture](#1-app-architecture)
2. [Sidebar Navigation](#2-sidebar-navigation)
3. [Home / Dashboard](#3-home--dashboard)
4. [Parties (Customers & Suppliers)](#4-parties-customers--suppliers)
5. [Items (Products, Services, Categories, Units)](#5-items-products-services-categories-units)
6. [Sale Module (7 sub-types)](#6-sale-module-7-sub-types)
7. [Sale Invoice List View](#7-sale-invoice-list-view)
8. [Sale Invoice Form (Full Layout)](#8-sale-invoice-form-full-layout)
9. [Purchase & Expense Module](#9-purchase--expense-module)
10. [Cash & Bank Module](#10-cash--bank-module)
11. [Reports Module](#11-reports-module)
12. [Grow Your Business](#12-grow-your-business)
13. [Sync, Share & Backup](#13-sync-share--backup)
14. [Utilities & Settings](#14-utilities--settings)
15. [Filey ERP Gap Analysis & Recommendations](#15-filey-erp-gap-analysis--recommendations)

---

## 1. App Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Top Bar: Support phone | Notifications (F8) | Window controls │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                    │
│  Sidebar │            Main Content Area                        │
│  (235px) │            (scrollable, varies per section)          │
│          │                                                    │
│  Nav:    │  Patterns used:                                    │
│  - Home  │  • List + Detail split view                         │
│  - Parties│ • Tabbed table view                               │
│  - Items │  • Full-page form (Sale/Purchase)                   │
│  - Sale  │  • Report list + report viewer                      │
│  - Purchase│                                                   │
│  - Grow  │                                                    │
│  - Cash  │                                                    │
│  - Reports│                                                   │
│  - Sync  │                                                    │
│  - Utils │                                                    │
│          │                                                    │
│  Footer: │                                                    │
│  Trial   │                                                    │
│  Premium │                                                    │
│  Profile │                                                    │
├──────────┴──────────────────────────────────────────────────┤
│ Tab Bar: Sale #1 [x] [+] (like browser tabs)                 │
└─────────────────────────────────────────────────────────────┘
```

**Key patterns:**
- **Tab system** at top of content area (like browser tabs) — each invoice/form opens as a new tab
- **Sidebar** is always visible (235px), collapsible
- **Split views** for Parties and Items (master-detail)
- **Full-page forms** for Sale/Purchase invoices
- **Top action bar** with "Add Sale", "Add Purchase", "addMore" button — always accessible regardless of current section

---

## 2. Sidebar Navigation

```
┌──────────────────┐
│ [Search/Reports]  │  ← "Open Anything (Ctrl+F)" search box
│                  │     Also shows "Reports" text above
├──────────────────┤
│ Home             │  ← Dashboard
│ Parties          │  ← Customers & Suppliers (expandable)
│ Items            │  ← Products/Services/Categories/Units (expandable)
│ Sale             │  ← Expandable sub-menu (7 items)
│ Purchase & Expense│ ← Expandable sub-menu
│ Grow Your Business│ ← Expandable (WhatsApp marketing, etc)
│ Cash & Bank      │  ← Expandable
│ Reports          │  ← Full reports list
│ Sync, Share & Backup│ ← Expandable
│ Utilities       │  ← Expandable
├──────────────────┤
│ 6 days Free Trial│  ← Trial countdown
│ Get Vyapar Premium│ ← Upsell button
├──────────────────┤
│ [avatar] Dune    │  ← Company name + profile dropdown
│ Lubricants & Oil │
│ IND L.L.C SP    │
└──────────────────┘
```

**Sale sub-menu (expanded):**
```
Sale
├── Sale Invoices
├── Estimate/ Quotation
├── Proforma Invoice
├── Payment-In
├── Sale Order
├── Delivery Note
└── Sale Return/ Credit Note
```

---

## 3. Home / Dashboard

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ UAE e-Invoicing banner (dismissible)                         │
│ "Vyapar will support compliant UAE e-invoice generation      │
│  once FTA enables it"                              [x Close] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐                    │
│  │ Total Receivable│  │ Total Payable   │                    │
│  │ AED 200         │  │ AED 2,320       │                    │
│  │ From 1 Party    │  │ From 1 Party    │                    │
│  └─────────────────┘  └─────────────────┘                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Total Sale           [This Month ▾]                   │   │
│  │ AED 10,160                                         │   │
│  │                                                      │   │
│  │ [Bar chart showing daily sales for the month]       │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Most Used Reports                    [View All]              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                         │
│  │Sale  │ │All   │ │Daybook│ │Party │                         │
│  │Report│ │Trans │ │Report│ │State.│                         │
│  └──────┘ └──────┘ └──────┘ └──────┘                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Google Profile Manager                               │   │
│  │ "Businesses with recent reviews rank higher..."      │   │
│  │ [Connect Now]                                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [+] Add Widget of Your Choice                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Elements

| Element | Data | Position |
|---|---|---|
| Total Receivable | AED 200, From 1 Party | Top-left card |
| Total Payable | AED 2,320, From 1 Party | Top-right card |
| Total Sale | AED 10,160, This Month | Below cards, left |
| Sales chart | Bar graph, daily breakdown | Below Total Sale |
| Most Used Reports | Sale Report, All Transactions, Daybook, Party Statement | Below chart |
| Google Profile Manager | "Connect Now" button | Right sidebar widget |
| Add Widget | Customizable dashboard widget | Bottom |
| UAE e-Invoicing banner | Dismissible info banner | Top of content |

### Filey Improvements Needed

- **Add receivable/payable summary cards** on dashboard
- **Add sales chart** (bar graph, monthly/daily breakdown)
- **Add "Most Used Reports" quick tiles** 
- **Add month-over-month comparison** (100% vs last month)
- **Add customizable widgets** ("Add Widget of Your Choice")
- **UAE e-invoicing readiness banner** (FTA compliance)

---

## 4. Parties (Customers & Suppliers)

### Layout — Master-Detail Split View

```
┌──────────────┬─────────────────────────────────────────────┐
│ Parties      │  KSR GENRAL TRADING FZE          [⚙] [⋯]   │
│              │                                              │
│ [Search Party│  Phone Number: +971503343543                 │
│  Name]       │  Credit Limit: AED 100,000                   │
│              │                                              │
│ ┌──────────┐ │  Transactions                    [search]   │
│ │KSR GENRAL│ │  ┌──────────────────────────────────────┐   │
│ │TRADING   │ │  │Type│Number│Date│Total│Balance│Due│Stat│   │
│ │FZE       │ │  │    │      │    │      │       │   │   │   │
│ │2,320.00  │ │  └──────────────────────────────────────┘   │
│ ├──────────┤ │                                              │
│ │xyz       │ │                                              │
│ │200.00    │ │                                              │
│ └──────────┘ │                                              │
│              │                                              │
│ [Convert phone│                                             │
│  contacts →  │                                              │
│  parties]    │                                              │
└──────────────┴─────────────────────────────────────────────┘
```

### Elements

| Element | Purpose |
|---|---|
| Party list (left, ~312px) | Name + Outstanding balance |
| Search "Search Party Name" | Filter by name |
| Party detail (right) | Phone, Credit Limit, Transactions |
| Transaction table | Type, Number, Date, Total, Balance, Due Date, Status |
| "Convert phone contacts" | Import contacts as parties |

### Data Captured

- **KSR GENRAL TRADING FZE** — Balance: 2,320.00 AED, Phone: +971503343543, Credit Limit: AED 100,000
- **xyz** — Balance: 200.00 AED

### Filey Improvements Needed

- **Add Credit Limit field** to party records (with alert when exceeded)
- **Add split-view** (master-detail) instead of separate pages
- **Add per-party transaction history** in detail view
- **Add phone contact import**
- **Show party balance** in the list (positive = receivable, negative = payable)

---

## 5. Items (Products, Services, Categories, Units)

### Layout — Tabbed + Split View

```
┌─────────────────────────────────────────────────────────────┐
│ [PRODUCTS] [SERVICES] [CATEGORY] [UNITS]    │
├──────────────┬──────────────────────────────────────────────┤
│ [+Add Item]  │  TRANSACTIONS                  [search]      │
│ [More ▾]     │                                               │
│              │  ┌────────────────────────────────────────┐   │
│ ┌──────────┐ │  │TYPE│INVOICE/REF│NAME│DATE│QTY│PRICE│STAT│   │
│ │ITEM  │QTY│ │  │     │          │    │    │   │     │    │   │
│ │      │   │ │  └────────────────────────────────────────┘   │
│ └──────────┘ │                                               │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

### Tabs

| Tab | Purpose |
|---|---|
| PRODUCTS | Physical goods with quantity tracking |
| SERVICES | Non-physical items (no stock) |
| CATEGORY | Group items (e.g., "Engine Oils", "Greases") |
| UNITS | Measurement units (Litre, KG, Drum, etc.) |

### Elements

- Left panel: Item list with ITEM name + QUANTITY columns
- Right panel: Transaction history for selected item (Type, Invoice/Ref No, Name, Date, Quantity, Price/Unit, Status)
- Search box for filtering transactions
- "Add Item" dropdown with "More" options

### Filey Improvements Needed

- **Add Services tab** (non-physical items)
- **Add Category management** (group products)
- **Add Units management** (custom units like Litre, Drum, Gallon)
- **Add per-item transaction history** in detail view
- **Split-view** for items (list + detail)

---

## 6. Sale Module (7 Sub-Types)

### Full Sub-Menu

```
Sale
├── Sale Invoices          ← Main invoice list + form
├── Estimate/ Quotation    ← Pre-sale quotes
├── Proforma Invoice       ← Proforma (pre-invoice)
├── Payment-In             ← Receipts (money received)
├── Sale Order             ← Customer order confirmation
├── Delivery Note          ← Goods delivery record
└── Sale Return/ Credit Note ← Returns/refunds
```

### Each Sub-Type Has:
- List view (table with filters)
- Add New button (opens form as new tab)
- Summary cards (total amount, received, balance)
- Filter bar (month, date range, firm, user)
- Excel export + Print buttons
- Per-row actions (edit, context menu)

### Filey Improvements Needed

| Module | Filey Status | Action |
|---|---|---|
| Sale Invoices | ✅ Exists | Enhance form fields |
| Estimate/Quotation | ✅ Exists | Keep |
| Proforma Invoice | ❌ Missing | Add |
| Payment-In | ❌ Missing | Add (critical for cash tracking) |
| Sale Order | ❌ Missing | Add |
| Delivery Note | ❌ Missing | Add |
| Sale Return/Credit Note | ❌ Missing | Add |

---

## 7. Sale Invoice List View

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Sale Invoices [▾]                              [Add Sale] [⚙]│
├─────────────────────────────────────────────────────────────┤
│ Filter by: [This Month ▾] [01/07/2026 → 31/07/2026]         │
│           [All Firms ▾] [All Users ▾]                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Total Sales Amount              100%                        │
│  10,160 AED                       ▲ vs last month           │
│                                                              │
│  Received: 9,960 AED    Balance: 200 AED                    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Transactions                        [search] [excel] [print] │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │Date │Inv#│Party Name │Transaction│Payment│Amount│Bal │Due│Stat│Actions│
│ │11/07│ 4 │KSR GENRAL │Sale       │Cash   │3,320 │0   │   │Paid│ ⋮   │
│ │11/07│ 3 │KSR GENRAL │Sale       │Cash   │3,320 │0   │   │Paid│ ⋮   │
│ │11/07│ 2 │KSR GENRAL │Sale       │Cash   │3,320 │0   │   │Paid│ ⋮   │
│ │11/07│ 1 │xyz        │Sale       │Cash   │200   │200 │   │Unpaid│ ⋮ │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Table Columns

| Column | Data | Sortable |
|---|---|---|
| Date | 11/07/2026 | Yes |
| Invoice no | 4, 3, 2, 1 | Yes |
| Party Name | KSR GENRAL TRADING FZE, xyz | Yes |
| Transaction | Sale | Yes |
| Payment Type | Cash | Yes |
| Amount | 3,320 AED, 200 AED | Yes |
| Balance | 0 AED, 200 AED | Yes |
| Due date | (blank if paid) | Yes |
| Status | Paid (green), Unpaid (red) | Yes |
| Actions | Print icon + context menu (⋮) | — |

### Filter Bar

| Filter | Options |
|---|---|
| Period | This Month, Last Month, This Quarter, Custom |
| Date Range | 01/07/2026 → 31/07/2026 (auto from period) |
| Firm | All Firms, [specific firms] |
| User | All Users, [specific users] |

### Summary Cards (above table)

- **Total Sales Amount**: 10,160 AED with 100% vs last month indicator
- **Received**: 9,960 AED
- **Balance**: 200 AED

### Action Buttons (top-right)

- **[excel]** — Export to Excel
- **[print]** — Print table

### Filey Improvements Needed

- **Add firm/user filters** (for multi-company/multi-user)
- **Add month-over-month % comparison** on summary
- **Add Received/Balance breakdown** below total
- **Add Excel export** from list view
- **Add "Add Sale" button** directly in list header
- **Status badges** with color coding (green=Paid, red=Unpaid)

---

## 8. Sale Invoice Form (Full Layout)

### Layout — Full Page Form (opens as tab)

```
┌─────────────────────────────────────────────────────────────┐
│ Sale #1 [x] [+]                          [⚙] [⋯]            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Sale    [☑ Credit]  [☐ Cash]                               │
│                                                              │
│  ┌────────────────────────────┬─────────────────────────┐   │
│  │                            │                         │   │
│  │  Customer *                │  Invoice Number  5      │   │
│  │  [Search by Name/Phone ▾]  │  Invoice Date  [📅]     │   │
│  │  [Add Party +]              │                         │   │
│  │                            │  Payment Terms [Due on  │   │
│  │  Phone No.                  │   Receipt ▾]            │   │
│  │  [+971___]                 │  Due Date [📅]           │   │
│  │                            │                         │   │
│  │  PO No.                    │  Country [Select ▾]    │   │
│  │  [________]                │  Place of Supply [↗]    │   │
│  │                            │                         │   │
│  │  PO Date.                  │                         │   │
│  │  [📅]                      │                         │   │
│  │                            │                         │   │
│  │  Date of Supply            │                         │   │
│  │  [📅]                      │                         │   │
│  │                            │                         │   │
│  └────────────────────────────┴─────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │#│ITEM      │QTY│UNIT│PRICE/UNIT│DISCOUNT│TAX │AMOUNT│   │
│  │ │(Without  │   │    │(Without  │X %   $ │%  $│     │   │
│  │ │ Tax)     │   │    │ Tax)     │       │   │     │   │
│  ├─┼──────────┼───┼────┼──────────┼───────┼────┼─────┤   │
│  │1│[Select..│   │NONE│          │    $  │[Sel│  $  │   │
│  │2│[Select..│   │NONE│          │    $  │[Sel│  $  │   │
│  ├─┼──────────┼───┴────┴──────────┴───────┴────┴─────┤   │
│  │ │[ADD ROW] │TOTAL│   │          │  0  │ 0  │  0  │   │
│  └─┴──────────┴─────┴───┴──────────┴─────┴────┴─────┘   │
│                                                              │
│  [ADD TERMS & CONDITIONS]  [ADD DESCRIPTION]  [ADD IMAGE]  │
│                                                              │
│  No. of copies: [Original, Duplicate, Triplicate ▾]         │
│                                                              │
│  [☑] Round Off  [___]    Total: [____________]              │
│                                                              │
│                              [Generate e-Invoice] [Save]    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Form Fields — Left Section (Party Info)

| Field | Type | Required | Notes |
|---|---|---|---|
| Customer | Autocomplete search | ✅ Yes | Searches by Name/Phone, shows party balance in dropdown |
| Phone No. | Text input | No | Auto-fills from selected party |
| PO No. | Text input | No | Purchase Order reference |
| PO Date | Date picker | No | Purchase Order date |
| Date of Supply | Date picker | No | UAE VAT: date goods supplied |

### Form Fields — Right Section (Invoice Info)

| Field | Type | Required | Notes |
|---|---|---|---|
| Invoice Number | Auto-number | Yes | Sequential, editable |
| Invoice Date | Date picker | Yes | Default = today |
| Payment Terms | Dropdown | No | "Due on Receipt", "Net 15", "Net 30", etc. |
| Due Date | Date picker | No | Auto-calculated from Payment Terms |
| Country | Dropdown | No | UAE VAT compliance |
| Place of Supply | Dropdown | No | UAE VAT compliance |

### Form Fields — Line Items Table

| Column | Type | Notes |
|---|---|---|
| # | Auto-number | Row number |
| ITEM | Autocomplete | Search from inventory |
| QTY | Number input | Quantity |
| UNIT | Dropdown | Unit of measure (NONE default, Litre, KG, etc.) |
| PRICE/UNIT (Without Tax) | Number | Price excluding VAT |
| DISCOUNT | % + Amount | Two inputs: percentage and calculated amount |
| TAX | % + Amount | Two inputs: tax percentage and calculated amount |
| AMOUNT | Auto-calc | QTY × PRICE − DISCOUNT + TAX |

### Customer Autocomplete Dropdown

```
┌──────────────────────────────────────┐
│ [+] Add Party          Party Balance │
├──────────────────────────────────────┤
│ KSR GENRAL TRADING FZE    2320       │
│ +971503343543                        │
├──────────────────────────────────────┤
│ xyz                       200        │
└──────────────────────────────────────┘
```

Shows party name, phone, and outstanding balance inline.

### Bottom Section

| Element | Purpose |
|---|---|
| ADD TERMS & CONDITIONS | Free text T&C block |
| ADD DESCRIPTION | Free text description/notes |
| ADD IMAGE | Attach image to invoice |
| No. of copies | Dropdown: Original, Duplicate, Triplicate |
| Round Off | Checkbox + rounding amount |
| Total | Total amount (auto or manual) |
| Generate e-Invoice | UAE e-invoice generation |
| Save | Save invoice |

### Filey Improvements Needed — Sale Invoice Form

**Critical:**
1. Add **Payment Terms** dropdown (Due on Receipt, Net 7, Net 15, Net 30, Net 60)
2. Add **Due Date** field (auto-calc from Payment Terms + Invoice Date)
3. Add **per-line Discount %** (currently Filey only has flat discount)
4. Add **per-line Tax %** (currently Filey has global tax only)
5. Add **PO No.** and **PO Date** fields
6. Add **Date of Supply** field (UAE VAT)
7. Add **Country** and **Place of Supply** dropdowns

**Medium:**
8. Add **Terms & Conditions** editable block
9. Add **No. of copies** dropdown (Original/Duplicate/Triplicate)
10. Add **Round Off** checkbox + amount
11. Add **Credit/Cash** toggle at top
12. Add **ADD IMAGE** attachment
13. Add **Generate e-Invoice** button

**Polish:**
14. Show **party balance** in customer autocomplete dropdown
15. **Tab system** for multiple open invoices (browser-tab pattern)
16. **Add Party** inline from invoice form (without leaving)

---

## 9. Purchase & Expense Module

### Same structure as Sale, with mirrored sub-types:

```
Purchase & Expense
├── Purchase Bills
├── Purchase Order
├── Expense
├── Payment-Out
├── Purchase Return/ Debit Note
└── Import Purchase
```

### Filey Improvements Needed

- **Add Purchase Bills** (if not exists)
- **Add Expense module** (track business expenses)
- **Add Payment-Out** (track payments made to suppliers)
- **Add Purchase Return/Debit Note**
- **Add Import Purchase** (bulk import)

---

## 10. Cash & Bank Module

### Layout

```
Cash & Bank
├── Bank Accounts (list of bank/cash accounts)
├── Transactions (all bank/cash transactions)
├── Transfer Money (between accounts)
├── Adjustments (balance corrections)
└── Reconciliation (bank statement matching)
```

### Filey Improvements Needed

- **Add Cash & Bank module** entirely (currently missing)
- **Add bank account management**
- **Add fund transfer** between accounts
- **Add bank reconciliation**
- **Add cash/bank account balance** on dashboard

---

## 11. Reports Module

### Full Report List

```
Reports
├── Transaction report
│   ├── Sale
│   ├── Purchase
│   ├── Day book
│   ├── All Transactions
│   ├── Profit And Loss
│   ├── Bill Wise Profit
│   ├── Sale Aging
│   ├── Cash flow
│   ├── Trial Balance Report
│   └── Balance Sheet
├── Party report
│   ├── Party Statement
│   ├── Party wise Profit & Loss
│   ├── All parties
│   ├── Party Report By Item
│   ├── Sale Purchase By Party
│   └── Sale Purchase By Party Group
├── Item report
│   ├── (item-level reports, not fully captured)
│   └── ...
├── Inventory report
│   └── ...
├── Tax report
│   └── ...
└── More categories
    └── ...
```

### Reports Layout (within Reports page)

```
┌──────────────┬─────────────────────────────────────────────┐
│ Report List  │  Report Viewer                               │
│ (left panel) │  (shows selected report with filters)        │
│              │                                              │
│ Transaction  │  ┌────────────────────────────────────┐     │
│  ├ Sale      │  │ [Period ▾] [Date Range] [Firm] [User]│     │
│  ├ Purchase  │  │                                     │     │
│  ├ Day book  │  │ [Report table or chart]              │     │
│  ├ All Trans │  │                                     │     │
│  ├ P&L       │  │ [Export Excel] [Print]               │     │
│  ├ Bill Wise │  └────────────────────────────────────┘     │
│  ├ Sale Aging│                                              │
│  ├ Cash flow │                                              │
│  ├ Trial Bal │                                              │
│  └ Balance S │                                              │
│ Party        │                                              │
│  ├ Statement │                                              │
│  ├ P&L/Party │                                              │
│  ├ All parti │                                              │
│  └ ...       │                                              │
└──────────────┴─────────────────────────────────────────────┘
```

### Filey Improvements Needed — Reports

**Critical (add these first):**
1. **Profit & Loss** statement (income vs expenses)
2. **Balance Sheet** (assets = liabilities + equity)
3. **Trial Balance** (debit/credit summary)
4. **Cash Flow** statement
5. **Party Statement** (ledger for each customer/supplier)

**High Priority:**
6. **Sale Aging** (overdue invoice analysis: 0-30, 31-60, 61-90, 90+ days)
7. **Bill Wise Profit** (profit per invoice)
8. **All Transactions** (complete ledger)
9. **Daybook** (daily transaction summary)
10. **Party-wise P&L** (profitability by customer)

**Medium:**
11. Party Report By Item (what items each party bought)
12. Sale Purchase By Party
13. Sale Purchase By Party Group
14. Item-level reports
15. Inventory reports
16. Tax reports (VAT summary)

---

## 12. Grow Your Business

### Features

| Feature | Purpose |
|---|---|
| WhatsApp Marketing | Send invoices/quotes via WhatsApp directly |
| Google Profile Manager | Connect Google Business Profile for reviews |
| Online Store | Create online storefront |
| Email Marketing | Send bulk emails to parties |

### Filey Improvements Needed

- **Add WhatsApp share** for invoices/quotes (share PDF directly)
- **Add Google Business Profile** integration
- **Add email invoice** feature (send PDF via email)

---

## 13. Sync, Share & Backup

### Features

| Feature | Purpose |
|---|---|
| Auto Backup | Scheduled local backup (daily/weekly) |
| Google Drive Backup | Cloud backup to Google Drive |
| Multi-Device Sync | Sync across devices |
| Data Import | Import from other apps/Excel |
| Data Export | Export all data to Excel |
| Share Business Data | Share with accountant/partner |

### Filey Improvements Needed

- **Add auto-backup** (local + cloud)
- **Add Supabase backup** (already using Supabase — add scheduled backup)
- **Add Excel import/export** for bulk data
- **Add data sharing** with accountant

---

## 14. Utilities & Settings

### Features

| Feature | Purpose |
|---|---|
| Firm Settings | Business profile, logo, address, tax info |
| Invoice Settings | Numbering, prefix, template customization |
| Tax Settings | Tax rates, tax type (VAT) |
| Print Settings | Paper size, margins, header/footer |
| User Management | Multi-user access with roles |
| Theme | Light/dark mode |
| Currency | Multi-currency support |
| Number Format | Number formatting preferences |

### Filey Improvements Needed

- **Add invoice numbering** with prefix/suffix customization
- **Add multi-user** with role-based permissions
- **Add firm settings** page (business info, logo, TRN, address)
- **Add tax settings** (VAT rate configuration)
- **Add print template customization**

---

## 15. Filey ERP Gap Analysis & Recommendations

### Priority Matrix

#### 🔴 Critical (Core business operations)

| # | Feature | Effort | Impact |
|---|---|---|---|
| 1 | Payment Terms + Due Date on invoice | Small | High |
| 2 | Per-line Discount % and Tax % | Medium | High |
| 3 | Payment-In (receipt tracking) | Medium | High |
| 4 | Sale Return/Credit Note | Medium | High |
| 5 | Cash & Bank module | Large | High |
| 6 | P&L, Balance Sheet, Trial Balance reports | Large | High |
| 7 | Party Statement (ledger) | Medium | High |

#### 🟡 High (UAE compliance & UX)

| # | Feature | Effort | Impact |
|---|---|---|---|
| 8 | Date of Supply, Country, Place of Supply | Small | High |
| 9 | Credit Limit on parties | Small | Medium |
| 10 | PO No. + PO Date on invoice | Small | Medium |
| 11 | Dashboard with summary cards + chart | Medium | High |
| 12 | Proforma Invoice module | Small | Medium |
| 13 | Sale Order module | Small | Medium |
| 14 | Delivery Note module | Small | Medium |
| 15 | Party balance in autocomplete | Small | Medium |

#### 🟢 Medium (Polish & efficiency)

| # | Feature | Effort | Impact |
|---|---|---|---|
| 16 | Terms & Conditions block on invoice | Small | Low |
| 17 | No. of copies (Original/Duplicate/Triplicate) | Small | Low |
| 18 | Round Off checkbox | Small | Low |
| 19 | Credit/Cash toggle on invoice | Small | Low |
| 20 | Tab system (multiple open invoices) | Large | Medium |
| 21 | Services + Category + Units tabs | Medium | Medium |
| 22 | Excel export from list views | Small | Medium |
| 23 | Month-over-month comparison | Small | Medium |
| 24 | WhatsApp share invoices | Small | Medium |
| 25 | Sale Aging report | Medium | Medium |
| 26 | Cash Flow report | Medium | High |
| 27 | Bill Wise Profit report | Medium | Medium |

#### 🔵 Low (Nice to have)

| # | Feature | Effort | Impact |
|---|---|---|---|
| 28 | Google Business Profile integration | Medium | Low |
| 29 | Online store | Large | Low |
| 30 | Customizable dashboard widgets | Medium | Low |
| 31 | Multi-currency | Medium | Low |
| 32 | Add Image to invoice | Small | Low |
| 33 | Generate e-Invoice (FTA ready) | Large | Low (future) |
| 34 | Phone contact import | Small | Low |
| 35 | Auto-backup + cloud sync | Medium | Medium |

### Recommended Implementation Order

```
Phase 1 — Invoice Form Enhancement (1-2 weeks)
├── Payment Terms dropdown + Due Date
├── Per-line Discount % and Tax %
├── PO No. + PO Date fields
├── Date of Supply + Country + Place of Supply
├── Terms & Conditions block
├── Credit/Cash toggle
└── No. of copies dropdown

Phase 2 — New Modules (2-3 weeks)
├── Payment-In (receipts)
├── Sale Return/Credit Note
├── Proforma Invoice
├── Sale Order
├── Delivery Note
└── Cash & Bank module

Phase 3 — Dashboard & Reports (2-3 weeks)
├── Dashboard summary cards (receivable/payable/sales)
├── Sales chart (bar graph)
├── P&L report
├── Balance Sheet report
├── Trial Balance report
├── Cash Flow report
├── Party Statement (ledger)
├── Sale Aging report
└── Bill Wise Profit report

Phase 4 — Party & Item Enhancements (1-2 weeks)
├── Credit Limit field on parties
├── Party balance in autocomplete
├── Split-view for parties (master-detail)
├── Split-view for items
├── Services tab
├── Category management
└── Units management

Phase 5 — Polish (1-2 weeks)
├── Month-over-month comparison
├── Excel export from all list views
├── Round Off checkbox
├── Status badges (Paid/Unpaid)
├── WhatsApp share invoices
├── Invoice numbering customization
└── Firm settings page
```

---

## Summary

Vyapar's core strengths over Filey:

1. **Complete transaction lifecycle**: Quote → Proforma → Sale Order → Invoice → Delivery Note → Payment-In → Return/Credit Note
2. **Financial reporting**: P&L, Balance Sheet, Trial Balance, Cash Flow — essential for business management
3. **UAE VAT compliance fields**: Date of Supply, Country, Place of Supply, e-Invoice ready
4. **Dashboard with insights**: Receivable/Payable cards, sales chart, month comparison
5. **Cash & Bank management**: Full bank account tracking, transfers, reconciliation
6. **Per-line tax & discount**: Granular control on each invoice line item
7. **Party credit limits**: With alerts when exceeded
8. **Multi-firm, multi-user**: Support for multiple businesses and team members

Filey's strengths to maintain:
- ✅ Modern React + TypeScript + Vite tech stack
- ✅ iOS-style pill UI design (superior aesthetic)
- ✅ Supabase backend (real-time, cloud-native)
- ✅ Print template system (54 templates — more than Vyapar)
- ✅ Invoice Gallery system