import { useEffect, useRef, useState } from "react";
import {
  autoSuggest,
  countCombinations,
  SEARCH_OPTIONS,
  type Candidate,
  type DitherChoice,
  type RefinedSuggestion,
  type RefineMethod,
  type ScanProgress,
  type SearchSpace,
} from "../lib/auto";
import { allPresets, deletePreset, loadLastConfig, saveLastConfig, savePreset, type AutoConfig, type AutoPreset } from "../lib/autoPresets";
import { sameCandidate, type Bookmark } from "../lib/bookmarks";
import type { PipelineSettings } from "../lib/pipeline";
import { drawPattern, patternThumbnail } from "../lib/render";
import type { ImageSource } from "../lib/sampling";
import { RangeInput } from "./RangeInput";

interface Props {
  source: ImageSource;
  base: PipelineSettings;
  /** Suggestions from an earlier scan of the same image and settings, if any. */
  results: RefinedSuggestion[] | null;
  onResults: (s: RefinedSuggestion[]) => void;
  onApply: (s: { label: string; candidate: Candidate }) => void;
  /** Bookmarks for this image, kept across scans. */
  bookmarks: Bookmark[];
  onBookmarksChange: (b: Bookmark[]) => void;
  onClose: () => void;
}

const LIMITS = [100, 200, 300, 600, 1000, 2000];
const BUDGETS = [20, 40, 80, 150];

/** What fine-tuning changed, e.g. "31 colours (was 24) · brightness +6". */
export function describeChanges(from: Candidate, to: Candidate): string {
  const parts: string[] = [];
  if (from.maxColors !== to.maxColors) parts.push(`${to.maxColors} colours (was ${from.maxColors})`);
  for (const k of ["brightness", "contrast", "saturation"] as const) if (from[k] !== to[k]) parts.push(`${k} ${signed(to[k])} (was ${signed(from[k])})`);
  if (from.dither.strength !== to.dither.strength) parts.push(`dither ${to.dither.strength}% (was ${from.dither.strength}%)`);
  return parts.join(" · ");
}

