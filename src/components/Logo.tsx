type Props = { size?: number; className?: string };

/** Filey brand mark. Artwork lives at public/filey-logo.png. */
export default function Logo({ size = 36, className }: Props) {
  return (
    <img
      src="/filey-logo.png"
      width={size}
      height={size}
      alt="Filey"
      className={className}
    />
  );
}
