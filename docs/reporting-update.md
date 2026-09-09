# Reports and Overview update — September 7, 2026

Section insights now live in **Reports → Insights**. The section selector covers ERP records, CRM objects, communications and files; the operating pages no longer repeat the Insights panel. CRM's Reports action opens the deal insights in Reports. Existing operational summaries remain available.

Overview uses saved workspace records for invoiced sales, invoice payments, receipt documents, expenses and customer segments. The money charts share a 7-, 30- or 90-day period. A period with no qualifying records shows an empty state. Reports and Overview share the seven-day invoice/payment/receipt series and the same calendar windows for their 30-day comparisons.

## Data rules

- Invoiced revenue includes sent, paid and overdue invoices; drafts and cancelled invoices are excluded. Invoice trends use issue dates.
- **Invoice payments** includes dated payment records joined to posted sales invoices, using the payment date and the invoice's saved exchange rate. Supplier-bill payments and payments without a qualifying sales invoice are excluded. Recording a payment against an older invoice now appears on its payment date, even when the invoice's issue date falls outside the chart window.
- **Receipt documents** includes paid payment-receipt documents on their payment dates. These documents have no stable link to invoice-payment records and may describe the same money, so the charts and exports keep the two sources separate. They are never summed into a combined cash-received total. Reports' Invoice payments KPI sums only invoice payments; the Financial tab's ledger cash summary remains the source for cash movements, including any settlement exchange-rate differences.
- Monetary reporting copies normalize to AED using saved document rates where present. Displayed totals, axes and tooltips use the selected display currency. Overview and report CSV exports use AED; source documents are unchanged.
- Purchase-order summaries retain their frozen exchange rates, and payment deductions use the same rate as their order. Payment and file reads paginate cloud results and surface read failures.
- Section distributions count all saved source records. Monthly trends exclude missing or invalid dates. Date-only business fields retain their dates; timestamps use the viewer's local month. Recent email and call insights are explicitly limited to the latest 100 log entries.
- Settings-backed insights read through the active workspace API, without falling back to an unscoped browser cache.
- Successful saves, local writes and received sync events trigger debounced refreshes. Latest-request guards prevent an older response from replacing a newer selection or snapshot. Failed loads show an error and retry action.

Invoice-payment history uses the shared workspace API and paginates cloud results. Overview and Reports commit it with the rest of their snapshot; a failed history read shows an error rather than a misleading zero. Calendar trend windows exclude payments before the start date or after today.

The Help Center's chart guide describes where to find insights and how to interpret the figures. Buttons retain the shared pill styling.

## Verification

The invoice-payment follow-up passed 22 focused tests across four files (`overview-charts`, `invoice-payment-reporting`, `cloud-data-reads`, and `purchase-accounting`). They exercise a real local saved invoice/payment through the Reports loader, separate supplier-bill exclusion, frozen-rate conversion, payment-date charts, reversal refresh, independent receipt documents, future-date boundaries, cloud pagination and failed history reads. Focused lint reports no errors (three existing Reports hook dependency warnings).

93 focused tests passed across 13 files. They cover source switching, stale responses, failed reads, retry, workspace-specific settings, invoice/receipt status filtering, local date boundaries, frozen exchange rates, cloud pagination and data-change refreshes. TypeScript and the Vite production build passed; focused lint found no errors. Existing build warnings about bundle sizes, mixed imports and optional conversion assets remain.

Browser verification used the existing cloud records through localhost: Overview and Sales Reports agreed on invoiced revenue and outstanding balances; 90-day chart rendering, customer counts, section selection, chart data tables and empty states were checked. No business records were created for charts. Release packaging and live multi-device sync remain separate release checks.
