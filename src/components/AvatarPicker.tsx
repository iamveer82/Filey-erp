import { Check, UserRound } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/format";

export const AVATARS = [
  "Sun",
  "Mint",
  "Coral",
  "Sky",
  "Lilac",
  "Peach",
  "Slate",
  "Sage",
].map((name) => ({
  name,
  src: `/avatars/${name.toLowerCase()}.svg`,
}));

export function UserAvatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-medium text-foreground",
        className
      )}
    >
      {src && failed !== src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
          .toUpperCase() || "?"
      )}
    </span>
  );
}

export default function AvatarPicker({
  value,
  onChange,
  resetLabel = "Use initials",
}: {
  value: string;
  onChange: (src: string) => void;
  resetLabel?: string;
}) {
  return (
    <div className="space-y-3">
      <div role="group" aria-label="Choose an avatar" className="flex flex-wrap gap-3">
        {AVATARS.map((avatar) => (
          <button
            key={avatar.src}
            type="button"
            aria-label={`${avatar.name} avatar`}
            aria-pressed={value === avatar.src}
            onClick={() => onChange(avatar.src)}
            className={cn(
              "relative rounded-full border-2 p-1 transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              value === avatar.src ? "border-foreground" : "border-transparent"
            )}
          >
            <img src={avatar.src} alt="" className="h-12 w-12 rounded-full" />
            {value === avatar.src && (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Check size={12} strokeWidth={2.5} />
              </span>
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn-ghost"
        aria-pressed={!value}
        onClick={() => onChange("")}
      >
        <UserRound size={15} />
        {resetLabel}
      </button>
    </div>
  );
}
