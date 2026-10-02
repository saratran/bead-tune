/**
 * A recording stand-in for CanvasRenderingContext2D. happy-dom has no canvas
 * implementation, so drawing code is tested by inspecting the calls it makes.
 */

export interface DrawState {
  fillStyle: string;
  strokeStyle: string;
  globalAlpha: number;
  font: string;
  lineWidth: number;
}

export interface DrawCall {
  name: string;
  args: unknown[];
  state: DrawState;
}

const RECORDED = [
  "arc",
  "beginPath",
  "clearRect",
  "clip",
  "drawImage",
  "ellipse",
  "fill",
  "fillRect",
  "fillText",
  "lineTo",
  "moveTo",
  "rect",
  "rotate",
  "roundRect",
  "setLineDash",
  "setTransform",
  "stroke",
  "strokeRect",
  "translate",
] as const;

export class MockContext2D {
  calls: DrawCall[] = [];
  fillStyle = "#000000";
  strokeStyle = "#000000";
  globalAlpha = 1;
  font = "10px sans-serif";
  lineWidth = 1;
  lineCap = "butt";
  textAlign = "start";
  textBaseline = "alphabetic";
  imageSmoothingQuality = "low";
  private stack: DrawState[] = [];

  constructor(public canvas: HTMLCanvasElement) {
    for (const name of RECORDED) {
      (this as unknown as Record<string, (...args: unknown[]) => void>)[name] = (...args: unknown[]) => {
        this.calls.push({ name, args, state: this.snapshot() });
      };
    }
  }

  private snapshot(): DrawState {
    const { fillStyle, strokeStyle, globalAlpha, font, lineWidth } = this;
    return { fillStyle, strokeStyle, globalAlpha, font, lineWidth };
  }

  save() {
    this.stack.push(this.snapshot());
  }

  restore() {
    Object.assign(this, this.stack.pop());
  }

  /** Approximates text width as 0.6em per character. */
  measureText(text: string) {
    const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.6 };
  }

  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: "srgb" };
  }

  named(name: string): DrawCall[] {
    return this.calls.filter((c) => c.name === name);
  }

  texts(): string[] {
    return this.named("fillText").map((c) => String(c.args[0]));
  }
}

export function mockContext(): MockContext2D {
  return new MockContext2D(document.createElement("canvas"));
}

/** Smallest valid PNG (1×1 transparent), used for toDataURL/toBlob. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

export function installCanvasMock(): void {
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = function (this: HTMLCanvasElement & { __ctx?: MockContext2D }) {
    return (this.__ctx ??= new MockContext2D(this));
  };
  proto.toDataURL = () => PNG_DATA_URL;
  proto.toBlob = function (cb: (b: Blob | null) => void, type = "image/png") {
    const bytes = Uint8Array.from(atob(PNG_BASE64), (ch) => ch.charCodeAt(0));
    cb(new Blob([bytes], { type }));
  };
}

export function contextOf(canvas: HTMLCanvasElement): MockContext2D {
  return canvas.getContext("2d") as unknown as MockContext2D;
}
