import { mard, perler, type Row } from "./beadcolors.gen";
import { hexToRgb, rgbToLab, type Lab, type RGB } from "./color";

/**
 * Colour presets built from the maxcleme/beadcolors dataset (see beadcolors.gen.ts).
 * Presets are not tied to a bead size; the same codes work for e.g. 5mm and 2.6mm patterns.
 */

export interface BeadColor {
  id: string; // unique per source, e.g. "mard:A1"
  code: string;
  name: string; // may be empty when the chart only has codes
  hex: string;
  rgb: RGB;
  lab: Lab;
}

export interface Brand {
  id: string;
  /** Presets from the same chart share colour ids (and the "colours I have" list). */
  source: string;
  name: string;
  colors: BeadColor[];
}

function toColors(source: string, rows: Row[]): BeadColor[] {
  return rows.map(([code, name, hex]) => {
    const rgb = hexToRgb(hex);
    return { id: `${source}:${code}`, code, name, hex, rgb, lab: rgbToLab(...rgb) };
  });
}

const mardColors = toColors("mard", mard);
const mardCore = mardColors.filter((c) => /^[A-M]\d+$/.test(c.code));

export const BRANDS: Brand[] = [
  { id: "mard-221", source: "mard", name: `MARD ${mardCore.length} (A–M)`, colors: mardCore },
  { id: "mard-291", source: "mard", name: `MARD ${mardColors.length} (all)`, colors: mardColors },
  { id: "perler", source: "perler", name: `Perler ${perler.length}`, colors: toColors("perler", perler) },
];

export const DEFAULT_BRAND_ID = "mard-221";

export function getBrand(id: string): Brand {
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0]!;
}

/** "A1" or "80-15179 Evergreen". */
export function colorLabel(c: BeadColor): string {
  return c.name ? `${c.code} ${c.name}` : c.code;
}
