export default function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "green";
}) {
  const color =
    tone === "red"
      ? "text-red-700"
      : tone === "green"
        ? "text-emerald-700"
        : "text-neutral-900";
  return (
    <div className="border border-neutral-900 p-2">
      <div className="text-[8.5px] uppercase tracking-wider text-neutral-600">
        {label}
      </div>
      <div className={`text-[13px] font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
