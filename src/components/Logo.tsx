type Props = { size?: number; className?: string };

/** Filey brand mark — the mascot artwork (public/icons/filey-mascot.png,
 * 512px, transparent) used across sidebar, login, setup and favicon. */
export default function Logo({ size = 72, className = "" }: Props) {
  return (
    <img
      src="/icons/filey-mascot.png"
      width={size}
      height={size}
      alt="Filey"
      draggable={false}
      className={`object-contain select-none shrink-0 ${className}`}
    />
  );
}
