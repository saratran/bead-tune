import * as charts from "./beadcolors.gen";
import type { Row } from "./beadcolors.gen";
import { hexToRgb, rgbToLab, type Lab, type RGB } from "./color";

/**
 * Bead colour charts from the maxcleme/beadcolors dataset (see beadcolors.gen.ts),
 * grouped by bead size. Brands of the same size can be mixed in one pattern.
 */

export interface BeadColor {
  id: string; // unique per source, e.g. "mard:A1"
  code: string;
  name: string; // may be empty when the chart only has codes
  hex: string;
  rgb: RGB;
  lab: Lab;
  /** Short brand name, shown when brands are mixed (e.g. "Hama"). */
  brand: string;
}

export type BeadSize = "2.6mm" | "5mm" | "10mm";

export const SIZES: { id: BeadSize; label: string }[] = [
  { id: "2.6mm", label: "Mini 2.6 mm" },
  { id: "5mm", label: "Midi 5 mm" },
  { id: "10mm", label: "Maxi 10 mm" },
];

export interface Brand {
  /** A single chart ("hama"), or a mix of charts of one size ("5mm:mard-221+hama"). */
  id: string;
  /** Presets from the same chart share colour ids (and the "colours I have" list). For a mix, the charts joined with "+". */
  source: string;
  name: string;
  /** Short name shown next to colours when brands are mixed. */
  short: string;
  /** Sizes this brand comes in. */
  sizes: BeadSize[];
  colors: BeadColor[];
}

function toColors(source: string, brand: string, rows: Row[]): BeadColor[] {
  return rows.map(([code, name, hex]) => {
    const rgb = hexToRgb(hex);
    return { id: `${source}:${code}`, code, name, hex, rgb, lab: rgbToLab(...rgb), brand };
  });
}

function chart(id: string, source: keyof typeof charts & string, name: string, short: string, sizes: BeadSize[], filter?: (c: BeadColor) => boolean): Brand {
  const all = toColors(source, short, charts[source] as Row[]);
  const colors = filter ? all.filter(filter) : all;
  return { id, source, name: `${name} (${colors.length})`, short, sizes, colors };
}

/** Single charts, in the order they're offered. MARD comes in both mini and midi sizes with the same colours. */
export const BRANDS: Brand[] = [
  chart("mard-221", "mard", "MARD A–M", "MARD", ["2.6mm", "5mm"], (c) => /^[A-M]\d+$/.test(c.code)),
  chart("mard-291", "mard", "MARD all", "MARD", ["2.6mm", "5mm"]),
  chart("perler", "perler", "Perler", "Perler", ["5mm"]),
  chart("hama", "hama", "Hama Midi", "Hama", ["5mm"]),
  chart("artkal-s", "artkal_s", "Artkal S", "Artkal S", ["5mm"]),
  chart("artkal-r", "artkal_r", "Artkal R", "Artkal R", ["5mm"]),
  chart("nabbi", "nabbi", "Nabbi", "Nabbi", ["5mm"]),
  chart("perler-mini", "perler_mini", "Perler Mini", "Perler Mini", ["2.6mm"]),
  chart("hama-mini", "hama_mini", "Hama Mini", "Hama Mini", ["2.6mm"]),
  chart("artkal-a", "artkal_a", "Artkal A", "Artkal A", ["2.6mm"]),
  chart("artkal-c", "artkal_c", "Artkal C", "Artkal C", ["2.6mm"]),
  chart("artkal-m", "artkal_m", "Artkal M", "Artkal M", ["2.6mm"]),
  chart("hama-maxi", "hama_maxi", "Hama Maxi", "Hama Maxi", ["10mm"]),
];

export const DEFAULT_BRAND_ID = "mard-221";
export const DEFAULT_SIZE: BeadSize = "5mm";

/** The brands available in a size. */
export function brandsForSize(size: BeadSize): Brand[] {
  return BRANDS.filter((b) => b.sizes.includes(size));
}

export interface BrandChoice {
  size: BeadSize;
  /** The main brand (first) and any mixed in with it, all of `size`. */
  ids: string[];
}

/** Reads a brand id: "hama", or "5mm:mard-221+hama" (older projects have just the first form). */
export function parseBrandId(id: string): BrandChoice {
  const [sizePart, rest] = id.includes(":") ? (id.split(":", 2) as [string, string]) : [undefined, id];
  const ids = rest.split("+").filter((x) => BRANDS.some((b) => b.id === x));
  if (!ids.length) ids.push(DEFAULT_BRAND_ID);
  const first = BRANDS.find((b) => b.id === ids[0])!;
  const size = SIZES.some((s) => s.id === sizePart) && first.sizes.includes(sizePart as BeadSize) ? (sizePart as BeadSize) : first.sizes.includes(DEFAULT_SIZE) ? DEFAULT_SIZE : first.sizes[0]!;
  return { size, ids: [...new Set(ids)].filter((x) => BRANDS.find((b) => b.id === x)!.sizes.includes(size)) };
}

/** The id for a choice (just the brand's id when it's a single brand in its usual size). */
export function brandIdOf({ size, ids }: BrandChoice): string {
  const unique = [...new Set(ids)];
  const plain = unique.length === 1 && parseBrandId(unique[0]!).size === size;
  return plain ? unique[0]! : `${size}:${unique.join("+")}`;
}

const mixes = new Map<string, Brand>();

/** A chart or a mix of charts (see parseBrandId); unknown ids fall back to the default. */
export function getBrand(id: string): Brand {
  const single = BRANDS.find((b) => b.id === id);
  if (single) return single;
  const hit = mixes.get(id);
  if (hit) return hit;
  const { size, ids } = parseBrandId(id);
  const parts = ids.map((x) => BRANDS.find((b) => b.id === x)!);
  if (parts.length === 1) return parts[0]!;
  const seen = new Set<string>();
  const colors = parts.flatMap((p) => p.colors).filter((c) => !seen.has(c.id) && seen.add(c.id));
  const brand: Brand = {
    id,
    source: [...new Set(parts.map((p) => p.source))].join("+"),
    name: parts.map((p) => p.name).join(" + "),
    short: parts.map((p) => p.short).join(" + "),
    sizes: [size],
    colors,
  };
  mixes.set(id, brand);
  return brand;
}

/** The charts (sources) a brand's colours come from. */
export function sourcesOf(brand: Brand): string[] {
  return brand.source.split("+");
}

/** "A1" or "80-15179 Evergreen". */
export function colorLabel(c: BeadColor): string {
  return c.name ? `${c.code} ${c.name}` : c.code;
}
