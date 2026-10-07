import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setCacheOrg, tools } from "../api";
import { loadModuleAccess, requireToolModuleAccess } from "../moduleAccess";
import { runTool } from "../aiTools";
import { ModulesProvider, useModules } from "../modules";
import { notifyDataChanged } from "../realtime";
import { connectionSummary, integrationAllowed, integrationEntity } from "../../../supabase/functions/_shared/integration-access";

const rpc = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => ({select:vi.fn(),order:vi.fn(),range:vi.fn(),then:vi.fn()}));
vi.mock("../supabase",()=>({supabase:{rpc},isConfigured:true,sb:()=>({from:()=>query})}));
vi.mock("../auth",()=>({useAuth:()=>({user:{id:"staff"}})}));
function Consumer() { const access = useModules(); return <div>{access.loading ? "Loading" : access.error || (access.isEnabled("people") ? "People allowed" : "People blocked")}</div>; }
beforeEach(()=>{
  localStorage.clear(); localStorage.setItem("filey_data_mode","cloud");
  setCacheOrg("org","staff"); vi.clearAllMocks();
  rpc.mockResolvedValue({data:{allowed:true,admin:false,modules:["inventory"]},error:null});
  for (const name of ["select","order","range"] as const) query[name].mockReturnValue(query);
  query.then.mockImplementation((resolve: (value:unknown)=>unknown)=>Promise.resolve(resolve({data:[],error:null})));
});
afterEach(()=>{cleanup();setCacheOrg(null);vi.unstubAllGlobals();});

