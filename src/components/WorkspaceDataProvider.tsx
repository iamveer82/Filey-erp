import { useEffect, useState, type ReactNode } from "react";
import { Provider } from "react-redux";
import { setupListeners } from "@reduxjs/toolkit/query";
import { createWorkspaceStore, workspaceQueries } from "../lib/workspaceQueries";
import { useLiveSync } from "../lib/realtime";

export default function WorkspaceDataProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createWorkspaceStore);
  useLiveSync(() => store.dispatch(workspaceQueries.util.invalidateTags(["Workspace"])));
  useEffect(() => {
    const stop = setupListeners(store.dispatch);
    return () => { stop(); store.dispatch(workspaceQueries.util.resetApiState()); };
  }, [store]);
  return <Provider store={store}>{children}</Provider>;
}
