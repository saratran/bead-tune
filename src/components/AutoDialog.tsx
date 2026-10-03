import { useEffect, useRef, useState } from "react";
import {
  anchorsFor,
  absoluteScores,
  autoSuggest,
  candidateSettings,
  SCORE_VERSION,
  toneForSaturation,
  localEngine,
  type AutoEngine,
  countCombinations,
  tuneFromPreferences,
  pickName,
  SEARCH_OPTIONS,
  type Candidate,
  type DitherChoice,
  type PreferenceSeed,
  type RefinedSuggestion,
  type RefineMethod,
  type ScanProgress,
  type SearchSpace,
  type Tone,
  TONE_LABEL,
  TONES,
} from "../lib/auto";
import { canUseWorkers, workerEngine } from "../lib/autoPool";
import {
  allPresets,
  createPreset,
  deletePreset,
  duplicatePreset,
  loadLastConfig,
  loadLastPresetId,
  renamePreset,
  sameConfig,
  saveLastConfig,
  saveLastPresetId,
  updatePreset,
  type AutoConfig,
  type AutoPreset,
} from "../lib/autoPresets";
import { sameCandidate, type Bookmark } from "../lib/bookmarks";
import { buildPattern, type PipelineSettings } from "../lib/pipeline";
import { drawPattern, patternThumbnail } from "../lib/render";
import type { Crop, ImageSource } from "../lib/sampling";
import { SuggestionViewer, type ViewerItem } from "./SuggestionViewer";
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
  /** For viewing results large next to the original. */
  image?: HTMLImageElement | null;
  crop?: Crop;
  boardSize?: number;
  theme?: string;
  /** Which tab to open on. */
  initialTab?: AutoTab;
  /** Saves the current image settings as a bookmark; returns an error message, or null. */
  onBookmarkCurrent?: () => string | null;
}

export type AutoTab = "search" | "results";

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

