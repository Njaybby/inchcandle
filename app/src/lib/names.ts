import { randomBytes } from "./bytes";

// Room names. Each bidder gets a fresh one for every room, from a fixed list, so nobody types a handle that links them across rooms.
// A name is an index into adjectives times animals, and travels inside the bid as two bytes.

export type Glyph = "bird" | "butterfly" | "cat" | "dog" | "fish" | "horse" | "rabbit" | "beetle" | "ox";

const adjectives = [
  "Amber", "Ash", "Birch", "Brass", "Cedar", "Copper", "Ember", "Flint",
  "Frost", "Gilt", "Hazel", "Ivory", "Jade", "Juniper", "Linen", "Moss",
  "Oak", "Onyx", "Pearl", "Quiet", "Rust", "Sable", "Saffron", "Silver",
  "Slate", "Smoke", "Tallow", "Tawny", "Umber", "Velvet", "Wax", "Willow",
];

const animals: [string, Glyph][] = [
  ["Heron", "bird"], ["Wren", "bird"], ["Finch", "bird"], ["Owl", "bird"], ["Swift", "bird"],
  ["Kestrel", "bird"], ["Crane", "bird"], ["Raven", "bird"], ["Lark", "bird"], ["Plover", "bird"],
  ["Moth", "butterfly"], ["Lynx", "cat"], ["Hound", "dog"], ["Pike", "fish"], ["Carp", "fish"],
  ["Trout", "fish"], ["Mare", "horse"], ["Hare", "rabbit"], ["Beetle", "beetle"], ["Ox", "ox"],
];

export const nameCount = adjectives.length * animals.length;

export function isName(index: unknown): index is number {
  return Number.isInteger(index) && (index as number) >= 0 && (index as number) < nameCount;
}

export function nameText(index: number): string {
  if (!isName(index)) return "Unnamed bidder";
  const [animal] = animals[index % animals.length];
  return `${adjectives[Math.floor(index / animals.length)]} ${animal}`;
}

export function nameGlyph(index: number): Glyph | null {
  return isName(index) ? animals[index % animals.length][1] : null;
}

/** The index of a name such as "Amber Heron", or null if it isn't one. */
export function nameIndex(text: string): number | null {
  const [adjective, animal] = text.split(" ");
  const a = adjectives.indexOf(adjective);
  const b = animals.findIndex(([word]) => word === animal);
  return a < 0 || b < 0 ? null : a * animals.length + b;
}

export const sameAnimal = (a: number, b: number) => a % animals.length === b % animals.length;

/** A random name, never one of `avoid`, so a reroll always changes it. */
export function randomName(avoid: number[] = []): number {
  for (;;) {
    const [a, b] = randomBytes(2);
    const index = ((a << 8) | b) % nameCount;
    if (!avoid.includes(index)) return index;
  }
}
