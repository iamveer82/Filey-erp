import { lazy, Suspense } from "react";
import type { GenUiOpenUiSpec } from "../lib/genUi";

// OpenUI's component library and styles load with the first card, not with the app.
const OpenUiRender = lazy(() => import("./OpenUiRender"));

export default function OpenUiCard({ spec, onPrompt }: { spec: GenUiOpenUiSpec; onPrompt?: (text: string) => void }) {
  return (
    <Suspense fallback={<div className="my-2 h-24 animate-pulse rounded-xl border border-border bg-muted/40" aria-label="Drawing the answer" />}>
      <OpenUiRender program={spec.program} onPrompt={onPrompt} />
    </Suspense>
  );
}
