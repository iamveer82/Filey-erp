import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { setBrowserPanelOpen } from "../lib/desktopBrowser";

/** Keep existing bookmarks and integration links working. */
export default function WorkspaceBrowser() {
  useEffect(() => { setBrowserPanelOpen(true); }, []);
  return <Navigate to="/agent" replace />;
}
