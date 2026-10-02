/** Decodes an image file for the dev scripts (macOS: uses `sips`), at most `maxSide` px. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { makeImageData } from "../src/lib/sampling";

export async function decodeImage(path: string, maxSide = 1024): Promise<ImageData> {
  const bmpPath = join(mkdtempSync(join(tmpdir(), "bead-")), "source.bmp");
  await $`sips -s format bmp -Z ${maxSide} ${path} --out ${bmpPath}`.quiet();
  return readBmp(new Uint8Array(await Bun.file(bmpPath).arrayBuffer()));
}

function readBmp(buf: Uint8Array): ImageData {
  const dv = new DataView(buf.buffer, buf.byteOffset);
  const offset = dv.getUint32(10, true);
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const h = Math.abs(hRaw);
  const bytes = bpp / 8;
  const stride = Math.ceil((w * bytes) / 4) * 4;
  const img = makeImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = hRaw > 0 ? h - 1 - y : y; // bottom-up unless height is negative
    for (let x = 0; x < w; x++) {
      const p = offset + row * stride + x * bytes;
      img.data.set([buf[p + 2]!, buf[p + 1]!, buf[p]!, bytes === 4 ? buf[p + 3]! : 255], (y * w + x) * 4);
    }
  }
  return img;
}
