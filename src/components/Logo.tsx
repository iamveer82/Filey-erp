type Props = { size?: number; className?: string };

/** Filey brand mark. Vector artwork at public/filey-logo.svg —
 *  stays crisp at any size (sidebar, login, favicon). */
export default function Logo({ size = 72, className = "" }: Props) {
  return (
    <img
      src="/filey-logo.svg"
      width={size}
      height={size}
      alt="Filey"
      draggable={false}
      className={`object-contain select-none shrink-0 ${className}`}
    />
  );
}
