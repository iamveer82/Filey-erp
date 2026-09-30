import { Check, UserRound } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/format";
import {
  AVATAR_SHAPES,
  AVATAR_COLOURS,
  avatarChoice,
  avatarUrl,
} from "../lib/profileAvatars";

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
  const choice = avatarChoice(value);
  const shape = choice?.shape ?? AVATAR_SHAPES[0];
  const colour = choice?.colour ?? AVATAR_COLOURS[1];
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Choose a shape and colour, or keep your profile photo. Motion follows your
        device’s reduced-motion setting.
      </p>
      <div className="space-y-2">
        <p className="text-xs font-medium">
          Shape
          {choice && (
            <span className="font-normal text-muted-foreground"> · {shape.name}</span>
          )}
        </p>
        <div
          role="group"
          aria-label="Avatar shape"
          className="flex flex-wrap gap-2"
        >
          {AVATAR_SHAPES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={`${option.name} shape`}
              title={option.name}
              aria-pressed={choice?.shape.id === option.id}
              onClick={() => onChange(avatarUrl(option.id, colour.id))}
              className={cn(
                "relative grid min-h-11 min-w-11 place-items-center rounded-xl border p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                choice?.shape.id === option.id
                  ? "border-foreground bg-muted"
                  : "border-transparent"
              )}
            >
              <img
                src={avatarUrl(option.id, colour.id)}
                alt=""
                className="h-10 w-10 rounded-full"
              />
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium">
          Colour
          {choice && (
            <span className="font-normal text-muted-foreground"> · {colour.name}</span>
          )}
        </p>
        <div role="group" aria-label="Avatar colour" className="flex flex-wrap gap-2">
          {AVATAR_COLOURS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={`${option.name} colour`}
              title={option.name}
              aria-pressed={choice?.colour.id === option.id}
              onClick={() => onChange(avatarUrl(shape.id, option.id))}
              className="grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-full border border-black/10"
                style={{ backgroundColor: option.swatch }}
              >
                {choice?.colour.id === option.id && (
                  <Check
                    size={14}
                    strokeWidth={2.5}
                    className={option.id === "slate" ? "text-white" : "text-black"}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
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
