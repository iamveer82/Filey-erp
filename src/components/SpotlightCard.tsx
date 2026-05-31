import { ReactNode, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/format";

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  size?: number;
}

export function SpotlightCard({ children, className, size = 200 }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 120, damping: 18 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-brand-200/60 bg-surface dark:border-[#3A3D45]/60 dark:bg-[#1A1B1E] shadow-bento ambient-glow lift-hover",
        className
      )}
    >
      <div
        className="pointer-events-none absolute -inset-px transition-opacity duration-300"
        style={{ opacity }}
      >
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            background: `radial-gradient(${size}px circle at ${position.x}px ${position.y}px, rgba(99,102,241,0.12), transparent 60%)`,
          }}
        />
      </div>
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
