import { beforeEach, expect, it, vi } from "vitest";
import { setCacheOrg } from "../api";
import { composioConnect, composioList } from "../composio";
const request=vi.hoisted(()=>vi.fn());
vi.mock("../integrations",()=>({platformCall:request,platformAvailable:async()=>true,hasCloudKey:async()=>false}));
beforeEach(()=>{localStorage.clear();localStorage.setItem("filey_data_mode","local");setCacheOrg("fixture","owner");request.mockReset();});
it.each(["javascript:alert(document.domain)", "data:text/html,<script>bad</script>", "file:///C:/private.txt", "http://example.test/oauth", "https://owner:secret@example.test/oauth", "https://example.test/oauth\n"])("rejects a provider-controlled unsafe OAuth redirect %s before it reaches the browser opener", async (redirect_url) => {
 request.mockResolvedValue({redirect_url,connected_account_id:"connection"});
 await expect(composioConnect("gmail")).rejects.toThrow(/sign-in link/);
});
it("keeps the provider's HTTPS authorization link and connection identity intact", async () => {
 const link={redirect_url:"https://connect.composio.dev/oauth?connection_id=fixture",connected_account_id:"connection"};
 request.mockResolvedValue(link);
 expect(await composioConnect("gmail")).toEqual(link);
});
it.each([null, {}, {redirect_url:"https://connect.composio.dev/link/fixture"},
 {redirect_url:"https://connect.composio.dev/link/fixture",connected_account_id:"ca/foreign"},
 {redirect_url:"https://connect.composio.dev/link/fixture",connected_account_id:"a".repeat(257)},
 {redirect_url:"https://connect.composio.dev/link/fixture",connected_account_id:"ca_fixture\n"}])("rejects an incomplete connection reply before polling %j", async (link) => {
 request.mockResolvedValue(link);
 await expect(composioConnect("gmail")).rejects.toThrow(/sign-in link/);
});
it("returns only the link and connection ID rather than provider tokens", async () => {
 request.mockResolvedValue({redirect_url:"https://connect.composio.dev/link/fixture",connected_account_id:"ca_fixture",link_token:"fixture-private",state:{access_token:"fixture-private"}});
 expect(await composioConnect("gmail")).toEqual({redirect_url:"https://connect.composio.dev/link/fixture",connected_account_id:"ca_fixture"});
});
it.each(["", "gmail?user_id=other", "a".repeat(257), "gmail\n"])("rejects invalid toolkit identifiers before dispatch %s", async (toolkit) => {
 await expect(composioConnect(toolkit)).rejects.toThrow("valid app");
 expect(request).not.toHaveBeenCalled();
});
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
