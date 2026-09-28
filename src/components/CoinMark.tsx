import { Wallet } from "lucide-react";

/** Adjacent text supplies the accessible label. */
export default function CoinMark({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Wallet
      size={size}
      aria-hidden="true"
      className={`inline-block shrink-0 ${className}`}
    />
  );
}
