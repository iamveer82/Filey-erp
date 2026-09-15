import { expect, it } from "vitest";
import { reportExportRows } from "./reportExports";
import type { ReportsData } from "./useReportsData";
import { toCsv, parseCsvObjects } from "../../lib/csv";

it("exports active report rows, balances, units and scope instead of the same summary",()=>{
  const data={products:[{id:1,name:"Low",sku:"L",quantity:2,reorder_level:5},{id:2,name:"Enough",quantity:9,reorder_level:5}],
    accounts:[{id:1,name:"Sales",account_type:"revenue",balance:200},{id:2,name:"Costs",account_type:"expense",balance:50}],
    invoices:[{id:1,number:"INV-1",customer_name:"Buyer",status:"sent",total:200,paid:50,balance:150},{id:2,number:"DRAFT",status:"draft",total:999}],
    purchaseInvoices:[{id:3,number:"BILL-3",customer_name:"Vendor",status:"sent",total:80,paid:30,balance:50}],
    invoicePayments:[],receiptList:[],customers:[],supplierList:[],orders:[],txns:[],poList:[],poPayments:[],expenses:[],loading:false,error:"",reload:()=>{},
  } as unknown as ReportsData;
  const rows=(tab:Parameters<typeof reportExportRows>[0])=>parseCsvObjects(toCsv(reportExportRows(tab,data,"2026-09-13"))).rows;
  expect(rows("sales")).toHaveLength(1);
  expect(rows("sales")[0]).toMatchObject({Invoice:"INV-1",Currency:"AED",Balance:"150",Period:"All time"});
  expect(rows("inventory")).toHaveLength(1);
  expect(rows("inventory")[0]).toMatchObject({Name:"Low",Stock:"2","Reorder level":"5"});
  expect(rows("customers")[0]).toMatchObject({Customer:"Buyer",Outstanding:"150",Scope:"Top 10 open balances"});
  expect(rows("suppliers")[0]).toMatchObject({Supplier:"Vendor",Outstanding:"50"});
  expect(rows("financial").find(row=>row.Account==="Net Profit")).toMatchObject({Amount:"150",Currency:"AED",Section:"Profit & Loss"});
  expect(rows("dashboard").find(row=>row.Metric==="Customers")).toMatchObject({Amount:"0",Unit:"Count"});
});
