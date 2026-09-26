import { computeBalanceSheet, computeVatReturn, isPostedStatus, type InvoiceDocSummary, type Product } from "../../lib/api";
import { supplierBillBalances, type ReportsData } from "./useReportsData";

export const lowStockRows = (products:Product[]) => products.filter(p => Number(p.quantity || 0) <= Number(p.reorder_level || 0)).sort((a,b)=>Number(a.quantity||0)-Number(b.quantity||0));
export const customerBalanceRows = (invoices:InvoiceDocSummary[]) => supplierBillBalances(invoices).map(row=>({name:row.name,outstanding:row.open,invoiceCount:row.billCount})).slice(0,10);

export const REPORT_EXPORT_LABELS = {dashboard:"Export workspace summary",sales:"Export posted invoices",inventory:"Export low-stock table",financial:"Export financial statements",customers:"Export customer balances",suppliers:"Export supplier balances"};
export type ExportReport = keyof typeof REPORT_EXPORT_LABELS;

/** Each export uses the same rows/limits as its visible report; money is AED. */
export function reportExportRows(tab:ExportReport,data:ReportsData,today:string): Record<string,unknown>[] {
  const meta={"As of":today,"Period":"All time"};
  const posted=data.invoices.filter(row=>isPostedStatus(row.status));
  if(tab==="sales") return posted.map(row=>({...meta,Invoice:row.number,Customer:row.customer_name,"Issue date":row.issue_date,"Due date":row.due_date,Status:row.status,Currency:"AED",Total:row.total,Paid:row.paid||0,Balance:row.balance??row.total}));
  if(tab==="inventory") return lowStockRows(data.products).map(row=>({"As of":today,SKU:row.sku||"—",Name:row.name,Category:row.category||"Other",Stock:Number(row.quantity||0),"Reorder level":Number(row.reorder_level||0),Status:Number(row.quantity||0)<=0?"Out":"Low"}));
  if(tab==="customers" || tab==="suppliers") {
    const invoices=tab==="customers"?data.invoices:data.purchaseInvoices;
    const all=supplierBillBalances(invoices);
    const total=all.reduce((sum,row)=>sum+row.open,0);
    return all.slice(0,10).map(row=>({...meta,Scope:"Top 10 open balances",[tab==="customers"?"Customer":"Supplier"]:row.name,"Open documents":row.billCount,Currency:"AED",Outstanding:row.open,"Percent of total":total?row.open/total*100:0}));
  }
  if(tab==="financial") {
    const rows:Record<string,unknown>[]=[];
    const add=(section:string,name:string,amount:number)=>rows.push({...meta,Section:section,Account:name,Currency:"AED",Amount:amount});
    let revenue=0,expense=0;
    for(const account of data.accounts) {
      const amount=Number(account.balance||0);
      if(account.account_type==="revenue"){add("Profit & Loss · Revenue",account.name,amount);revenue+=amount;}
      if(account.account_type==="expense"){add("Profit & Loss · Expenses",account.name,amount);expense+=amount;}
    }
    add("Profit & Loss","Total Revenue",revenue);add("Profit & Loss","Total Expenses",expense);add("Profit & Loss","Net Profit",revenue-expense);
    const bs=computeBalanceSheet(data.accounts);
    for(const [section,list,total] of [["Assets",bs.assets,bs.totalAssets],["Liabilities",bs.liabilities,bs.totalLiabilities],["Equity",bs.equity,bs.totalEquity]] as const) {
      list.forEach(row=>add(`Balance Sheet · ${section}`,row.name||"—",row.amount));add("Balance Sheet",`Total ${section}`,total);
    }
    const vat=computeVatReturn(data.txns,5,undefined,undefined,data.invoices);
    for(const [label,key] of [["Standard-rated supplies","standardSupplyNet"],["Output VAT","outputVat"],["Zero-rated supplies","zeroRatedNet"],["Exempt supplies","exemptNet"],["Input VAT","inputVat"],["Net VAT due","netVatDue"]] as const) add("VAT working summary",label,vat[key]);
    return rows;
  }
  return [
    ["Invoiced revenue",posted.reduce((sum,row)=>sum+Number(row.total||0),0),"AED"],
    ["Invoice payments",data.invoicePayments.reduce((sum,row)=>sum+row.amount,0),"AED"],
    ["Receipt documents",data.receiptList.reduce((sum,row)=>sum+Number(row.amount||0),0),"AED"],
    ["Customers",data.customers.length,"Count"],["Orders",data.orders.length,"Count"],
    ["Products",data.products.length,"Count"],["Suppliers",data.supplierList.length,"Count"],
  ].map(([Metric,Amount,Unit])=>({...meta,Metric,Amount,Unit}));
}
