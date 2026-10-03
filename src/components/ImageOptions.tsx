import type { ReactNode } from "react";
import { rgbToHex, type ColorMetric, type RGB } from "../lib/color";
import { DEFAULT_ADJUSTMENTS, type Adjustments, type DitherMode } from "../lib/pattern";
import type { PipelineResult } from "../lib/pipeline";
import type { SamplingMode } from "../lib/sampling";
import { RangeInput } from "./RangeInput";
import { Toggle } from "./Toggle";

export interface ImageSettings {
  sampling: SamplingMode;
  denoise: boolean;
  removeBackground: boolean;
  bgTolerance: number;
  bgColor: RGB | null;
  trim: boolean;
  maxColors: number;
  minBeads: number;
  metric: ColorMetric;
  dither: DitherMode;
  ditherStrength: number;
  cleanup: number;
  /** An empty ring of beads round the finished pattern (making it 2 beads bigger), so an outline fits. */
  edgeMargin: boolean;
  adjustments: Adjustments;
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  sampling: "smooth",
  denoise: false,
  removeBackground: false,
  bgTolerance: 14,
  bgColor: null,
  trim: false,
  maxColors: 24,
  minBeads: 0,
  metric: "standard",
  dither: "none",
  ditherStrength: 85,
  cleanup: 0,
  edgeMargin: false,
  adjustments: DEFAULT_ADJUSTMENTS,
};

interface Props {
  settings: ImageSettings;
  onChange: (s: ImageSettings) => void;
  result: PipelineResult | null;
  pickingBackground: boolean;
  onPickBackground: (picking: boolean) => void;
  /** Which settings to show: image (sampling, adjustments, background), colours (palette, dithering, clean-up), or all. */
  group?: "image" | "colours" | "all";
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Range({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="muted">{format(value)}</span>
      </label>
      <RangeInput id={id} label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section" aria-label={title}>
      <h3 className="section-title">{title}</h3>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = `adjust-${label.toLowerCase()}`;
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <RangeInput id={id} label={label} value={value} min={-100} max={100} onChange={onChange} />
      <output htmlFor={id}>{value > 0 ? `+${value}` : value}</output>
    </div>
  );
}

const SAMPLING_HINTS: Record<SamplingMode, string> = {
  smooth: "Blends colours within each bead. Best for photos.",
  sharp: "Each bead takes its main colour. Crisp edges for drawings and logos.",
  pixelart: "Uses the exact pixels of enlarged pixel art.",
};

export function ImageOptions({ settings: s, onChange, result, pickingBackground, onPickBackground, group = "all" }: Props) {
  const set = <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => onChange({ ...s, [key]: value });
  const setAdj = (key: keyof Adjustments, v: number) => set("adjustments", { ...s.adjustments, [key]: v });
  const grid = result?.pixelGrid;

  return (
    <div className="image-options">
      {group !== "colours" && (
        <>
          <Section title="Image">
            <div className="field">
              <span className="field-label">Sampling</span>
              <Segmented<SamplingMode>
                label="Sampling"
                options={[
                  ["smooth", "Smooth"],
                  ["sharp", "Sharp"],
                  ["pixelart", "Pixel art"],
                ]}
                value={s.sampling}
                onChange={(v) => set("sampling", v)}
              />
              <p className="hint">{SAMPLING_HINTS[s.sampling]}</p>
              {s.sampling === "pixelart" && grid && !result?.pixelArtFallback && (
                <p className="hint">
                  Found {grid.cols} × {grid.rows} pixels (each {grid.scale} × {grid.scale}). Width is set by the art.
                </p>
              )}
              {s.sampling === "pixelart" && result?.pixelArtFallback && (
                <p className="hint warn">No pixel grid found — using Sharp sampling instead.</p>
              )}
            </div>
            {s.sampling !== "pixelart" && <Toggle label="Smooth out noise" checked={s.denoise} onChange={(v) => set("denoise", v)} />}
            <Slider label="Brightness" value={s.adjustments.brightness} onChange={(v) => setAdj("brightness", v)} />
            <Slider label="Contrast" value={s.adjustments.contrast} onChange={(v) => setAdj("contrast", v)} />
            <Slider label="Saturation" value={s.adjustments.saturation} onChange={(v) => setAdj("saturation", v)} />
            <button className="btn btn-ghost" onClick={() => set("adjustments", DEFAULT_ADJUSTMENTS)}>
              Reset image
            </button>
          </Section>

          <Section title="Background">
            <Toggle label="Remove background" checked={s.removeBackground} onChange={(v) => set("removeBackground", v)} />
            {s.removeBackground && (
              <>
                <Range id="bg-tolerance" label="Tolerance" value={s.bgTolerance} min={2} max={50} onChange={(v) => set("bgTolerance", v)} />
                <div className="toggle-row">
                  <span className="row">
                    Colour
                    {s.bgColor ? (
                      <span className="dot big" style={{ background: rgbToHex(s.bgColor) }} title={rgbToHex(s.bgColor)} />
                    ) : (
                      <span className="muted">auto</span>
                    )}
                  </span>
                  <span className="row">
                    <button className="link-btn" aria-pressed={pickingBackground} onClick={() => onPickBackground(!pickingBackground)}>
                      {pickingBackground ? "Click the image…" : "Pick from image"}
                    </button>
                    {s.bgColor && (
                      <button className="link-btn" onClick={() => set("bgColor", null)}>
                        Auto
                      </button>
                    )}
                  </span>
                </div>
              </>
            )}
            <Toggle label="Trim empty space" checked={s.trim} onChange={(v) => set("trim", v)} />
          </Section>
        </>
      )}
      {group !== "image" && (
        <>
          <Section title="Colours">
            <Range id="colors" label="Colours" value={s.maxColors} min={2} max={120} onChange={(v) => set("maxColors", v)} format={(v) => `up to ${v}`} />
            <Range
              id="min-beads"
              label="Min beads per colour"
              value={s.minBeads}
              min={0}
              max={30}
              onChange={(v) => set("minBeads", v)}
              format={(v) => (v <= 1 ? "off" : String(v))}
            />
            <div className="field">
              <span className="field-label">Colour matching</span>
              <Segmented<ColorMetric>
                label="Colour matching"
                options={[
                  ["standard", "Standard"],
                  ["accurate", "Accurate"],
                ]}
                value={s.metric}
                onChange={(v) => set("metric", v)}
              />
            </div>
            <div className="field">
              <span className="field-label">Dithering</span>
              <Segmented<DitherMode>
                label="Dithering"
                options={[
                  ["none", "Off"],
                  ["diffusion", "Diffusion"],
                  ["ordered", "Ordered"],
                ]}
                value={s.dither}
                onChange={(v) => set("dither", v)}
              />
            </div>
            {s.dither !== "none" && (
              <Range id="dither-strength" label="Dither strength" value={s.ditherStrength} min={0} max={100} onChange={(v) => set("ditherStrength", v)} format={(v) => `${v}%`} />
            )}
          </Section>

          <Section title="Clean up">
            <Range
              id="cleanup"
              label="Remove stray beads"
              value={s.cleanup}
              min={0}
              max={6}
              onChange={(v) => set("cleanup", v)}
              format={(v) => (v === 0 ? "off" : v === 1 ? "single beads" : `groups up to ${v}`)}
            />
            <p className="hint">Very dark or bright single beads (eyes, sparkles) are kept.</p>
          </Section>
        </>
      )}
    </div>
  );
}
