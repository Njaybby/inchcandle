import { Bird, BugBeetle, Butterfly, Cat, Cow, Dog, FishSimple, Horse, Rabbit, type Icon } from "@phosphor-icons/react";
import { nameGlyph, nameText, type Glyph } from "../lib/names";

const glyphs: Record<Glyph, Icon> = {
  bird: Bird,
  butterfly: Butterfly,
  cat: Cat,
  dog: Dog,
  fish: FishSimple,
  horse: Horse,
  rabbit: Rabbit,
  beetle: BugBeetle,
  ox: Cow,
};

/** A bidder's room name with its animal. */
export function Name({ index, size = 20, suffix }: { index: number | null; size?: number; suffix?: string }) {
  if (index === null) return <span className="name">{suffix ?? "A bidder"}</span>;
  const Glyph = glyphs[nameGlyph(index) ?? "bird"];
  return (
    <span className="name">
      <Glyph size={size} aria-hidden="true" />
      <span className="name-text">
        {nameText(index)}
        {suffix && <span className="name-suffix"> {suffix}</span>}
      </span>
    </span>
  );
}
