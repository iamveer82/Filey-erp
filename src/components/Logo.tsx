type Props = { size?: number; className?: string };

/** Filey brand mark — a smiling folder. Self-contained palette. */
export default function Logo({ size = 36, className }: Props) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Filey"
    >
      <defs>
        <linearGradient
          id="fileyFront"
          x1="32"
          y1="24"
          x2="32"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#FFDD47" />
          <stop offset="1" stopColor="#F5C400" />
        </linearGradient>
      </defs>
      <path
        d="M9 18a5 5 0 0 1 5-5h11l4.5 5H50a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5Z"
        fill="#E0AE00"
      />
      <rect
        x="18"
        y="11"
        width="28"
        height="27"
        rx="3"
        fill="#FFFFFF"
        stroke="#F0E9D9"
        strokeWidth="1"
      />
      <path
        d="M7 30a5 5 0 0 1 5-5h40a5 5 0 0 1 5 5v17a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5Z"
        fill="url(#fileyFront)"
        stroke="#E0AE00"
        strokeWidth="1"
      />
      <ellipse cx="25.5" cy="38.5" rx="2.7" ry="3.5" fill="#222222" />
      <ellipse cx="42.5" cy="38.5" rx="2.7" ry="3.5" fill="#222222" />
      <circle cx="26.7" cy="37" r="0.85" fill="#D9D9D9" />
      <circle cx="43.7" cy="37" r="0.85" fill="#D9D9D9" />
      <path
        d="M25 45q9 7.5 18 0"
        fill="none"
        stroke="#222222"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