/** Multi-select row of chips; at least one stays selected. Numeric rows can take custom values. */
function Chips<T>({
  label,
  options: base,
  selected,
  same = (a, b) => a === b,
  format,
  onChange,
  custom,
}: {
  label: string;
  options: T[];
  selected: T[];
  same?: (a: T, b: T) => boolean;
  format: (v: T) => string;
  onChange: (v: T[]) => void;
  /** Allow adding any whole number in this range. */
  custom?: { min: number; max: number };
}) {
  const isOn = (v: T) => selected.some((s) => same(s, v));
  // Custom values already selected show up as chips too.
  const options = custom
    ? ([...new Set([...(base as number[]), ...(selected as number[])])].sort((a, b) => a - b) as T[])
    : base;
  const [draft, setDraft] = useState("");
  const addCustom = () => {
    const n = Math.round(Number(draft));
    if (!custom || draft.trim() === "" || !Number.isFinite(n)) return;
    const v = Math.min(custom.max, Math.max(custom.min, n)) as T;
    if (!isOn(v)) onChange([...selected, v].sort((a, b) => (a as number) - (b as number)));
    setDraft("");
  };
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
        {custom && (
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              addCustom();
            }}
          >
            <input
              type="number"
              className="input"
              aria-label={`Add ${label.toLowerCase()} value`}
              placeholder="+ value"
              title={`Any whole number from ${custom.min} to ${custom.max} (values outside are clamped)`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit" className="chip" disabled={draft.trim() === ""} aria-label={`Add ${label.toLowerCase()}`}>
              Add
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export type ResultSort = "suggested" | "features" | "likeness" | "ease" | "colors-asc" | "colors-desc" | "beads" | "strays";
export type BookmarkSort = "newest" | "oldest" | "features" | "likeness" | "ease" | "colors-asc" | "colors-desc" | "name";

const RESULT_SORTS: [ResultSort, string][] = [
  ["suggested", "Suggested order"],
  ["features", "Features (best first)"],
  ["likeness", "Likeness (best first)"],
  ["ease", "Ease (easiest first)"],
  ["colors-asc", "Fewest colours"],
  ["colors-desc", "Most colours"],
  ["beads", "Fewest beads"],
  ["strays", "Fewest stray beads"],
];
const BOOKMARK_SORTS: [BookmarkSort, string][] = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["features", "Features (best first)"],
  ["likeness", "Likeness (best first)"],
  ["ease", "Ease (easiest first)"],
  ["colors-asc", "Fewest colours"],
  ["colors-desc", "Most colours"],
  ["name", "Name (A–Z)"],
];

/** Sorted copy (stable: ties keep their original order). */
export function sortResults<T extends { features: number; likeness: number; ease: number; metrics: { colors: number; beads: number; strays: number } }>(list: T[], sort: ResultSort): T[] {
  const key: Record<ResultSort, ((s: T) => number) | null> = {
    suggested: null,
    features: (s) => -s.features,
    likeness: (s) => -s.likeness,
    ease: (s) => -s.ease,
    "colors-asc": (s) => s.metrics.colors,
    "colors-desc": (s) => -s.metrics.colors,
    beads: (s) => s.metrics.beads,
    strays: (s) => s.metrics.strays,
  };
  const k = key[sort];
  return k ? [...list].sort((a, b) => k(a) - k(b)) : [...list];
}

export function sortBookmarks(list: Bookmark[], sort: BookmarkSort): Bookmark[] {
  const out = [...list];
  switch (sort) {
    case "newest":
      return out.sort((a, b) => b.createdAt - a.createdAt);
    case "oldest":
      return out.sort((a, b) => a.createdAt - b.createdAt);
    case "features":
      return out.sort((a, b) => (b.features ?? -1) - (a.features ?? -1));
    case "likeness":
      return out.sort((a, b) => b.likeness - a.likeness);
    case "ease":
      return out.sort((a, b) => b.ease - a.ease);
    case "colors-asc":
      return out.sort((a, b) => a.colors - b.colors);
    case "colors-desc":
      return out.sort((a, b) => b.colors - a.colors);
    case "name":
      return out.sort((a, b) => a.label.localeCompare(b.label));
  }
}

function loadSort<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSort(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** "Prefer" checkbox. A top-level component so it isn't remounted on every render (keeps focus). */
function PreferBox({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="prefer">
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Prefer ${label}`} />
      Prefer
    </label>
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

export function AutoDialog({
  source,
  base,
  results,
  onResults,
  onApply,
  bookmarks,
  onBookmarksChange,
  onClose,
  image,
  crop,
  boardSize = 26,
  theme = "dark",
  initialTab = "search",
  onBookmarkCurrent,
}: Props) {
  const [tab, setTab] = useState<AutoTab>(initialTab);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [config, setConfigState] = useState<AutoConfig>(loadLastConfig);
  const [presets, setPresets] = useState<AutoPreset[]>(allPresets);
  const [presetId, setPresetIdState] = useState(() => {
    const id = loadLastPresetId();
    return allPresets().some((p) => p.id === id) ? id : "";
  });
  const setPresetId = (id: string) => {
    setPresetIdState(id);
    saveLastPresetId(id);
  };
  // Name being typed for a new preset ("create") or the selected one ("rename").
  const [naming, setNaming] = useState<{ kind: "create" | "rename"; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  // Which list is open in the large viewer, and where.
  const [viewing, setViewing] = useState<{ from: "results" | "bookmarks"; index: number } | null>(null);
  const [resultSort, setResultSortState] = useState<ResultSort>(() => loadSort("bead-pattern:sort-results", "suggested"));
  const [bookmarkSort, setBookmarkSortState] = useState<BookmarkSort>(() => loadSort("bead-pattern:sort-bookmarks", "newest"));
  const setResultSort = (v: ResultSort) => {
    setResultSortState(v);
    saveSort("bead-pattern:sort-results", v);
  };
  const setBookmarkSort = (v: BookmarkSort) => {
    setBookmarkSortState(v);
    saveSort("bead-pattern:sort-bookmarks", v);
  };
  // What's shown, in order: results grouped by tone and sorted within each group.
  const shownResults = TONES.flatMap((t) => sortResults((results ?? []).filter((r) => (r.tone ?? "natural") === t), resultSort));
  const shownBookmarks = sortBookmarks(bookmarks, bookmarkSort);
  const [showSpace, setShowSpace] = useState(!results);
  const abort = useRef<AbortController | null>(null);

  // Editing keeps the preset selected; it shows as "(modified)" until saved or reverted.
  const setConfig = (c: AutoConfig) => {
    setConfigState(c);
    saveLastConfig(c);
  };
  const setSpace = <K extends keyof SearchSpace>(key: K, value: SearchSpace[K]) => setConfig({ ...config, space: { ...config.space, [key]: value } });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !progress && naming === null && !viewing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, progress, naming, viewing]);
  useEffect(() => () => abort.current?.abort(), []);

  // Evaluation runs on a pool of Web Workers, started on the first search and
  // stopped when the panel closes; on this thread if workers aren't available.
  const engine = useRef<Promise<AutoEngine & { size?: number }> | null>(null);
  const [cores, setCores] = useState(1);
  const getEngine = () =>
    (engine.current ??= (async () => {
      if (image && canUseWorkers()) {
        try {
          const pool = await workerEngine(await createImageBitmap(image), base);
          setCores(pool.size);
          return pool;
        } catch (err) {
          console.warn("Auto: running on the main thread instead of workers.", err);
        }
      }
      return localEngine(source, base);
    })());
  useEffect(
    () => () => {
      void engine.current?.then((e) => e.dispose?.());
    },
    [],
  );
  // Progress from many workers arrives fast; repaint at most ~15 times a second.
  const lastProgress = useRef(0);
  const showProgress = (p: ScanProgress) => {
    const now = performance.now();
    if (now - lastProgress.current < 66 && p.done < p.total) return;
    lastProgress.current = now;
    setProgress(p);
  };

  const total = countCombinations(config.space);
  const trying = Math.min(total, config.limit);

  const run = async () => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ phase: "search", done: 0, total: trying });
    const found = await autoSuggest(
      source,
      base,
      {
        space: config.space,
        count: config.count,
        limit: config.limit,
        tones: config.tones,
        refine: config.refine.enabled ? { method: config.refine.method, budget: config.refine.budget } : null,
      },
      showProgress,
      ctrl.signal,
      await getEngine(),
    );
    abort.current = null;
    setProgress(null);
    if (found.length) {
      onResults(found);
      setShowSpace(false);
      setTab("results");
    }
  };

  // Picks the user prefers, to tune further ("more like this").
  const [preferred, setPreferred] = useState<PreferenceSeed[]>([]);
  const isPreferred = (c: Candidate) => preferred.some((p) => sameCandidate(p.candidate, c));
  const togglePreferred = (seed: PreferenceSeed) =>
    setPreferred((list) => (list.some((p) => sameCandidate(p.candidate, seed.candidate)) ? list.filter((p) => !sameCandidate(p.candidate, seed.candidate)) : [...list, seed]));

  const tune = async (seeds: PreferenceSeed[]) => {
    if (!seeds.length) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress({ phase: "refine", done: 0, total: 1 });
    const found = await tuneFromPreferences(
      source,
      base,
      seeds.map((s) => ({ label: pickName(s.label), candidate: s.candidate, tone: s.tone })),
      // A few variations of each pick (at least 4 results, or 2 per pick).
      { count: Math.max(config.count, 4, seeds.length * 2), refine: { method: config.refine.method, budget: Math.max(40, config.refine.budget) } },
      showProgress,
      ctrl.signal,
      await getEngine(),
    );
    abort.current = null;
    setProgress(null);
    if (found.length) {
      onResults(found);
      setPreferred([]);
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
        features: s.features,
        tone: s.tone,
        ease: s.ease,
        colors: s.metrics.colors,
        beads: s.metrics.beads,
        strays: s.metrics.strays,
        createdAt: Date.now(),
        scoreVersion: SCORE_VERSION,
        context: { width: base.width, brandId: base.options.palette[0]?.id.split(":")[0] ?? "" },
      },
    ]);
  };

  // Bookmarks scored on an older scale are re-scored once (for the current width), so every
  // card uses the same ruler. Ones made at another width keep their numbers until used there.
  const rescoring = useRef(false);
  useEffect(() => {
    const stale = bookmarks.filter((b) => (b.scoreVersion ?? 0) < SCORE_VERSION && b.context.width === base.width);
    if (!stale.length || rescoring.current) return;
    rescoring.current = true;
    void (async () => {
      const engine = await getEngine();
      const updated = new Map<string, Partial<Bookmark>>();
      // Your own settings are judged by the tone their saturation implies; suggestions keep theirs.
      const toneOf = (b: Bookmark): Tone => (b.fixedScale ? toneForSaturation(b.candidate.saturation) : (b.tone ?? "natural"));
      for (const tone of new Set(stale.map(toneOf))) {
        const evaluate = engine.forTone(tone);
        const anchors = await anchorsFor(evaluate, tone);
        const group = stale.filter((b) => toneOf(b) === tone);
        const results = await evaluate(group.map((b) => b.candidate));
        group.forEach((b, i) => {
          const r = results[i];
          if (r && anchors) updated.set(b.id, { ...absoluteScores(r.metrics, anchors), tone, scoreVersion: SCORE_VERSION });
        });
      }
      rescoring.current = false;
      if (updated.size) onBookmarksChange(bookmarksRef.current.map((b) => (updated.has(b.id) ? { ...b, ...updated.get(b.id) } : b)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarks, base.width]);
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;

  const choosePreset = (id: string) => {
    setConfirmDelete(false);
    setNaming(null);
    const p = presets.find((x) => x.id === id);
    if (!p) return setPresetId("");
    const c = { space: p.space, count: p.count, limit: p.limit, refine: p.refine, tones: p.tones };
    setConfigState(c);
    saveLastConfig(c);
    setPresetId(id);
  };
  const current = presets.find((p) => p.id === presetId);
  const modified = !!current && !sameConfig(config, current);

  /** Runs a preset change, refreshes the list, and selects the result. */
  const presetAction = (fn: () => AutoPreset | void) => {
    setPresetError(null);
    try {
      const result = fn();
      setPresets(allPresets());
      if (result) setPresetId(result.id);
    } catch (e) {
      setPresetError((e as Error).message);
    }
  };

  // Bookmarks keep only a thumbnail, so their patterns are rebuilt (cheap) when viewed.
  const bookmarkPatterns = useRef(new Map<string, ViewerItem["pattern"]>());
  const viewerItems = (from: "results" | "bookmarks"): ViewerItem[] =>
    from === "results"
      ? shownResults.map((s, i) => ({
          key: `r${i}-${JSON.stringify(s.candidate)}`,
          label: s.label,
          tone: s.tone,
          pattern: s.pattern,
          scores: { features: s.features, likeness: s.likeness, ease: s.ease },
          settings: describeCandidate(s.candidate),
          bookmarked: !!bookmarkOf(s.candidate),
        }))
      : shownBookmarks.map((b) => {
          let pattern = bookmarkPatterns.current.get(b.id);
          if (!pattern) {
            pattern = buildPattern(source, candidateSettings(base, b.candidate)).pattern;
            bookmarkPatterns.current.set(b.id, pattern);
          }
          return {
            key: `b-${b.id}`,
            label: b.label,
            tone: b.tone,
            pattern,
            scores: { features: b.features, likeness: b.likeness, ease: b.ease },
            settings: describeCandidate(b.candidate),
            bookmarked: true,
          };
        });

  const space = config.space;
  return (
    <div className="modal-backdrop" onClick={() => !progress && onClose()}>
      <div className="modal auto-modal" role="dialog" aria-modal="true" aria-label="Auto suggestions" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="auto-tabs" role="tablist" aria-label="Auto">
            <button role="tab" aria-selected={tab === "search"} className={tab === "search" ? "on" : ""} onClick={() => setTab("search")} disabled={!!progress}>
              ✨ Search
            </button>
            <button role="tab" aria-selected={tab === "results"} className={tab === "results" ? "on" : ""} onClick={() => setTab("results")} disabled={!!progress}>
              ★ Results{(results?.length ?? 0) + bookmarks.length > 0 ? ` (${(results?.length ?? 0) + bookmarks.length})` : ""}
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={!!progress}>
            ×
          </button>
        </div>

        <div className="auto-body">
          {tab === "search" && (
          <>
          <div className="auto-presets">
            <label htmlFor="auto-preset">Preset</label>
            <select id="auto-preset" className="input" value={presetId} onChange={(e) => choosePreset(e.target.value)}>
              {!current && <option value="">Custom</option>}
              <optgroup label="Built-in">
                {presets
                  .filter((p) => p.builtIn)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === presetId && modified ? " (modified)" : ""}
                    </option>
                  ))}
              </optgroup>
              {presets.some((p) => !p.builtIn) && (
                <optgroup label="My presets">
                  {presets
                    .filter((p) => !p.builtIn)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.id === presetId && modified ? " (modified)" : ""}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>

            {naming ? (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const { kind, name } = naming;
                  presetAction(() => (kind === "create" ? createPreset(name, config) : renamePreset(presetId, name)));
                  setNaming(null);
                }}
              >
                <input
                  className="input"
                  aria-label={naming.kind === "create" ? "New preset name" : "Preset name"}
                  placeholder="Preset name"
                  value={naming.name}
                  autoFocus
                  onChange={(e) => setNaming({ ...naming, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
                />
                <button type="submit" className="btn btn-primary">
                  {naming.kind === "create" ? "Create" : "Rename"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setNaming(null)}>
                  Cancel
                </button>
              </form>
            ) : confirmDelete && current ? (
              <div className="row" role="group" aria-label="Confirm delete">
                <span className="small">Delete “{current.name}”?</span>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    presetAction(() => deletePreset(current.id));
                    setPresetId("");
                    setConfirmDelete(false);
                  }}
                >
                  Delete
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="row preset-actions">
                {current && !current.builtIn && (
                  <button className="btn btn-primary" disabled={!modified} onClick={() => presetAction(() => updatePreset(current.id, config))}>
                    Save changes
                  </button>
                )}
                {current && modified && (
                  <button className="btn btn-ghost" onClick={() => choosePreset(current.id)}>
                    Revert
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => setNaming({ kind: "create", name: current ? `${current.name.replace(/ \(default\)$/, "")}${modified ? " (edited)" : " copy"}` : "" })}>
                  New preset…
                </button>
                {current && (
                  <button className="btn btn-ghost" onClick={() => presetAction(() => duplicatePreset(current.id))}>
                    Duplicate
                  </button>
                )}
                {current && !current.builtIn && (
                  <>
                    <button className="btn btn-ghost" onClick={() => setNaming({ kind: "rename", name: current.name })}>
                      Rename…
                    </button>
                    <button className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
                      Delete…
                    </button>
                  </>
                )}
              </div>
            )}
            {current?.builtIn && modified && <p className="hint">Built-in presets can't be changed: save your edits as a new preset.</p>}
            {presetError && <p className="error">{presetError}</p>}
          </div>

          <details className="auto-space" open={showSpace} onToggle={(e) => setShowSpace((e.target as HTMLDetailsElement).open)}>
            <summary>Search space</summary>
            <p className="hint">Auto keeps your bead set, width, crop, background and outline as they are, and tries every combination of the values selected below.</p>
            <Chips label="Colour tone" options={TONES} selected={config.tones} format={(t: Tone) => TONE_LABEL[t]} onChange={(tones) => setConfig({ ...config, tones })} />
            <p className="hint chip-hint">Natural aims for accurate colours; Vivid and Muted aim for a richer or softer look. Pick several to get suggestions for each.</p>
            <Chips label="Sampling" options={["smooth", "sharp"] as ("smooth" | "sharp")[]} selected={space.sampling} format={(v) => (v === "smooth" ? "Smooth" : "Sharp")} onChange={(v) => setSpace("sampling", v)} />
            <Chips label="Noise smoothing" options={[false, true]} selected={space.denoise} format={(v) => (v ? "On" : "Off")} onChange={(v) => setSpace("denoise", v)} />
            <Chips label="Colours" options={SEARCH_OPTIONS.maxColors} selected={space.maxColors} format={String} onChange={(v) => setSpace("maxColors", v)} custom={{ min: 2, max: 120 }} />
            <Chips label="Dithering" options={SEARCH_OPTIONS.dither} selected={space.dither} same={sameDither} format={ditherLabel} onChange={(v) => setSpace("dither", v)} />
            <Chips label="Remove stray beads" options={SEARCH_OPTIONS.cleanup} selected={space.cleanup} format={(v) => (v === 0 ? "Off" : String(v))} onChange={(v) => setSpace("cleanup", v)} />
            <Chips label="Min beads per colour" options={SEARCH_OPTIONS.minBeads} selected={space.minBeads} format={(v) => (v === 0 ? "Off" : String(v))} onChange={(v) => setSpace("minBeads", v)} />
            <Chips label="Colour matching" options={["standard", "accurate"] as ("standard" | "accurate")[]} selected={space.metric} format={(v) => (v === "standard" ? "Standard (faster)" : "Accurate")} onChange={(v) => setSpace("metric", v)} />
            <Chips label="Brightness" options={SEARCH_OPTIONS.brightness} selected={space.brightness} format={signed} onChange={(v) => setSpace("brightness", v)} custom={{ min: -100, max: 100 }} />
            <Chips label="Contrast" options={SEARCH_OPTIONS.contrast} selected={space.contrast} format={signed} onChange={(v) => setSpace("contrast", v)} custom={{ min: -100, max: 100 }} />
            <Chips label="Saturation" options={SEARCH_OPTIONS.saturation} selected={space.saturation} format={signed} onChange={(v) => setSpace("saturation", v)} custom={{ min: -100, max: 100 }} />
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
              {config.tones.length > 1 && ` × ${config.tones.length} tones`}
              {total > trying && ` · trying an even spread of ${trying.toLocaleString()}`}
              {space.metric.length > 1 && " · trying both colour matchings doubles the time"}
            </span>
            {progress ? (
              <>
                <span className="small">{progress.phase === "refine" ? "Fine-tuning…" : "Searching…"}</span>
                <progress max={progress.total} value={progress.done} aria-label="Scan progress" />
                <span className="small">
                  {progress.done} / {progress.total}
                  {cores > 1 && <span className="muted"> · {cores} workers</span>}
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
          </>
          )}

          {tab === "results" && (
          <>
          <div className="results-actions">
            {onBookmarkCurrent && (
              <button
                className="btn btn-ghost"
                disabled={!!progress}
                onClick={() => setBookmarkError(onBookmarkCurrent())}
                title="Save your current image settings as a bookmark, to compare or fine-tune"
              >
                ★ Bookmark current settings
              </button>
            )}
            {progress && (
              <>
                <span className="small">Fine-tuning…</span>
                <progress max={progress.total} value={progress.done} aria-label="Tuning progress" />
                <button className="btn btn-ghost" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              </>
            )}
            {bookmarkError && <span className="error small">{bookmarkError}</span>}
          </div>
          {!results?.length && !bookmarks.length && !progress && (
            <div className="empty results-empty">
              <span>
                No results yet. Run a search on the <button className="link-btn" onClick={() => setTab("search")}>Search</button> tab, or bookmark your current settings.
              </span>
            </div>
          )}

          {preferred.length > 0 && !progress && (
            <div className="prefer-bar" role="status">
              <span>
                {preferred.length} preferred: {preferred.map((p) => p.label).join(", ")}
              </span>
              <button className="btn btn-primary" onClick={() => void tune(preferred)}>
                Tune selected ({preferred.length})
              </button>
              <button className="btn btn-ghost" onClick={() => setPreferred([])}>
                Clear
              </button>
            </div>
          )}

          {bookmarks.length > 0 && (
            <section className="auto-bookmarks" aria-label="Bookmarks">
              <div className="list-head">
                <h4>★ Bookmarks ({bookmarks.length})</h4>
                {bookmarks.length > 1 && (
                  <select className="input sort-select" aria-label="Sort bookmarks" value={bookmarkSort} onChange={(e) => setBookmarkSort(e.target.value as BookmarkSort)}>
                    {BOOKMARK_SORTS.map(([v, label]) => (
                      <option key={v} value={v}>
                        Sort: {label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <ul>
                {shownBookmarks.map((b) => (
                  <li key={b.id} className="auto-card bookmark">
                    <button className="thumb-btn" aria-label={`View ${b.label} larger`} title="View larger" onClick={() => setViewing({ from: "bookmarks", index: shownBookmarks.indexOf(b) })}>
                      <img className="auto-thumb" src={b.thumbnail} alt="" />
                    </button>
                    <div className="auto-card-info">
                      <div className="auto-card-title">
                        <strong>{b.label}</strong>
                        {b.tone && b.tone !== "natural" && <span className={`badge tone tone-${b.tone}`}>{TONE_LABEL[b.tone]}</span>}
                      </div>
                      <div className="auto-scores small">
                        {b.features !== undefined && <span>Features {b.features}</span>}
                        <span>Likeness {b.likeness}</span>
                        <span>Ease {b.ease}</span>
                      </div>
                      <span className="small">
                        {b.colors} colours · {b.beads.toLocaleString()} beads · {b.strays} stray
                      </span>
                      <span className="muted small auto-settings">{describeCandidate(b.candidate)}</span>
                      {b.fixedScale && <span className="muted small">Your settings</span>}
                      {b.context.width !== base.width && <span className="muted small">Made at {b.context.width} beads wide</span>}
                      <div className="row">
                        <button className="btn btn-primary" onClick={() => onApply(b)}>
                          Use this
                        </button>
                        <button className="btn btn-ghost" disabled={!!progress} onClick={() => void tune([b])}>
                          More like this
                        </button>
                        <button className="btn btn-ghost" onClick={() => onBookmarksChange(bookmarks.filter((x) => x.id !== b.id))}>
                          Remove
                        </button>
                        <PreferBox label={b.label} checked={isPreferred(b.candidate)} onToggle={() => togglePreferred(b)} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results && !progress && (
            <div className="auto-results">
              <div className="list-head">
                <h4>{results.length && results.every((r) => pickName(r.label) !== r.label) ? "Based on your picks" : "Suggestions"}</h4>
                {results.length > 1 && (
                  <select className="input sort-select" aria-label="Sort suggestions" value={resultSort} onChange={(e) => setResultSort(e.target.value as ResultSort)}>
                    {RESULT_SORTS.map(([v, label]) => (
                      <option key={v} value={v}>
                        Sort: {label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="hint">
                Scores are out of 100 for this image: 100 is as close as beads can get (every colour, accurate matching), 0 a crude 6-colour version. Features = outlines and fine details kept, likeness = overall colour (for the chosen tone), ease = fewer colours and stray beads.
              </p>
              {(() => {
                // Group by colour tone; headings only when there's more than one.
                const groups = TONES.map((t) => [t, shownResults.filter((r) => (r.tone ?? "natural") === t)] as const).filter(([, g]) => g.length > 0);
                return groups.map(([tone, group]) => (
                  <section key={tone} className="tone-group" aria-label={`${TONE_LABEL[tone]} suggestions`}>
                    {groups.length > 1 && <h5 className="tone-heading">{TONE_LABEL[tone]}</h5>}
                    <ul>
                      {group.map((s, i) => (
                  <li key={i} className="auto-card">
                    <button className="thumb-btn" aria-label={`View ${s.label} larger`} title="View larger" onClick={() => setViewing({ from: "results", index: shownResults.indexOf(s) })}>
                      <Thumbnail s={s} />
                    </button>
                    <div className="auto-card-info">
                      <div className="auto-card-title">
                        <strong>{s.label}</strong>
                        {s.tone && s.tone !== "natural" && <span className={`badge tone tone-${s.tone}`}>{TONE_LABEL[s.tone]}</span>}
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
                        <span title="How well outlines and fine features survive">Features {s.features}</span>
                        <span title="Overall colour closeness to the original">Likeness {s.likeness}</span>
                        <span title="Fewer colours, fewer stray beads, bigger areas">Ease {s.ease}</span>
                      </div>
                      <span className="small">
                        {s.metrics.colors} colours · {s.metrics.beads.toLocaleString()} beads · {s.metrics.strays} stray
                      </span>
                      <span className="muted small auto-settings">{describeCandidate(s.candidate)}</span>
                      <div className="row">
                        <button className="btn btn-primary" onClick={() => onApply(s)}>
                          Use this
                        </button>
                        <button className="btn btn-ghost" disabled={!!progress} onClick={() => void tune([s])}>
                          More like this
                        </button>
                        <PreferBox label={s.label} checked={isPreferred(s.candidate)} onToggle={() => togglePreferred(s)} />
                      </div>
                    </div>
                  </li>
                ))}
                    </ul>
                  </section>
                ));
              })()}
            </div>
          )}
          </>
          )}
        </div>
        {viewing &&
          (() => {
            const items = viewerItems(viewing.from);
            if (!items.length) return null;
            const index = Math.min(viewing.index, items.length - 1);
            const sourceOf = (item: ViewerItem) =>
              viewing.from === "results" ? shownResults[items.indexOf(item)]! : shownBookmarks[items.indexOf(item)]!;
            return (
              <SuggestionViewer
                items={items}
                index={index}
                onIndex={(i) => setViewing({ ...viewing, index: i })}
                onApply={(item) => {
                  const src = sourceOf(item);
                  setViewing(null);
                  onApply(src);
                }}
                onToggleBookmark={
                  viewing.from === "results"
                    ? (item) => toggleBookmark(shownResults[items.indexOf(item)]!)
                    : undefined
                }
                onClose={() => setViewing(null)}
                image={image}
                crop={crop}
                boardSize={boardSize}
                theme={theme}
              />
            );
          })()}
      </div>
    </div>
  );
}
