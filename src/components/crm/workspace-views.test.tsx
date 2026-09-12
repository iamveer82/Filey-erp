import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Crm from "../../pages/Crm";
import { setCacheOrg } from "../../lib/api";
import { setDataMode } from "../../lib/dataMode";
import {
  emptyCrmData,
  loadCrmData,
  saveCrmRecord,
  saveCrmStatus,
  convertCrmLead,
  type CrmData,
} from "../../lib/crmWorkspace";

const { prompt, success, identity } = vi.hoisted(() => ({
  prompt: vi.fn(),
  success: vi.fn(),
  identity: { user: { id: "account-a" } as { id: string } | null },
}));
vi.mock("../../lib/auth", () => ({ useAuth: () => identity }));
vi.mock("../../lib/ui", () => ({
  useUI: () => ({ prompt, confirm: vi.fn(), toast: { success, error: vi.fn() } }),
}));
vi.mock("../../lib/realtime", () => ({ useLiveSync: () => {} }));
vi.mock("../../lib/customFields", async original => ({ ...await original<object>(), syncCustomFields: vi.fn(async () => []) }));
vi.mock("../../lib/crmWorkspace", async (load) => ({
  ...(await load<object>()),
  loadCrmData: vi.fn(),
  saveCrmRecord: vi.fn(),
  saveCrmStatus: vi.fn(),
  convertCrmLead: vi.fn(),
}));
let data: CrmData;
beforeEach(() => {
  localStorage.clear();
  identity.user = { id: "account-a" };
  setCacheOrg(null, identity.user.id);
  setDataMode("local");
  vi.clearAllMocks();
  data = emptyCrmData();
  data.companies = [
    { id: 1, company: "Zulu Company" },
    { id: 2, company: "Alpha Company" },
  ];
  vi.mocked(loadCrmData).mockImplementation(async () => data);
  vi.mocked(saveCrmRecord).mockResolvedValue(5);
  prompt.mockResolvedValue("Sales focus");
});
afterEach(cleanup);
function mount(path = "/crm?view=companies") {
  return render(workspace(path));
}
function workspace(path = "/crm?view=companies") {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Crm />
    </MemoryRouter>
  );
}
function savedViewEntries() {
  return Object.entries(localStorage).filter(([key]) =>
    key.startsWith("filey.crm.workspace.views.v2:")
  );
}

