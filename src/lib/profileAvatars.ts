export const AVATAR_SHAPES = [
  { id: "round", name: "Round", legacy: "sun", colour: "sun", pin: 0.11 },
  { id: "organic", name: "Organic", legacy: "mint", colour: "mint", pin: 0.35 },
  { id: "boxy", name: "Boxy", legacy: "coral", colour: "coral", pin: 0.54 },
  { id: "capsule", name: "Capsule", legacy: "sky", colour: "sky", pin: 0.65 },
  { id: "nub", name: "Nub", legacy: "lilac", colour: "lilac", pin: 0.745 },
  { id: "cloud", name: "Cloud", legacy: "peach", colour: "peach", pin: 0.825 },
  { id: "droplet", name: "Droplet", legacy: "slate", colour: "slate", pin: 0.887 },
  { id: "hexagon", name: "Hexagon", legacy: "sage", colour: "sage", pin: 0.932 },
  { id: "sunburst", name: "Sunburst", legacy: "sunburst", colour: "amber", pin: 0.965 },
  { id: "triangle", name: "Triangle", legacy: "triangle", colour: "rose", pin: 0.99 },
] as const;

export const AVATAR_COLOURS = [
  { id: "sun", name: "Sun", hue: 85, tone: 0.85, swatch: "#ffcc59" },
  { id: "mint", name: "Mint", hue: 160, tone: 0.12, swatch: "#a0e3be" },
  { id: "coral", name: "Coral", hue: 25, tone: 0.5, swatch: "#f1837c" },
  { id: "sky", name: "Sky", hue: 240, tone: 0.5, swatch: "#49b2f3" },
  { id: "lilac", name: "Lilac", hue: 305, tone: 0.12, swatch: "#dec3fe" },
  { id: "peach", name: "Peach", hue: 45, tone: 0.12, swatch: "#ffc1a5" },
  { id: "slate", name: "Slate", hue: 250, tone: 0.97, swatch: "#2a394a" },
  { id: "sage", name: "Sage", hue: 130, tone: 0.3, swatch: "#d1dcc8" },
  { id: "amber", name: "Amber", hue: 65, tone: 0.5, swatch: "#e19440" },
  { id: "rose", name: "Rose", hue: 350, tone: 0.5, swatch: "#e682b4" },
] as const;

type ShapeId = (typeof AVATAR_SHAPES)[number]["id"];
type ColourId = (typeof AVATAR_COLOURS)[number]["id"];

export function avatarUrl(shape: ShapeId, colour: ColourId) {
  return `/avatars/blobatar/${shape}-${colour}.svg`;
}

export function avatarChoice(value: string) {
  const legacy = AVATAR_SHAPES.find((shape) => value === `/avatars/${shape.legacy}.svg`);
  if (legacy) {
    return {
      shape: legacy,
      colour: AVATAR_COLOURS.find((colour) => colour.id === legacy.colour)!,
    };
  }
  const match = /^\/avatars\/blobatar\/([a-z]+)-([a-z]+)\.svg$/.exec(value);
  if (!match || match[0] !== value) return null;
  const shape = AVATAR_SHAPES.find((shape) => shape.id === match[1]);
  const colour = AVATAR_COLOURS.find((colour) => colour.id === match[2]);
  return shape && colour ? { shape, colour } : null;
}
