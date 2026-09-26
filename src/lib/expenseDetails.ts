import { invoiceTotals, r2 } from "./money";

export const EXPENSE_CATEGORIES = ["Office Supplies", "Rent", "Utilities", "Salaries", "Travel", "Meals", "Software", "Marketing", "Maintenance", "Fuel", "Logistics", "Insurance", "Professional Fees", "Bank Charges", "Miscellaneous"];
export const EXPENSE_METHODS = ["Cash", "Bank transfer", "Card", "Other"];
export interface ExpenseLine { description: string; qty: number; unit: string; unit_price: number }
export interface ExpenseDetails {
  version: 1;
  submission_id: string;
  vendor: string;
  reference: string;
  currency: string;
  fx_rate: number;
  items: ExpenseLine[];
  discount: number;
  tax_rate: number;
  payment_method: string;
  payment_account_id: number | null;
  notes: string;
  receipt?: { id: string; name: string; mime: string; size: number };
}
export const expenseTotals = (details: Pick<ExpenseDetails, "items" | "discount" | "tax_rate">) =>
  invoiceTotals(details.items, details.discount, details.tax_rate);

export function validateExpense(category: string, amount: number, date: string, details?: ExpenseDetails | null) {
  if (!category.trim() || category.length > 100) throw new Error("Choose an expense category.");
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) throw new Error("Enter an expense total greater than zero and below 1 trillion AED.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error("Enter a valid expense date.");
  if (!details) return;
  if (details.version !== 1 || !/^[a-f\d-]{36}$/i.test(details.submission_id)) throw new Error("Reopen this expense form before saving.");
  if (!details.vendor.trim() || details.vendor.length > 200 || details.reference.length > 200 || details.notes.length > 5000)
    throw new Error("Enter a vendor name; keep references under 200 and notes under 5,000 characters.");
  if (!/^[A-Z]{3}$/.test(details.currency) || !Number.isFinite(details.fx_rate) || details.fx_rate <= 0 || details.fx_rate > 1e6 || (details.currency === "AED" && details.fx_rate !== 1))
    throw new Error("Enter the exchange rate in AED for one unit of this currency.");
  if (!EXPENSE_METHODS.includes(details.payment_method)) throw new Error("Choose a payment method.");
  if (details.payment_account_id !== null && (!Number.isSafeInteger(details.payment_account_id) || details.payment_account_id <= 0)) throw new Error("Choose a valid payment account.");
  if (!Array.isArray(details.items) || !details.items.length || details.items.length > 100) throw new Error("Add between 1 and 100 expense items.");
  for (const [index, item] of details.items.entries()) {
    if (!item.description.trim() || item.description.length > 1000 || !item.unit.trim() || item.unit.length > 30 || !Number.isFinite(item.qty) || item.qty <= 0 || item.qty > 1e9 || !Number.isFinite(item.unit_price) || item.unit_price < 0 || item.unit_price > 1e12)
      throw new Error(`Item ${index + 1} needs a description, unit, positive quantity and valid unit price.`);
  }
  const subtotal = expenseTotals({ ...details, discount: 0, tax_rate: 0 }).subtotal;
  if (!Number.isFinite(details.discount) || details.discount < 0 || details.discount > subtotal || !Number.isFinite(details.tax_rate) || details.tax_rate < 0 || details.tax_rate > 100)
    throw new Error("Discount must not exceed the subtotal; tax must be between 0 and 100%.");
  if (r2(expenseTotals(details).total * details.fx_rate) !== r2(amount)) throw new Error("Expense total does not match its line items.");
  if (details.receipt && (!details.receipt.id || !details.receipt.name || details.receipt.size <= 0 || details.receipt.size > 10 * 1024 * 1024 || !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(details.receipt.mime)))
    throw new Error("Attach a PDF, PNG, JPG or WebP receipt up to 10 MB.");
}

export function validateReceipt(file: File): string {
  const mime = ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[file.name.split(".").pop()?.toLowerCase() || ""];
  if (!mime || (file.type && file.type !== mime) || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a PDF, PNG, JPG or WebP receipt up to 10 MB.");
  return mime;
}
