import { beforeEach, expect, it, vi } from "vitest";
import { assertLocalAccount, claimLocalWorkspace, rememberLocalIdentity, setLocalSignedIn } from "../localAuth";
import { clearLocalCache, localClient, replaceColl } from "../localdb";
import { setCacheOrg } from "../api";
import { listFiles, fileBytes, type SavedFile } from "../files";
import { listAssets } from "../assets";

beforeEach(async () => {
  localStorage.clear(); localStorage.setItem("filey_data_mode", "local");
  clearLocalCache(); setCacheOrg("org-a", "owner-a");
  rememberLocalIdentity("owner-a@fixture.invalid", "owner-a");
  claimLocalWorkspace("owner-a"); setLocalSignedIn(true);
  localStorage.setItem("filey_local_profile", JSON.stringify({ id: "owner-a", org_id: "org-a" }));
  await replaceColl("user_files", [{ id: "private-file", owner: "owner-a", name: "Private A.pdf", storage_path: "owner-a/private.pdf" }]);
  await replaceColl("user_assets", [{ id: "private-stamp", owner: "owner-a", name: "Private A stamp", data_url: "data:image/png;base64,cHJpdmF0ZQ==", ratio: 1 }]);
});

it("refuses adopting another account or organization without replacing the original device records", async () => {
  expect(() => assertLocalAccount("owner-b", "org-a")).toThrow("another account");
  expect(() => claimLocalWorkspace("owner-b")).toThrow("another account");
  expect(() => assertLocalAccount("owner-a", "org-b")).toThrow("organization differs");
  expect(localStorage.getItem("filey_local_workspace_owner")).toBe("owner-a");
  expect((await listFiles())[0].name).toBe("Private A.pdf");
});

it("cannot read local private metadata, images or bytes through application APIs after sign-out", async () => {
  setLocalSignedIn(false);
  await expect(listFiles()).rejects.toThrow("Sign in to the device workspace");
  await expect(listAssets()).rejects.toThrow("Sign in to the device workspace");
  await expect(fileBytes({ storagePath: "owner-a/private.pdf" } as SavedFile)).rejects.toThrow("Sign in to the device workspace");
  expect(localStorage.getItem("localdb:user_files")).toContain("Private A.pdf");
});

it("discards a delayed local image read when its original owner signs out before publication", async () => {
  const client = localClient, from = client.from.bind(client);
  const spy = vi.spyOn(client, "from").mockImplementation((table: string) => {
    const query = from(table);
    const then = query.then.bind(query);
    query.then = ((resolve: (result: unknown) => unknown) => then((result: unknown) => {
      setLocalSignedIn(false); return resolve(result);
    })) as typeof query.then;
    return query;
  });
  try { await expect(listAssets()).rejects.toThrow("Sign in to the device workspace"); }
  finally { spy.mockRestore(); }
});
