import { ReactNode, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/format";

interface MagicCardProps {
  children: ReactNode;
  className?: string;
  gradient?: string;
}

export function MagicCard({ children, className, gradient }: MagicCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);
  const [glowX, setGlowX] = useState(50);
  const [glowY, setGlowY] = useState(50);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    setRotateX((y - centerY) / 10);
    setRotateY((centerX - x) / 10);
    setGlowX((x / rect.width) * 100);
    setGlowY((y / rect.height) * 100);
  };

  const onMouseLeave = () => {
    setRotateX(0);
    setRotateY(0);
    setGlowX(50);
    setGlowY(50);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{
        transformStyle: "preserve-3d",
        perspective: 1000,
        rotateX,
        rotateY,
      }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-brand-200/50 bg-surface/80 backdrop-blur-sm dark:border-[#3A3D45]/50 dark:bg-[#1A1B1E]/80",
        className
      )}
    >
      {/* Animated gradient border glow */}
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(400px circle at ${glowX}% ${glowY}%, ${gradient ?? "rgba(99,102,241,0.15)"}, transparent 60%)`,
        }}
      />
      {/* Corner accents */}
      <div className="absolute top-0 left-0 h-px w-12 bg-gradient-to-r from-primary-400/60 to-transparent" />
      <div className="absolute top-0 left-0 h-12 w-px bg-gradient-to-b from-primary-400/60 to-transparent" />
      <div className="absolute bottom-0 right-0 h-px w-12 bg-gradient-to-l from-primary-400/60 to-transparent" />
      <div className="absolute bottom-0 right-0 h-12 w-px bg-gradient-to-t from-primary-400/60 to-transparent" />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
