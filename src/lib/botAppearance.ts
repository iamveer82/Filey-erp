import type { ShapeId } from "./bloub/skins";

export const BOT_LOOKS: { id: ShapeId; name: string }[] = [
  { id: "cercle", name: "Orb" },
  { id: "galet", name: "Jelly" },
  { id: "squircle", name: "Pixel" },
  { id: "capsule", name: "Capsule" },
  { id: "nuage", name: "Cloud" },
  { id: "goutte", name: "Drop" },
  { id: "triangle", name: "Kite" },
  { id: "hexagone", name: "Hex" },
];

export const BOT_MOTIONS = [
  { id: "gentle", name: "Gentle", description: "Quiet breathing and a curious gaze" },
  { id: "playful", name: "Playful", description: "Winks, stretches and changing shapes" },
  { id: "orbit", name: "Orbit", description: "Soft rings around your assistant" },
  { id: "still", name: "Still", description: "A static face that reflects its status" },
] as const;
export type BotMotion = (typeof BOT_MOTIONS)[number]["id"];

export function botAppearance(value: {
  orbColor?: unknown;
  botShape?: unknown;
  botMotion?: unknown;
}) {
  return {
    orbColor:
      typeof value.orbColor === "string" && /^#[\da-f]{6}$/i.test(value.orbColor)
        ? value.orbColor
        : "#FFD600",
    botShape: BOT_LOOKS.find((look) => look.id === value.botShape)?.id ?? "cercle",
    botMotion:
      BOT_MOTIONS.find((motion) => motion.id === value.botMotion)?.id ?? "playful",
  };
}
