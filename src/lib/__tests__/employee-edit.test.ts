// @vitest-environment jsdom
// People had no way to edit a person — only add, toggle status and delete.
// Covers the update path behind the new Edit action.
import { beforeAll, test, expect } from "vitest";

beforeAll(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
});

test("an employee's details can be edited after creation", async () => {
  const { hr } = await import("../api");
  await hr.createEmployee({
    employee_code: "E-1",
    name: "Asha Nair",
    email: "asha@example.com",
    department: "Sales",
    position: "Executive",
    salary: 5000,
    hire_date: "2026-01-05",
  } as never);

  const created = (await hr.employees()).find((e) => e.name === "Asha Nair");
  expect(created).toBeDefined();

  await hr.updateEmployee(created!.id, {
    name: "Asha Nair-Kumar",
    position: "Sales Manager",
    salary: 7500,
  });

  const updated = (await hr.employees()).find((e) => e.id === created!.id);
  expect(updated?.name).toBe("Asha Nair-Kumar");
  expect(updated?.position).toBe("Sales Manager");
  expect(updated?.salary).toBe(7500);
  // Fields left out of the edit must survive untouched.
  expect(updated?.department).toBe("Sales");
  expect(updated?.email).toBe("asha@example.com");
});
