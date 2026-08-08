import { beforeEach, describe, expect, it } from "vitest";
import { setDataMode } from "../dataMode";
import { hr, tools as appTools } from "../api";
import { TOOLS } from "../aiTools";

// Cheques, bank accounts and email templates have no table — each page keeps a
// JSON array in app_settings. The agent has to read and write the SAME key or
// the two sides quietly diverge, which is the kind of bug nobody notices until
// a cheque is missing from the register.
beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
});

const tool = (name: string) => {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

describe("the cheque register", () => {
  it("writes where the Cheques page reads", async () => {
    await tool("record_cheque").run({
      cheque_no: "000123",
      type: "issued",
      party: "Gulf Paper Co",
      bank: "ENBD",
      amount: 1500,
      due_date: "2026-09-01",
    });

    const settings = await appTools.settings();
    const raw = settings.find((s) => s.key === "cheque_register")?.value;
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw as string);
    expect(stored[0].cheque_no).toBe("000123");
    expect(stored[0].status).toBe("pending");

    const listed = (await tool("list_cheques").run({})) as {
      count: number;
      pending_total: number;
    };
    expect(listed.count).toBe(1);
    expect(listed.pending_total).toBe(1500);
  });

  it("refuses a cheque that is neither issued nor received", async () => {
    const r = (await tool("record_cheque").run({
      cheque_no: "1",
      type: "borrowed",
      party: "X",
      amount: 10,
    })) as { error?: string };
    expect(r.error).toBeTruthy();
  });

  it("filters by status", async () => {
    await tool("record_cheque").run({
      cheque_no: "A",
      type: "received",
      party: "Acme",
      amount: 100,
    });
    const cleared = (await tool("list_cheques").run({ status: "cleared" })) as {
      count: number;
    };
    expect(cleared.count).toBe(0);
  });
});

describe("payroll", () => {
  it("creates a run for a named employee and totals the net pay", async () => {
    await hr.createEmployee({
      name: "Ravi Kumar",
      role: "Driver",
      salary: 4000,
      status: "active",
    } as never);

    const run = (await tool("run_payroll").run({
      employee_name: "ravi",
      period: "2026-07",
      basic: 4000,
      allowances: 500,
      deductions: 200,
    })) as { ok: boolean; net_pay: number };
    expect(run.ok).toBe(true);
    expect(run.net_pay).toBe(4300);

    const listed = (await tool("list_payroll").run({ period: "2026-07" })) as {
      count: number;
      total_net: number;
    };
    expect(listed.count).toBe(1);
    expect(listed.total_net).toBe(4300);
  });

  it("says so when the employee doesn't exist", async () => {
    const r = (await tool("run_payroll").run({
      employee_name: "Nobody At All",
      period: "2026-07",
      basic: 100,
    })) as { error?: string };
    expect(r.error).toBeTruthy();
  });
});

describe("the WPS salary file", () => {
  it("reports what is missing instead of writing a file the bank rejects", async () => {
    await hr.createEmployee({
      name: "Ravi Kumar",
      role: "Driver",
      salary: 4000,
      status: "active",
    } as never);
    const r = (await tool("generate_wps_file").run({
      from: "2026-07-01",
      to: "2026-07-31",
    })) as { error?: string; problems?: string[] };
    expect(r.error).toBeTruthy();
    expect(r.problems?.length).toBeGreaterThan(0);
  });
});

describe("bank accounts", () => {
  it("reads the list the Bank Accounts page keeps", async () => {
    await appTools.setSetting(
      "bank_accounts",
      JSON.stringify([
        {
          id: 1,
          bank_name: "ENBD",
          account_name: "Filey FZE",
          account_number: "123",
          iban: "AE070331234567890123456",
          currency: "AED",
          opening_balance: 0,
          current_balance: 25_000,
        },
      ])
    );
    const r = (await tool("list_bank_accounts").run({})) as {
      count: number;
      total_balance: number;
    };
    expect(r.count).toBe(1);
    expect(r.total_balance).toBe(25_000);
  });
});