const ditherLabel = (d: DitherChoice) => (d.mode === "none" ? "Off" : `${d.mode === "diffusion" ? "Diffusion" : "Ordered"} ${d.strength}%`);
const sameDither = (a: DitherChoice, b: DitherChoice) => a.mode === b.mode && a.strength === b.strength;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function describeCandidate(c: Candidate): string {
  const parts = [
    `${c.maxColors} colours`,
    c.sampling === "sharp" ? "Sharp" : "Smooth",
    c.denoise && "noise smoothing",
    c.dither.mode !== "none" && ditherLabel(c.dither).toLowerCase() + " dithering",
    c.cleanup > 0 && `clean-up ${c.cleanup}`,
    c.minBeads > 1 && `min ${c.minBeads} beads/colour`,
    c.metric === "accurate" && "accurate matching",
    c.brightness !== 0 && `brightness ${signed(c.brightness)}`,
    c.contrast !== 0 && `contrast ${signed(c.contrast)}`,
    c.saturation !== 0 && `saturation ${signed(c.saturation)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** Multi-select row of chips; at least one stays selected. */
function Chips<T>({ label, options, selected, same = (a, b) => a === b, format, onChange }: { label: string; options: T[]; selected: T[]; same?: (a: T, b: T) => boolean; format: (v: T) => string; onChange: (v: T[]) => void }) {
  const isOn = (v: T) => selected.some((s) => same(s, v));
  return (
    <div className="chip-row" role="group" aria-label={label}>
      <span className="chip-label">{label}</span>
      <div className="chips">
        {options.map((v) => {
          const on = isOn(v);
          return (
            <button
              key={format(v)}
              className={`chip ${on ? "on" : ""}`}
              aria-pressed={on}
              disabled={on && selected.length === 1}
              title={on && selected.length === 1 ? "At least one value is needed" : undefined}
              onClick={() => onChange(on ? selected.filter((s) => !same(s, v)) : options.filter((o) => isOn(o) || same(o, v)))}
            >
              {format(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Thumbnail({ s }: { s: { pattern: RefinedSuggestion["pattern"] } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const p = s.pattern;
    const cell = Math.max(1, Math.floor(180 / Math.max(p.width, p.height)));
    canvas.width = p.width * cell;
    canvas.height = p.height * cell;
    drawPattern(canvas.getContext("2d")!, p, { cell, shape: "square", codes: false, boardSize: p.width, showBoards: false, background: "#ffffff", gridColor: "rgba(0,0,0,0)" });
  }, [s]);
  return <canvas ref={ref} className="auto-thumb" />;
}

export function AutoDialog({ source, base, results, onResults, onApply, bookmarks, onBookmarksChange, onClose }: Props) {
  const [config, setConfigState] = useState<AutoConfig>(loadLastConfig);
  const [presets, setPresets] = useState<AutoPreset[]>(allPresets);
  const [presetId, setPresetId] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [showSpace, setShowSpace] = useState(!results);
  const abort = useRef<AbortController | null>(null);

  const setConfig = (c: AutoConfig) => {
    setConfigState(c);
    saveLastConfig(c);
    setPresetId("");
  };
  const setSpace = <K extends keyof SearchSpace>(key: K, value: SearchSpace[K]) => setConfig({ ...config, space: { ...config.space, [key]: value } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !progress && naming === null && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, progress, naming]);
  useEffect(() => () => abort.current?.abort(), []);

  const total = countCombinations(config.space);
  const trying = Math.min(total, config.limit);
  const accurate = config.space.metric.includes("accurate");

  const run = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ phase: "search", done: 0, total: trying });
    const found = await autoSuggest(
      source,
      base,
      { space: config.space, count: config.count, limit: config.limit, refine: config.refine.enabled ? { method: config.refine.method, budget: config.refine.budget } : null },
      setProgress,
      ctrl.signal,
    );
    abort.current = null;
    setProgress(null);
    if (found.length) {
      onResults(found);
      setShowSpace(false);
    }
  };

  const bookmarkOf = (c: Candidate) => bookmarks.find((b) => sameCandidate(b.candidate, c));
  const toggleBookmark = (s: RefinedSuggestion) => {
    const existing = bookmarkOf(s.candidate);
    if (existing) {
      onBookmarksChange(bookmarks.filter((b) => b !== existing));
      return;
    }
    onBookmarksChange([
      ...bookmarks,
      {
        id: `bm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        label: s.label,
        candidate: s.candidate,
        thumbnail: patternThumbnail(s.pattern),
        likeness: s.likeness,
        ease: s.ease,
        colors: s.metrics.colors,
        beads: s.metrics.beads,
        strays: s.metrics.strays,
        createdAt: Date.now(),
        context: { width: base.width, brandId: base.options.palette[0]?.id.split(":")[0] ?? "" },
      },
    ]);
  };

  const choosePreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    const c = { space: p.space, count: p.count, limit: p.limit, refine: p.refine };
    setConfigState(c);
    saveLastConfig(c);
    setPresetId(id);
  };
  const current = presets.find((p) => p.id === presetId);

  const space = config.space;
  return (
    <div className="modal-backdrop" onClick={() => !progress && onClose()}>
      <div className="modal auto-modal" role="dialog" aria-modal="true" aria-label="Auto suggestions" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>✨ Auto suggestions</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={!!progress}>
            ×
          </button>
        </div>

        <div className="auto-body">
          <div className="auto-presets">
            <label htmlFor="auto-preset">Preset</label>
            <select id="auto-preset" className="input" value={presetId} onChange={(e) => choosePreset(e.target.value)}>
              <option value="">{presetId ? "—" : "Custom"}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {naming === null ? (
              <>
                <button className="btn btn-ghost" onClick={() => setNaming(current && !current.builtIn ? current.name : "")}>
                  Save preset…
                </button>
                {current && !current.builtIn && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      deletePreset(current.id);
                      setPresets(allPresets());
                      setPresetId("");
                    }}
                  >
                    Delete preset
                  </button>
                )}
              </>
            ) : (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const p = savePreset(naming, config);
                  setPresets(allPresets());
                  setPresetId(p.id);
                  setNaming(null);
                }}
              >
                <input className="input" aria-label="Preset name" placeholder="Preset name" value={naming} autoFocus onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} />
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setNaming(null)}>
                  Cancel
                </button>
              </form>
            )}
          </div>

          <details className="auto-space" open={showSpace} onToggle={(e) => setShowSpace((e.target as HTMLDetailsElement).open)}>
            <summary>Search space</summary>
            <p className="hint">Auto keeps your bead set, width, crop, background and outline as they are, and tries every combination of the values selected below.</p>
            <Chips label="Sampling" options={["smooth", "sharp"] as ("smooth" | "sharp")[]} selected={space.sampling} format={(v) => (v === "smooth" ? "Smooth" : "Sharp")} onChange={(v) => setSpace("sampling", v)} />
            <Chips label="Noise smoothing" options={[false, true]} selected={space.denoise} format={(v) => (v ? "On" : "Off")} onChange={(v) => setSpace("denoise", v)} />
            <Chips label="Colours" options={SEARCH_OPTIONS.maxColors} selected={space.maxColors} format={String} onChange={(v) => setSpace("maxColors", v)} />
            <Chips label="Dithering" options={SEARCH_OPTIONS.dither} selected={space.dither} same={sameDither} format={ditherLabel} onChange={(v) => setSpace("dither", v)} />
            <Chips label="Remove stray beads" options={SEARCH_OPTIONS.cleanup} selected={space.cleanup} format={(v) => (v === 0 ? "Off" : String(v))} onChange={(v) => setSpace("cleanup", v)} />
            <Chips label="Min beads per colour" options={SEARCH_OPTIONS.minBeads} selected={space.minBeads} format={(v) => (v === 0 ? "Off" : String(v))} onChange={(v) => setSpace("minBeads", v)} />
            <Chips label="Colour matching" options={["standard", "accurate"] as ("standard" | "accurate")[]} selected={space.metric} format={(v) => (v === "standard" ? "Standard" : "Accurate (slower)")} onChange={(v) => setSpace("metric", v)} />
            <Chips label="Brightness" options={SEARCH_OPTIONS.brightness} selected={space.brightness} format={signed} onChange={(v) => setSpace("brightness", v)} />
            <Chips label="Contrast" options={SEARCH_OPTIONS.contrast} selected={space.contrast} format={signed} onChange={(v) => setSpace("contrast", v)} />
            <Chips label="Saturation" options={SEARCH_OPTIONS.saturation} selected={space.saturation} format={signed} onChange={(v) => setSpace("saturation", v)} />
            <div className="auto-limits">
              <div className="field">
                <label htmlFor="auto-count">
                  Suggestions <span className="muted">{config.count}</span>
                </label>
                <RangeInput id="auto-count" label="Suggestions" value={config.count} min={3} max={12} onChange={(count) => setConfig({ ...config, count })} />
              </div>
              <div className="field">
                <label htmlFor="auto-limit">Try at most</label>
                <select id="auto-limit" className="input" value={config.limit} onChange={(e) => setConfig({ ...config, limit: Number(e.target.value) })}>
                  {LIMITS.map((n) => (
                    <option key={n} value={n}>
                      {n} combinations
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="auto-refine">
              <label className="toggle">
                <input type="checkbox" checked={config.refine.enabled} onChange={(e) => setConfig({ ...config, refine: { ...config.refine, enabled: e.target.checked } })} />
                <span className="track" aria-hidden />
                <span>Fine-tune suggestions</span>
              </label>
              {config.refine.enabled && (
                <>
                  <div className="segmented" role="radiogroup" aria-label="Fine-tuning method">
                    {(
                      [
                        ["pattern", "Pattern search"],
                        ["anneal", "Simulated annealing"],
                      ] as [RefineMethod, string][]
                    ).map(([m, label]) => (
                      <button key={m} role="radio" aria-checked={config.refine.method === m} className={config.refine.method === m ? "on" : ""} onClick={() => setConfig({ ...config, refine: { ...config.refine, method: m } })}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <select aria-label="Fine-tuning effort" className="input" value={config.refine.budget} onChange={(e) => setConfig({ ...config, refine: { ...config.refine, budget: Number(e.target.value) } })}>
                    {BUDGETS.map((n) => (
                      <option key={n} value={n}>
                        {n} tries per suggestion
                      </option>
                    ))}
                  </select>
                </>
              )}
              <p className="hint">
                After the search, each suggestion's brightness, contrast, saturation, colour count and dither strength are nudged to the best in-between values. Pattern search is usually
                better for this; annealing explores more randomly.
              </p>
            </div>
          </details>

          <div className="auto-run">
            <span className="muted small" data-testid="auto-count">
              {total.toLocaleString()} combination{total === 1 ? "" : "s"}
              {total > trying && ` · trying an even spread of ${trying.toLocaleString()}`}
              {accurate && " · Accurate matching is several times slower"}
            </span>
            {progress ? (
              <>
                <span className="small">{progress.phase === "refine" ? "Fine-tuning…" : "Searching…"}</span>
                <progress max={progress.total} value={progress.done} aria-label="Scan progress" />
                <span className="small">
                  {progress.done} / {progress.total}
                </span>
                <button className="btn btn-ghost" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={() => void run()}>
                {results ? "Search again" : "Find suggestions"}
              </button>
            )}
          </div>

          {bookmarks.length > 0 && (
            <section className="auto-bookmarks" aria-label="Bookmarks">
              <h4>★ Bookmarks ({bookmarks.length})</h4>
              <ul>
                {[...bookmarks].reverse().map((b) => (
                  <li key={b.id} className="auto-card bookmark">
                    <img className="auto-thumb" src={b.thumbnail} alt="" />
                    <div className="auto-card-info">
                      <strong>{b.label}</strong>
                      <div className="auto-scores small">
                        <span>Likeness {b.likeness}</span>
                        <span>Ease {b.ease}</span>
                      </div>
                      <span className="small">
                        {b.colors} colours · {b.beads.toLocaleString()} beads · {b.strays} stray
                      </span>
                      <span className="muted small auto-settings">{describeCandidate(b.candidate)}</span>
                      {b.context.width !== base.width && <span className="muted small">Made at {b.context.width} beads wide</span>}
                      <div className="row">
                        <button className="btn btn-primary" onClick={() => onApply(b)}>
                          Use this
                        </button>
                        <button className="btn btn-ghost" onClick={() => onBookmarksChange(bookmarks.filter((x) => x.id !== b.id))}>
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results && !progress && (
            <div className="auto-results">
              <h4>Suggestions</h4>
              <p className="hint">Scores compare the suggestions with each other: likeness to your original image, and ease of making (fewer colours and stray beads).</p>
              <ul>
                {results.map((s, i) => (
                  <li key={i} className="auto-card">
                    <Thumbnail s={s} />
                    <div className="auto-card-info">
                      <div className="auto-card-title">
                        <strong>{s.label}</strong>
                        {s.refinedFrom && (
                          <span className="badge" title={`Fine-tuned: ${describeChanges(s.refinedFrom, s.candidate)}`}>
                            Fine-tuned
                          </span>
                        )}
                        <button
                          className={`star-btn ${bookmarkOf(s.candidate) ? "on" : ""}`}
                          aria-pressed={!!bookmarkOf(s.candidate)}
                          aria-label={bookmarkOf(s.candidate) ? `Remove bookmark: ${s.label}` : `Bookmark ${s.label}`}
                          title={bookmarkOf(s.candidate) ? "Bookmarked" : "Bookmark"}
                          onClick={() => toggleBookmark(s)}
                        >
                          {bookmarkOf(s.candidate) ? "★" : "☆"}
                        </button>
                      </div>
                      <span className="muted small">{s.reason}</span>
                      <div className="auto-scores small">
                        <span>Likeness {s.likeness}</span>
                        <span>Ease {s.ease}</span>
                      </div>
                      <span className="small">
                        {s.metrics.colors} colours · {s.metrics.beads.toLocaleString()} beads · {s.metrics.strays} stray
                      </span>
                      <span className="muted small auto-settings">{describeCandidate(s.candidate)}</span>
                      <button className="btn btn-primary" onClick={() => onApply(s)}>
                        Use this
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
