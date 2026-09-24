/** Paper's approved mascot. Adjacent text supplies the accessible label. */
export default function PaperMark({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/icons/filey-paper-256.webp"
      srcSet="/icons/filey-paper-96.webp 96w, /icons/filey-paper-256.webp 256w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      className={`inline-block shrink-0 select-none object-contain ${className}`}
    />
  );
}
