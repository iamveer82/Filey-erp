import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { billing, fin, pos, type InvoiceDocInput } from "../api";
import { setDataMode } from "../dataMode";
import { invoiceAging, supplierBillBalances, useReportsData } from "../../pages/reports/useReportsData";

vi.mock("../exchange-rates",async original=>({...await original<typeof import("../exchange-rates")>(),getExchangeRates:async()=>({AED:1,USD:3.6})}));
beforeEach(()=>{localStorage.clear();setDataMode("local");});
afterEach(cleanup);

it("reports an unlinked supplier bill net of partial payments at its frozen FX rate; unreceived POs are separate",async()=>{
  const bill: InvoiceDocInput = {
    number:"BILL-PAYABLES",doc_type:"purchase",status:"sent",customer_name:"Fixture Supplier",
    currency:"USD",fx_rate:4,tax_rate:0,discount:0,template:"classic",accent:"#ffd600",
    seller_name:"Fixture",issue_date:"2026-08-01",due_date:"2026-08-15",
    items:[{description:"Service",qty:1,unit_price:100}],
  };
  const id=await billing.saveDoc(bill);
  await billing.addPayment(id,25,"bank","2026-08-20");
  await pos.save({po_number:"PO-UNRECEIVED",order_date:"2026-08-01",accent:"#ffd600",total:900,supplier_name:"Fixture Supplier",status:"sent",currency:"AED",template:"classic",items:[{description:"Unreceived stock",quantity:1,unit_cost:900}]});
  const {result}=renderHook(()=>useReportsData());
  await waitFor(()=>expect(result.current.loading).toBe(false));
  expect(result.current.error).toBe("");
  expect(result.current.invoices).toEqual([]);
  expect(result.current.purchaseInvoices[0]).toMatchObject({id,total:400,paid:100,balance:300,currency:"AED"});
  expect(invoiceAging(result.current.purchaseInvoices,"2026-09-13")).toEqual({current:0,d30:300,d60:0,d90:0,d90p:0});
  expect(supplierBillBalances(result.current.purchaseInvoices)).toEqual([{name:"Fixture Supplier",open:300,billCount:1}]);
  expect((await fin.accounts()).find(row=>/accounts payable/i.test(row.name))?.balance).toBeCloseTo(300);
  expect(result.current.poList[0].total).toBe(900);
});
