import { describe, expect, test } from "bun:test";
import { hexToRgb } from "./color";
import { brandIdOf, brandsForSize, BRANDS, colorLabel, DEFAULT_BRAND_ID, getBrand, parseBrandId, sourcesOf } from "./palettes";

const brand = (id: string) => BRANDS.find((b) => b.id === id)!;

describe("presets", () => {
  test("defaults to MARD 221", () => {
    expect(DEFAULT_BRAND_ID).toBe("mard-221");
    expect(getBrand(DEFAULT_BRAND_ID).name).toBe("MARD A–M (221)");
  });

  test("MARD 221 is exactly the A–M series of MARD 291", () => {
    const core = brand("mard-221").colors;
    const all = brand("mard-291").colors;
    expect(core.length).toBe(221);
    expect(all.length).toBe(291);
    expect(core.every((c) => /^[A-M]\d+$/.test(c.code))).toBe(true);
    expect(all.filter((c) => /^[A-M]\d+$/.test(c.code)).map((c) => c.id)).toEqual(core.map((c) => c.id));
  });

  test("Perler has 103 named colours", () => {
    const perler = brand("perler").colors;
    expect(perler.length).toBe(103);
    expect(perler.every((c) => c.name.length > 0)).toBe(true);
  });

  test("MARD presets share the source so 'colours I have' carries over", () => {
    expect(brand("mard-221").source).toBe(brand("mard-291").source);
    expect(brand("perler").source).not.toBe(brand("mard-221").source);
  });

  test("brand names don't repeat the size (it's chosen separately)", () => {
    for (const b of BRANDS) expect(b.name).not.toMatch(/\d\s?mm/i);
  });

  test("getBrand falls back to the first preset", () => {
    expect(getBrand("nope")).toBe(BRANDS[0]!);
  });
});

describe.each(BRANDS.map((b) => [b.id, b] as const))("%s colours", (_id, b) => {
  test("ids are unique and namespaced by source", () => {
    const ids = b.colors.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith(`${b.source}:`))).toBe(true);
  });

  test("hex, rgb and lab agree and are valid", () => {
    for (const c of b.colors) {
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.rgb).toEqual(hexToRgb(c.hex));
      expect(c.lab.every(Number.isFinite)).toBe(true);
    }
  });

  test("codes are sorted naturally (2 before 10)", () => {
    const codes = b.colors.map((c) => c.code);
    expect([...codes].sort((x, y) => x.localeCompare(y, "en", { numeric: true }))).toEqual(codes);
  });
});

test("colorLabel shows code alone when there is no name", () => {
  const a1 = brand("mard-291").colors.find((c) => c.code === "A1")!;
  expect(a1.name).toBe("");
  expect(colorLabel(a1)).toBe("A1");
  const white = brand("perler").colors.find((c) => c.name === "White")!;
  expect(colorLabel(white)).toBe(`${white.code} White`);
});

describe("sizes and mixing brands", () => {
  test("every chart has a size, and the sizes have the expected brands", () => {
    for (const b of BRANDS) expect(b.sizes.length).toBeGreaterThan(0);
    expect(brandsForSize("5mm").map((b) => b.id)).toEqual(["mard-221", "mard-291", "perler", "hama", "artkal-s", "artkal-r", "nabbi"]);
    expect(brandsForSize("2.6mm").map((b) => b.id)).toEqual(["mard-221", "mard-291", "perler-mini", "hama-mini", "artkal-a", "artkal-c", "artkal-m"]);
    expect(brandsForSize("10mm").map((b) => b.id)).toEqual(["hama-maxi"]);
  });

  test("older ids still work; a mix combines the colours of its brands", () => {
    expect(parseBrandId("perler")).toEqual({ size: "5mm", ids: ["perler"] });
    expect(parseBrandId("hama-mini")).toEqual({ size: "2.6mm", ids: ["hama-mini"] });
    const id = brandIdOf({ size: "5mm", ids: ["mard-221", "hama"] });
    expect(id).toBe("5mm:mard-221+hama");
    const mix = getBrand(id);
    expect(mix.colors.length).toBe(getBrand("mard-221").colors.length + getBrand("hama").colors.length);
    expect(sourcesOf(mix)).toEqual(["mard", "hama"]);
    expect(new Set(mix.colors.map((c) => c.brand))).toEqual(new Set(["MARD", "Hama"]));
  });

  test("a single brand in its usual size keeps its plain id; another size is spelled out", () => {
    expect(brandIdOf({ size: "5mm", ids: ["mard-221"] })).toBe("mard-221");
    expect(brandIdOf({ size: "2.6mm", ids: ["mard-221"] })).toBe("2.6mm:mard-221");
    expect(parseBrandId("2.6mm:mard-221")).toEqual({ size: "2.6mm", ids: ["mard-221"] });
  });

  test("brands of another size are dropped from a mix", () => {
    expect(parseBrandId("5mm:perler+hama-mini").ids).toEqual(["perler"]);
  });
});