it("fails closed on unavailable and missing memberships",async()=>{
  rpc.mockResolvedValueOnce({data:null,error:{message:"offline"}});
  await expect(loadModuleAccess()).rejects.toThrow("could not be verified");
  rpc.mockResolvedValueOnce({data:{allowed:false,admin:false,modules:[]}});
  await expect(loadModuleAccess()).rejects.toThrow("could not be verified");
});
it("rejects forbidden reads and native powers even in an authenticated agent context",async()=>{
  await expect(requireToolModuleAccess("list_employees",{})).rejects.toThrow("people");
  await expect(requireToolModuleAccess("financial_summary",{})).rejects.toThrow("accounting");
  await expect(requireToolModuleAccess("run_shell",{})).rejects.toThrow("administrator");
  await expect(requireToolModuleAccess("create_product",{})).resolves.toBeUndefined();
});
it("checks the destination module before AI navigation and keeps core pages accessible", async () => {
  const hash = window.location.hash;
  try {
    window.location.hash = "#/overview";
    rpc.mockResolvedValue({ data: { allowed: true, admin: false, modules: ["tools"] }, error: null });
    await expect(runTool("open_page", { page: "letters" })).resolves.toEqual({ error: expect.stringContaining("letters") });
    expect(window.location.hash).toBe("#/overview");
    await expect(requireToolModuleAccess("open_page", { page: "/overview" })).resolves.toBeUndefined();
    await expect(requireToolModuleAccess("open_page", { page: "settings" })).resolves.toBeUndefined();
    rpc.mockResolvedValue({ data: { allowed: true, admin: false, modules: ["letters"] }, error: null });
    await expect(runTool("open_page", { page: "letters" })).resolves.toEqual({ ok: true, message: "Opened letters." });
    expect(window.location.hash).toBe("#/letters");
    rpc.mockResolvedValue({ data: { allowed: true, admin: false, modules: [] }, error: null });
    await expect(requireToolModuleAccess("open_page", { page: "letters" })).rejects.toThrow("letters");
  } finally { window.location.hash = hash; }
});
it("rejects a membership response from a previous workspace",async()=>{
  rpc.mockImplementationOnce(async()=>{setCacheOrg("other","staff");return {data:{allowed:true,admin:true,modules:null}};});
  await expect(loadModuleAccess()).rejects.toThrow("workspace changed");
});
it("does not apply restored personal administrator permissions to a removed team's cache", async () => {
  const refresh = vi.fn();
  window.addEventListener("filey:cloud-change", refresh);
  try {
    rpc.mockResolvedValue({ data: { allowed: true, admin: true, modules: null, org_id: "personal-org" }, error: null });
    await expect(loadModuleAccess()).rejects.toThrow("workspace changed");
    expect(refresh).toHaveBeenCalledOnce();
    const reads = query.select.mock.calls.length;
    await expect(tools.settings()).rejects.toThrow("workspace changed");
    expect(query.select).toHaveBeenCalledTimes(reads);
    await expect(requireToolModuleAccess("list_employees", {})).rejects.toThrow("workspace changed");
    setCacheOrg("personal-org", "staff");
    await expect(loadModuleAccess()).resolves.toEqual({ admin: true, modules: null });
  } finally { window.removeEventListener("filey:cloud-change", refresh); }
});
it.each([null, 42, ""])("rejects malformed authoritative workspace identity %j", async org_id => {
  rpc.mockResolvedValue({ data: { allowed: true, admin: true, modules: null, org_id }, error: null });
  await expect(loadModuleAccess()).rejects.toThrow("could not be verified");
});
it("keeps restricted pages blocked and shows an access error after a failed refresh",async()=>{
  render(<ModulesProvider><Consumer/></ModulesProvider>);
  await screen.findByText("People blocked");
  rpc.mockResolvedValue({data:null,error:{message:"offline"}});
  window.dispatchEvent(new Event("focus"));
  await waitFor(()=>expect(screen.getByText(/could not be verified/)).toBeInTheDocument());
  expect(screen.queryByText("People allowed")).toBeNull();
});
it("keeps an unfinished form mounted while focus rechecks workspace access", async () => {
  function Form() { const access = useModules(); return access.loading ? <p>Loading</p> : <input aria-label="Draft title" defaultValue="" />; }
  render(<ModulesProvider><Form /></ModulesProvider>);
  const input = await screen.findByLabelText("Draft title");
  fireEvent.change(input, { target: { value: "Unsaved invoice" } });
  let complete!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.focus(window);
  expect(screen.getByLabelText("Draft title")).toBe(input);
  expect(input).toHaveValue("Unsaved invoice");
  complete({ data: { allowed: true, admin: false, modules: ["inventory"] }, error: null });
  await waitFor(() => expect(screen.getByLabelText("Draft title")).toHaveValue("Unsaved invoice"));
});
it("preserves a verified same-workspace chat/form during a transport outage while fresh tool gates still reject", async () => {
  function ChatForm() {
    const access = useModules();
    return access.loading ? <p>Loading</p> : access.error ? <p>{access.error}</p> : <>
      <input aria-label="Preserved task draft" defaultValue="" />
      <p>{access.isEnabled("agent") ? "Agent mounted" : "Agent denied"}</p>
      {access.refreshError && <p role="alert">{access.refreshError}</p>}
      <button onClick={access.retry}>Retry workspace</button>
    </>;
  }
  render(<ModulesProvider><ChatForm /></ModulesProvider>);
  const draft = await screen.findByLabelText("Preserved task draft");
  fireEvent.change(draft, { target: { value: "Keep my pending request" } });
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
  fireEvent.focus(window);
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Preserved task draft")).toBe(draft);
  expect(draft).toHaveValue("Keep my pending request");
  expect(screen.getByText("Agent mounted")).toBeInTheDocument();
  await expect(requireToolModuleAccess("create_product", {})).rejects.toThrow("connection is unavailable");
  rpc.mockResolvedValue({ data: { allowed: true, admin: false, modules: ["inventory"] }, error: null });
  fireEvent.click(screen.getByText("Retry workspace"));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByLabelText("Preserved task draft")).toBe(draft);
  rpc.mockResolvedValue({ data: { allowed: false, admin: false, modules: [] }, error: null });
  fireEvent.focus(window);
  await screen.findByText(/could not be verified/);
  expect(screen.queryByText("Agent mounted")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Preserved task draft")).not.toBeInTheDocument();
});
it("never preserves unverified initial or switched-workspace access on a transport failure", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
  const first = render(<ModulesProvider><Consumer /></ModulesProvider>);
  await screen.findByText(/connection is unavailable/);
  expect(screen.queryByText("People allowed")).not.toBeInTheDocument();
  first.unmount();
  rpc.mockResolvedValue({ data: { allowed: true, admin: true, modules: null }, error: null });
  render(<ModulesProvider><Consumer /></ModulesProvider>);
  await screen.findByText("People allowed");
  rpc.mockResolvedValue({ data: null, error: { code: "", message: "TypeError: Failed to fetch" }, status: 0 });
  act(() => setCacheOrg("other", "staff"));
  await screen.findByText(/connection is unavailable/);
  expect(screen.queryByText("People allowed")).not.toBeInTheDocument();
});
it("does not let an earlier settings transport failure hide a confirmed membership denial", async () => {
  rpc.mockResolvedValue({ data: { allowed: true, admin: true, modules: null }, error: null });
  render(<ModulesProvider><Consumer /></ModulesProvider>);
  await screen.findByText("People allowed");
  let finish!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const settings = vi.spyOn(tools, "settings").mockRejectedValueOnce(new TypeError("Failed to fetch"));
  try {
    fireEvent.focus(window);
    await waitFor(() => expect(settings).toHaveBeenCalled());
    await act(async () => finish({ data: { allowed: false, admin: false, modules: [] }, error: null }));
    await screen.findByText(/could not be verified/);
    expect(screen.queryByText("People allowed")).not.toBeInTheDocument();
  } finally { settings.mockRestore(); }
});
it("applies a newly verified restricted role even when module preferences cannot be refreshed", async () => {
  function AccessStatus() {
    const access = useModules();
    return <><Consumer />{access.refreshError && <p role="status">{access.refreshError}</p>}</>;
  }
  rpc.mockResolvedValue({ data: { allowed: true, admin: true, modules: null }, error: null });
  render(<ModulesProvider><AccessStatus /></ModulesProvider>);
  await screen.findByText("People allowed");
  rpc.mockResolvedValue({ data: { allowed: true, admin: false, modules: ["inventory"] }, error: null });
  const settings = vi.spyOn(tools, "settings").mockRejectedValueOnce(new TypeError("Failed to fetch"));
  try {
    fireEvent.focus(window);
    await screen.findByRole("status");
    expect(screen.getByText("People blocked")).toBeInTheDocument();
    expect(screen.queryByText("People allowed")).not.toBeInTheDocument();
    await expect(requireToolModuleAccess("list_employees", {})).rejects.toThrow("people");
  } finally { settings.mockRestore(); }
});
it("refreshes revoked permissions after a membership event or reconnect, without rechecking unrelated messages", async () => {
  rpc.mockResolvedValue({data:{allowed:true,admin:true,modules:null},error:null});
  render(<ModulesProvider><Consumer/></ModulesProvider>);
  await screen.findByText("People allowed");
  rpc.mockResolvedValue({data:{allowed:true,admin:false,modules:["inventory"]},error:null});
  act(() => notifyDataChanged(["org_members"]));
  await screen.findByText("People blocked");
  rpc.mockResolvedValue({data:{allowed:true,admin:true,modules:null},error:null});
  act(() => notifyDataChanged(["org_messages"]));
  expect(screen.getByText("People blocked")).toBeInTheDocument();
  act(() => notifyDataChanged());
  await screen.findByText("People allowed");
});
it("does not reuse the old workspace's permissions while loading a new workspace", async () => {
  rpc.mockResolvedValue({ data: { allowed: true, admin: true, modules: null }, error: null });
  render(<ModulesProvider><Consumer /></ModulesProvider>);
  await screen.findByText("People allowed");
  let complete!: (value: unknown) => void;
  rpc.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  act(() => setCacheOrg("other", "staff"));
  expect(screen.queryByText("People allowed")).toBeNull();
  complete({ data: { allowed: true, admin: false, modules: ["inventory"] }, error: null });
  await screen.findByText("People blocked");
});
it("isolates cloud integration identities and strips provider credential fields",async()=>{
  expect(integrationAllowed(null,"composio")).toBe(false);
  expect(integrationAllowed({role:"staff",modules:["inventory"]},"composio")).toBe(false);
  expect(integrationAllowed({role:"staff",modules:["integrations"]},"composio")).toBe(true);
  const first=await integrationEntity("org","staff");
  expect(first).not.toBe(await integrationEntity("other","staff"));
  expect(connectionSummary({id:"connection",user_id:first,status:"ACTIVE",toolkit:{slug:"gmail"},state:{token:"private"}},first))
    .toEqual({id:"connection",status:"ACTIVE",toolkit:{slug:"gmail"}});
  expect(()=>connectionSummary({user_id:"other"},first)).toThrow("different workspace");
});
