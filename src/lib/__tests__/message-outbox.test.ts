import { beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { agentStorageScope } from "../agentStorage";
import { beginMessage, finishMessage, messageJobs, reviewMessageNotSent, invoiceMessageVersion } from "../messageOutbox";

beforeEach(()=>{localStorage.clear();setDataMode("local");setCacheOrg("outbox-fixture","owner");});
const file = new File(["%PDF-fixture"],"invoice.pdf",{type:"application/pdf"});
Object.defineProperty(file,"arrayBuffer",{value:async()=>new TextEncoder().encode("%PDF-fixture").buffer});
const input={documentKey:"invoice:1",version:"2026-09-13",file,filename:file.name,recipient:"+971500000001",text:"Invoice fixture",method:"paired" as const};

it("survives a reload before acceptance and rejects ordinary retries across local/cloud",async()=>{
  const job=await beginMessage(input,agentStorageScope()!);
  vi.resetModules();
  const reloadedApi=await import("../api");
  reloadedApi.setCacheOrg("outbox-fixture","owner");
  const reloaded=await import("../messageOutbox");
  expect((await reloaded.messageJobs())[0]).toMatchObject({id:job.id,outcome:"sending",fileHash:expect.stringMatching(/^[a-f0-9]{64}$/)});
  await expect(reloaded.beginMessage(input,agentStorageScope()!)).rejects.toThrow(/send attempt/);
  setDataMode("cloud");
  await expect(beginMessage(input,agentStorageScope()!)).rejects.toThrow(/send attempt/);
});

it("retains acceptance IDs, isolates accounts, and allows a deliberate retry only after reviewing uncertainty",async()=>{
  const job=await beginMessage(input,agentStorageScope()!);
  await finishMessage(job,"unknown");
  await reviewMessageNotSent(job,agentStorageScope()!);
  const retry=await beginMessage(input,agentStorageScope()!);
  expect(retry.id).not.toBe(job.id);
  await finishMessage(retry,"accepted","provider-fixture-id");
  expect((await messageJobs()).find(entry => entry.id === retry.id)).toMatchObject({outcome:"accepted",providerId:"provider-fixture-id"});
  await expect(reviewMessageNotSent(retry,agentStorageScope()!)).rejects.toThrow(/uncertain/);
  setCacheOrg("outbox-fixture","another-owner");
  expect(await messageJobs()).toEqual([]);
});

it("does not permit sending when durable storage fails",async()=>{
  const write=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("Disk full");});
  await expect(beginMessage(input,agentStorageScope()!)).rejects.toThrow(/save failed|Disk full/);
  write.mockRestore();
  expect(await messageJobs()).toEqual([]);
});

it("keeps a send version through status changes but distinguishes edited content",async()=>{
  const draft={id:1,status:"draft",updated_at:"yesterday",items:[{qty:1,price:12}],customer_name:"Fixture"};
  const version=await invoiceMessageVersion(draft);
  expect(await invoiceMessageVersion({...draft,status:"sent",updated_at:"now"})).toBe(version);
  expect(await invoiceMessageVersion({...draft,items:[{qty:2,price:12}]})).not.toBe(version);
  const job=await beginMessage({...input,version,path:"private/device/path"} as typeof input,agentStorageScope()!);
  expect(job).not.toHaveProperty("path");
});
