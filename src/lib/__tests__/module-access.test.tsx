import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setCacheOrg } from "../api";
import { loadModuleAccess, requireToolModuleAccess } from "../moduleAccess";
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
it("rejects a membership response from a previous workspace",async()=>{
  rpc.mockImplementationOnce(async()=>{setCacheOrg("other","staff");return {data:{allowed:true,admin:true,modules:null}};});
  await expect(loadModuleAccess()).rejects.toThrow("workspace changed");
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
