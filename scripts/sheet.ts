/** Contact sheets for the dev scripts: tiles of bead patterns / images, written as PNG (macOS `sips`). */
import { $ } from "bun";
import type { Pattern } from "../src/lib/pattern";

export type Tile = { w: number; h: number; px: (x: number, y: number) => [number, number, number] };

export const imageTile = (img: ImageData): Tile => ({
  w: img.width,
  h: img.height,
  px: (x, y) => [img.data[(y * img.width + x) * 4]!, img.data[(y * img.width + x) * 4 + 1]!, img.data[(y * img.width + x) * 4 + 2]!],
});

export const patternTile = (p: Pattern): Tile => ({
  w: p.width,
  h: p.height,
  px: (x, y) => {
    const idx = p.cells[y * p.width + x]!;
    return idx < 0 ? [255, 255, 255] : p.colors[idx]!.rgb;
  },
});

/** Writes `tiles` in rows of `perRow`, `cell` px per bead, to `pngPath`. */
export async function writeSheet(pngPath: string, tiles: Tile[], cell = 6, perRow = 5): Promise<void> {
  const GAP = 12;
  const tileW = Math.max(...tiles.map((t) => t.w * cell)), tileH = Math.max(...tiles.map((t) => t.h * cell));
  const rows = Math.ceil(tiles.length / perRow);
  const sheetW = Math.min(tiles.length, perRow) * (tileW + GAP) + GAP;
  const sheetH = rows * (tileH + GAP) + GAP;
  const stride = Math.ceil((sheetW * 3) / 4) * 4;
  const bmp = new Uint8Array(54 + stride * sheetH);
  const dv = new DataView(bmp.buffer);
  bmp.set([0x42, 0x4d]);
  dv.setUint32(2, bmp.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, sheetW, true);
  dv.setInt32(22, -sheetH, true); // top-down
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  bmp.fill(40, 54); // dark grey background
  tiles.forEach((t, n) => {
    const ox = GAP + (n % perRow) * (tileW + GAP);
    const oy = GAP + Math.floor(n / perRow) * (tileH + GAP);
    for (let y = 0; y < t.h * cell; y++) {
      for (let x = 0; x < t.w * cell; x++) {
        const [r, g, b] = t.px(Math.floor(x / cell), Math.floor(y / cell));
        const edge = cell > 2 && (x % cell === cell - 1 || y % cell === cell - 1);
        const p = 54 + (y + oy) * stride + (x + ox) * 3;
        bmp.set(edge ? [b * 0.85, g * 0.85, r * 0.85] : [b, g, r], p);
      }
    }
  });
  const bmpPath = pngPath.replace(/\.png$/, ".bmp");
  await Bun.write(bmpPath, bmp);
  await $`sips -s format png ${bmpPath} --out ${pngPath}`.quiet();
  await $`rm ${bmpPath}`.quiet();
}
