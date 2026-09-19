import { FileySpinner } from "./FileySpinner";

export default function FileyLoader({ label = "Loading Filey" }: { label?: string }) {
  return <div role="status" aria-live="polite" aria-label={label} className="filey-loader grid h-full min-h-48 place-items-center bg-canvas">
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="relative grid h-16 w-16 place-items-center">
        <FileySpinner size={64} className="absolute inset-0 text-primary-400" />
        <img src="/icons/filey-logo.png" alt="" width="32" height="32" className="h-8 w-8 object-contain" />
      </div>
      <div className="text-center"><p className="text-lg font-semibold tracking-tight text-foreground">Filey</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>
    </div>
  </div>;
}
