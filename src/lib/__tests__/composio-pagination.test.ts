import { beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { composioList } from "../composio";
const request=vi.hoisted(()=>vi.fn());
vi.mock("../integrations",()=>({platformCall:request,platformAvailable:async()=>true,hasCloudKey:async()=>false}));
beforeEach(()=>{localStorage.clear();localStorage.setItem("filey_data_mode","local");setCacheOrg("fixture","owner");request.mockReset();});
it("reads all connection pages and fails closed on a looping provider cursor",async()=>{
 request.mockResolvedValueOnce({items:[{id:"first"}],next_cursor:"page2"}).mockResolvedValueOnce({items:[{id:"second"}]});
 expect((await composioList()).items?.map(item=>item.id)).toEqual(["first","second"]);
 expect(request.mock.calls[1][2]).toEqual({cursor:"page2"});
 request.mockResolvedValue({items:[],next_cursor:"loop"});
 await expect(composioList()).rejects.toThrow("could not complete");
});
it("does not combine pages from different accounts",async()=>{
 request.mockImplementationOnce(async()=>{setCacheOrg("other","owner");return {items:[{id:"old"}],next_cursor:"page2"};});
 await expect(composioList()).rejects.toThrow("workspace changed");
 expect(request).toHaveBeenCalledOnce();
});
