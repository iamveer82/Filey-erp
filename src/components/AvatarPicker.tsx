import { Check, UserRound } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/format";
import {
  AVATAR_SHAPES,
  AVATAR_COLOURS,
  avatarChoice,
  avatarUrl,
  MASCOT_GROUPS,
  mascotChoice,
  mascotName,
  mascotUrl,
} from "../lib/profileAvatars";
import { ProfileAvatarImage } from "./ProfileAvatarImage";

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
  const mascot = mascotChoice(value);
  const [group, setGroup] = useState<keyof typeof MASCOT_GROUPS>(() =>
    MASCOT_GROUPS.People.some((id) => id === mascot)
      ? "People"
      : MASCOT_GROUPS.Robots.some((id) => id === mascot)
        ? "Robots"
        : "Animals"
  );
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              Mascots{mascot ? ` · ${mascotName(mascot)}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick a character for your profile.
            </p>
          </div>
          {mascot && (
            <ProfileAvatarImage
              animate
              src={value}
              alt={`${mascotName(mascot)} avatar preview`}
              className="h-16 w-16 shrink-0 rounded-full bg-muted"
            />
          )}
        </div>
        <div role="group" aria-label="Mascot category" className="flex flex-wrap gap-1">
          {(Object.keys(MASCOT_GROUPS) as (keyof typeof MASCOT_GROUPS)[]).map(
            (category) => (
              <button
                key={category}
                type="button"
                aria-pressed={group === category}
                onClick={() => setGroup(category)}
                className={cn(
                  "min-h-11 rounded-full px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  group === category
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted/50"
                )}
              >
                {category}
              </button>
            )
          )}
        </div>
        <div
          key={group}
          role="group"
          aria-label="Mascot avatars"
          className="grid max-h-72 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 overflow-y-auto rounded-xl border border-border p-2"
        >
          {MASCOT_GROUPS[group].map((id) => (
            <button
              key={id}
              type="button"
              aria-label={`${mascotName(id)} mascot`}
              aria-pressed={mascot === id}
              onClick={() => onChange(mascotUrl(id))}
              className={cn(
                "flex min-h-20 min-w-0 flex-col items-center justify-center rounded-lg border p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                mascot === id ? "border-foreground bg-muted" : "border-transparent"
              )}
            >
              <img
                src={mascotUrl(id)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-12 w-12 object-contain"
              />
              <span className="w-full truncate text-center text-[11px]">
                {mascotName(id)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Or choose a shape and colour. Motion follows your device’s reduced-motion setting.
      </p>
      <div className="space-y-2">
        <p className="text-xs font-medium">
          Shape
          {choice && (
            <span className="font-normal text-muted-foreground"> · {shape.name}</span>
          )}
        </p>
        <div role="group" aria-label="Avatar shape" className="flex flex-wrap gap-2">
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
