/* Draws one show_openui answer with OpenUI's own chat components (react-ui, MIT).
 * Loaded lazily by OpenUiCard: the library and its styles only arrive with the first card.
 * Nothing in a card can run Filey tools: there is no toolProvider, so Query() and
 * Mutation() stay inert; buttons only send text back or open an https link. */
import { Component, useEffect, useState, type ReactNode } from "react";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { ThemeProvider, createTheme } from "@openuidev/react-ui";
import "@openuidev/react-ui/components.css";
import { openuiRenderLibrary } from "../lib/openuiLib";
import { GEN_UI_PALETTE } from "../lib/genUi";

// Filey's vivid chart colours, so slices and series are told apart at a glance.
const light = createTheme({ interactiveAccentDefault: GEN_UI_PALETTE[0], defaultChartPalette: GEN_UI_PALETTE });
const dark = createTheme({ interactiveAccentDefault: GEN_UI_PALETTE[0], defaultChartPalette: GEN_UI_PALETTE });

function useDarkMode(): boolean {
  const [on, setOn] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setOn(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return on;
}

class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="text-sm text-muted-foreground">This card could not be drawn.</p> : this.props.children;
  }
}

async function openLink(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== "https:" || url.username || url.password) return;
  const { isNativeApp, openNativeExternal } = await import("../lib/nativePlatform");
  if (isNativeApp()) await openNativeExternal(url.href);
  else if ("__TAURI_INTERNALS__" in window) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url.href);
  } else window.open(url.href, "_blank", "noopener,noreferrer");
}

/** A follow-up's words, plus any hidden context the card attached to it. */
export function promptFromAction(event: ActionEvent): string {
  const message = event.humanFriendlyMessage || String(event.params?.message ?? "");
  const context = event.params?.context;
  return context == null || context === "" ? message : `${message}\n(${typeof context === "string" ? context : JSON.stringify(context)})`;
}

export default function OpenUiRender({ program, onPrompt }: { program: string; onPrompt?: (text: string) => void }) {
  const isDark = useDarkMode();
  return (
    <CardBoundary>
      <ThemeProvider mode={isDark ? "dark" : "light"} lightTheme={light} darkTheme={dark}>
        <div className="filey-openui my-2 min-w-0">
          <Renderer
            response={program}
            library={openuiRenderLibrary}
            isStreaming={false}
            onAction={(event) => {
              if (event.type === "open_url") void openLink(String(event.params?.url ?? ""));
              else if (event.type === "continue_conversation") {
                const text = promptFromAction(event).trim();
                if (text) onPrompt?.(text);
              }
            }}
          />
        </div>
      </ThemeProvider>
    </CardBoundary>
  );
}