it("saves and restores the actual header sorting and chosen columns", async () => {
  mount();
  await screen.findByRole("button", { name: "Zulu Company" });
  fireEvent.click(
    screen.getByRole("columnheader", { name: /Name/ }).querySelector("button")!
  );
  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
    "aria-sort",
    "ascending"
  );
  fireEvent.click(screen.getByRole("button", { name: "View options" }));
  fireEvent.click(screen.getByLabelText("Phone (international format)"));
  expect(screen.queryByRole("columnheader", { name: /Phone/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  await screen.findByRole("button", { name: "Sales focus" });
  expect(JSON.parse(savedViewEntries()[0][1])[0]).toMatchObject({
    sort: "record",
    direction: "asc",
  });
  fireEvent.click(
    screen.getByRole("columnheader", { name: /Name/ }).querySelector("button")!
  );
  fireEvent.click(screen.getByLabelText("Phone (international format)"));
  fireEvent.click(screen.getByRole("button", { name: "Sales focus" }));
  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
    "aria-sort",
    "ascending"
  );
  expect(screen.queryByRole("columnheader", { name: /Phone/ })).not.toBeInTheDocument();
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("Alpha Company");
});

it("isolates saved views across accounts, modes, and cloud organizations without migrating anonymous views", async () => {
  const legacy = JSON.stringify([
    {
      name: "Legacy private view",
      view: "companies",
      q: "Old client",
      status: "",
      owner: "",
      mode: "list",
    },
  ]);
  localStorage.setItem("filey.crm.workspace.views.v1", legacy);
  const mounted = mount();
  await screen.findByRole("button", { name: "Zulu Company" });
  expect(
    screen.queryByRole("button", { name: "Legacy private view" })
  ).not.toBeInTheDocument();
  expect(savedViewEntries()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  await screen.findByRole("button", { name: "Sales focus" });
  const [localKey, localValue] = savedViewEntries()[0];

  identity.user = { id: "account-b" };
  // A pending/stale auth cache may never expose the preceding user's labels.
  mounted.rerender(workspace());
  expect(screen.queryByRole("button", { name: "Sales focus" })).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Save view" })).toBeDisabled();
  setCacheOrg(null, identity.user.id);
  mounted.rerender(workspace());
  await screen.findByRole("button", { name: "Zulu Company" });
  prompt.mockResolvedValue("Account B view");
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  await screen.findByRole("button", { name: "Account B view" });

  identity.user = { id: "account-a" };
  setCacheOrg("org-one", identity.user.id);
  setDataMode("cloud");
  mounted.rerender(workspace());
  await screen.findByRole("button", { name: "Zulu Company" });
  expect(screen.queryByRole("button", { name: "Sales focus" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Account B view" })
  ).not.toBeInTheDocument();
  prompt.mockResolvedValue("Cloud view");
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  await screen.findByRole("button", { name: "Cloud view" });
  setCacheOrg("org-two", identity.user.id);
  mounted.rerender(workspace());
  expect(screen.queryByRole("button", { name: "Cloud view" })).not.toBeInTheDocument();

  setCacheOrg(null, identity.user.id);
  setDataMode("local");
  mounted.rerender(workspace());
  expect(await screen.findByRole("button", { name: "Sales focus" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cloud view" })).not.toBeInTheDocument();
  expect(savedViewEntries()).toHaveLength(3);
  expect(localStorage.getItem(localKey)).toBe(localValue);
  expect(localStorage.getItem("filey.crm.workspace.views.v1")).toBe(legacy);
  expect(saveCrmRecord).not.toHaveBeenCalled();
});

it("ignores a Save view prompt completed after the workspace changed", async () => {
  let finishPrompt!: (value: string) => void;
  prompt.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finishPrompt = resolve;
      })
  );
  const mounted = mount();
  await screen.findByRole("button", { name: "Zulu Company" });
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  identity.user = { id: "account-b" };
  setCacheOrg(null, identity.user.id);
  mounted.rerender(workspace());
  await act(async () => finishPrompt("Previous workspace view"));
  expect(savedViewEntries()).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: "Previous workspace view" })
  ).not.toBeInTheDocument();
});

it("returns from a linked contact editor to the company without writing on cancel", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Alpha Company" }));
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  expect(screen.getByLabelText("Company")).toHaveValue("2");
  fireEvent.change(screen.getByLabelText("Full name *"), {
    target: { value: "Unsaved person" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("dialog", { name: "Alpha Company" })).toBeInTheDocument();
  expect(saveCrmRecord).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add contact" }));
  fireEvent.change(screen.getByLabelText("Full name *"), { target: { value: "Sam" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Create contact" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Create contact" }));
  await waitFor(() =>
    expect(saveCrmRecord).toHaveBeenCalledWith(
      "contacts",
      expect.objectContaining({ name: "Sam", company_id: "2" }),
      data,
      undefined
    )
  );
  await screen.findByRole("dialog", { name: "Alpha Company" });
});

it("shows related task counts and preserves navigation back from a task", async () => {
  data.tasks = [
    { id: 7, title: "Call buyer", target_type: "company", target_id: 2, status: "open" },
  ];
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Alpha Company" }));
  fireEvent.click(screen.getByRole("button", { name: "Tasks 1" }));
  fireEvent.click(screen.getByRole("button", { name: /Call buyer/ }));
  expect(screen.getByRole("dialog", { name: "Call buyer" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByText(
      "Save changes to return to Alpha Company. Cancel keeps you on this record."
    )
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("dialog", { name: "Call buyer" })).toBeInTheDocument();
  expect(saveCrmRecord).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to Alpha Company" }));
  expect(screen.getByRole("dialog", { name: "Alpha Company" })).toBeInTheDocument();
});

it("completes a task from a due view and refreshes it out of that view", async () => {
  data.tasks = [
    { id: 7, title: "Call buyer", due_date: "2000-01-01", status: "open" },
    { id: 8, title: "Already done", due_date: "2000-01-01", status: "done" },
  ];
  vi.mocked(saveCrmStatus).mockImplementation(async () => {
    data = { ...data, tasks: data.tasks.map((row) => ({ ...row, status: "done" })) };
  });
  mount("/crm?view=tasks&due=overdue");
  const complete = await screen.findByRole("button", { name: "Complete Call buyer" });
  expect(screen.queryByRole("button", { name: "Already done" })).not.toBeInTheDocument();
  fireEvent.click(complete);
  await waitFor(() =>
    expect(saveCrmStatus).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({ id: 7 }),
      "done"
    )
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Call buyer" })).not.toBeInTheDocument()
  );
});

it("restores a linked record drawer from its URL and returns to the parent without writes", async () => {
  data.contacts = [{ id: 9, name: "Sam", company_id: 2 }];
  mount("/crm?view=companies&q=Alpha&record=companies:2,contacts:9");
  await screen.findByRole("dialog", { name: "Sam" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Alpha Company" }));
  expect(screen.getByRole("dialog", { name: "Alpha Company" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("textbox", { name: "Search companies" })).toHaveValue("Alpha");
  expect(saveCrmRecord).not.toHaveBeenCalled();
});

it("shows an unavailable deep link instead of opening a different or stale record", async () => {
  mount("/crm?view=companies&record=companies:999");
  await screen.findByText(/This record is unavailable in the current workspace/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText(/This record is unavailable/)).not.toBeInTheDocument();
  expect(saveCrmRecord).not.toHaveBeenCalled();
});

it("offers conversion and an explicit AI handoff without starting work when a lead is opened", async () => {
  data.leads = [{ id: 11, name: "Prospect", company: "New business", status: "new" }];
  mount("/crm?view=leads&record=leads:11");
  await screen.findByRole("dialog", { name: "Prospect" });
  expect(screen.getByRole("button", { name: "Convert lead" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "Continue in Filey AI" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Draft a follow-up" }));
  expect((screen.getByLabelText("Review your request") as HTMLTextAreaElement).value).toContain("lead #11");
  expect(screen.getByRole("link", { name: "Continue in Filey AI" })).toHaveAttribute(
    "href",
    "/agent"
  );
  expect(saveCrmRecord).not.toHaveBeenCalled();
});

it("opens the linked deal after a successful lead conversion", async () => {
  data.leads = [{ id: 11, name: "Prospect", status: "new" }];
  vi.mocked(convertCrmLead).mockImplementation(async () => {
    data = {
      ...data,
      contacts: [{ id: 15, company_id: 2, name: "Prospect" }],
      deals: [
        {
          id: 20,
          title: "New contract",
          stage: "qualification",
          customer_id: 2,
          person_id: 15,
        },
      ],
    };
    return 20;
  });
  mount("/crm?view=leads&record=leads:11");
  fireEvent.click(await screen.findByRole("button", { name: "Convert lead" }));
  await screen.findByRole("dialog", { name: "New contract" });
  expect(convertCrmLead).toHaveBeenCalledExactlyOnceWith(11);
  expect(screen.getByRole("button", { name: "Alpha Company" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Prospect" })).toBeInTheDocument();
});
