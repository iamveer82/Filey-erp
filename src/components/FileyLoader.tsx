/* Minimal Filey splash — design.md §0.8 compliant (no gradients, no
 * decorative effects, single rotating arc). The actual page content
 * fades in the moment auth + profile resolve, so this screen stays up
 * only for the Supabase session/profile check. */
export default function FileyLoader() {
  return (
    <div
      role="status"
      aria-label="Loading Filey"
      className="grid h-full min-h-full place-items-center bg-canvas"
    >
      <div className="flex flex-col items-center gap-4">
        {/* wordmark — single h1, the entire boot surface is type. */}
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Filey
        </h1>
        {/* spinner — single rotating arc, 1s linear (built-in). */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          className="animate-spin text-brand-300 dark:text-brand-500"
          aria-hidden
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="2"
          />
          <path
            d="M8 2 a6 6 0 0 1 6 6"
            fill="none"
            stroke="#2563EB"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
