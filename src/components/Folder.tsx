import { cn } from "../lib/format";

/** Minimal folder — the spring paper-fan hover from the previous
 * framer-motion version is gone (design.md §0.8). Papers still
 * rest at their fanned angles; on hover the group-hover CSS gives
 * them a quiet color shift instead of position bounce. The folder
 * container itself is just rounded div + gradients, no animation. */

type FolderColor = "blue" | "black" | "grey" | "yellow" | "orange" | "red";
type FolderSize = "sm" | "md" | "lg";

type FolderProps = {
  color?: FolderColor;
  size?: FolderSize;
  label?: string;
  className?: string;
};

const sizeMap: Record<
  FolderSize,
  {
    container: string;
    tabLeft: string;
    tabRight: string;
    tabBridge: string;
    flapBody: string;
    papers: string;
    paperOffset: string;
    paperH: string;
    paperContent: string;
    label: string;
  }
> = {
  sm: {
    container: "size-24 rounded-md",
    tabLeft: "w-9 h-3 rounded-tl-lg",
    tabRight: "w-2 h-3 rounded-tr-2xl",
    tabBridge: "w-2 h-2",
    flapBody: "h-9",
    papers: "inset-x-5 top-2",
    paperOffset: "top-1",
    paperH: "h-16",
    paperContent: "pt-2.5 px-2.5 space-y-1",
    label: "bottom-2 left-2 text-[9px] py-0.5 px-1.5",
  },
  md: {
    container: "size-32 rounded-md",
    tabLeft: "w-12 h-4 rounded-tl-lg",
    tabRight: "w-2.5 h-4 rounded-tr-3xl",
    tabBridge: "w-2.5 h-2.5",
    flapBody: "h-12",
    papers: "inset-x-6 top-3",
    paperOffset: "top-1.5",
    paperH: "h-24",
    paperContent: "pt-3 px-3 space-y-1",
    label: "bottom-3 left-3 text-[10px] py-0.5 px-1.5",
  },
  lg: {
    container: "size-40 rounded-[40px]",
    tabLeft: "w-16 h-5.5 rounded-tl-xl",
    tabRight: "w-3.25 h-5.5 rounded-tr-[40px]",
    tabBridge: "w-3.25 h-3.25",
    flapBody: "h-16",
    papers: "inset-x-8 top-4",
    paperOffset: "top-2",
    paperH: "h-30",
    paperContent: "pt-4 px-4 space-y-1.5",
    label: "bottom-4 left-4 text-xs py-1 px-2",
  },
};

/** Folders: solid color (no gradient — design.md §0.8 ban). Each color
 * is a single hue with a slightly darker bottom band. */
const colorMap: Record<
  FolderColor,
  {
    folder: string;
    flap: string;
    paperBack: string;
    paperFront: string;
    paperLine: string;
    paperBorder: string;
    labelBg: string;
    folderBorder: string;
  }
> = {
  blue: {
    folder: "bg-blue-500",
    flap: "bg-blue-400/60",
    paperBack: "bg-blue-100",
    paperFront: "bg-white",
    paperLine: "bg-blue-300",
    paperBorder: "border-blue-200",
    labelBg: "bg-blue-900/30",
    folderBorder: "border-blue-700/30",
  },
  black: {
    folder: "bg-neutral-900",
    flap: "bg-neutral-700/60",
    paperBack: "bg-neutral-400",
    paperFront: "bg-neutral-100",
    paperLine: "bg-neutral-300",
    paperBorder: "border-neutral-300",
    labelBg: "bg-white/10",
    folderBorder: "border-white/10",
  },
  yellow: {
    folder: "bg-primary-400",
    flap: "bg-primary-300/70",
    paperBack: "bg-primary-100",
    paperFront: "bg-white",
    paperLine: "bg-primary-300",
    paperBorder: "border-primary-200",
    labelBg: "bg-primary-800/30",
    folderBorder: "border-primary-600/30",
  },
  orange: {
    folder: "bg-orange-500",
    flap: "bg-orange-400/60",
    paperBack: "bg-orange-100",
    paperFront: "bg-white",
    paperLine: "bg-orange-300",
    paperBorder: "border-orange-200",
    labelBg: "bg-orange-900/30",
    folderBorder: "border-orange-700/30",
  },
  red: {
    folder: "bg-red-500",
    flap: "bg-red-400/60",
    paperBack: "bg-red-100",
    paperFront: "bg-white",
    paperLine: "bg-red-300",
    paperBorder: "border-red-200",
    labelBg: "bg-red-900/30",
    folderBorder: "border-red-700/30",
  },
  grey: {
    folder: "bg-gray-500",
    flap: "bg-gray-400/60",
    paperBack: "bg-gray-200",
    paperFront: "bg-white",
    paperLine: "bg-gray-300",
    paperBorder: "border-gray-300",
    labelBg: "bg-gray-900/20",
    folderBorder: "border-gray-600/30",
  },
};

export const Folder = ({
  color = "blue",
  size = "lg",
  label,
  className,
}: FolderProps) => {
  const c = colorMap[color];
  const s = sizeMap[size];

  return (
    <div
      aria-label="Folder"
      className={cn(
        "group/folder relative cursor-pointer overflow-hidden border-t-2 transition-colors",
        s.container,
        c.folder,
        c.folderBorder,
        className
      )}
    >
      {/* Front flap */}
      <div className="absolute right-0 bottom-0 left-0 z-20">
        <div className="flex items-end">
          <div className={cn(s.tabLeft, c.flap)} />
          <div className={cn(s.tabRight, c.flap)} />
          <div
            className={cn(
              s.tabBridge,
              "mask-[radial-gradient(200%_200%_at_100%_0%,transparent_50%,black_50%)]",
              c.flap
            )}
          />
        </div>
        <div className={cn(s.flapBody, "rounded-tr-xl", c.flap)} />
      </div>

      {/* Papers - fanned at rest, no hover motion. */}
      <div className={cn("absolute z-10", s.papers)}>
        {/* Back paper - fans right */}
        <div
          style={{ transform: "rotate(4deg)", transformOrigin: "center bottom" }}
          className={cn(
            "absolute inset-x-0 rounded-md",
            s.paperOffset,
            s.paperH,
            c.paperBack
          )}
        />
        {/* Back paper - fans left */}
        <div
          style={{ transform: "rotate(-4deg)", transformOrigin: "center bottom" }}
          className={cn(
            "absolute inset-x-0 rounded-md",
            s.paperOffset,
            s.paperH,
            c.paperBack
          )}
        />
        {/* Front paper - sits flat */}
        <div
          className={cn(
            "absolute inset-x-0 top-0 rounded-xl border-t",
            s.paperH,
            c.paperFront,
            c.paperBorder
          )}
        >
          <div className={s.paperContent}>
            <div className={cn("h-1 w-3/4 rounded-full", c.paperLine)} />
            <div className={cn("h-1 w-1/2 rounded-full", c.paperLine)} />
            <div className={cn("h-1 w-2/3 rounded-full", c.paperLine)} />
          </div>
        </div>
      </div>

      {/* Label */}
      {label && (
        <div className={cn("absolute z-20 rounded-full", s.label, c.labelBg)}>
          <span className="font-medium text-white">{label}</span>
        </div>
      )}
    </div>
  );
};

export default Folder;
