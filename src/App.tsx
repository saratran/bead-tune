import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { BeadList } from "./components/BeadList";
import { ColorPicker } from "./components/ColorPicker";
import { Dropzone } from "./components/Dropzone";
import { DEFAULT_IMAGE_SETTINGS, ImageOptions, type ImageSettings } from "./components/ImageOptions";
import { PatternView, type EditTool } from "./components/PatternView";
import { applyEdits, type Edits } from "./lib/cleanup";
import { BRANDS, colorLabel, DEFAULT_BRAND_ID, getBrand, type BeadColor } from "./lib/palettes";
import { applySwaps } from "./lib/pattern";
import { buildPattern } from "./lib/pipeline";
import { canvasSource } from "./lib/sampling";
import { ExportDialog } from "./components/ExportDialog";
import { ShapePicker } from "./components/ShapePicker";
import { Toggle } from "./components/Toggle";
import { DEFAULT_EXPORT, type ExportSettings } from "./lib/export";
import type { CellShape } from "./lib/render";
import { makeSampleImage } from "./lib/sample";

const WIDTH_PRESETS = [52, 78, 104];
const OWNED_KEY = "bead-pattern:owned";
const THEME_KEY = "bead-pattern:theme";
const DISPLAY_KEY = "bead-pattern:display";
const EXPORT_KEY = "bead-pattern:export";

interface DisplaySettings {
  shape: CellShape;
  codes: boolean;
}

const DEFAULT_DISPLAY: DisplaySettings = { shape: "square", codes: false };

/** Stored settings merged over defaults, so new fields get sensible values. */
function loadStored<T extends object>(key: string, defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  } catch {
    return defaults;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

type Theme = "dark" | "light";

function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function loadOwned(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(OWNED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveOwned(v: Record<string, string[]>) {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify(v));
  } catch {}
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = url;
  });
}

type Modal = { kind: "owned" } | { kind: "swap"; from: BeadColor } | { kind: "outline" } | { kind: "brush" } | null;

const MAX_UNDO = 50;

/** Darkest colour in a palette — the natural default for outlines. */
function darkest(colors: BeadColor[]): BeadColor {
  return colors.reduce((a, b) => (b.lab[0] < a.lab[0] ? b : a));
}

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("pattern");
  const [error, setError] = useState<string | null>(null);

  const [brandId, setBrandId] = useState(DEFAULT_BRAND_ID);
  const [width, setWidth] = useState(WIDTH_PRESETS[0]!);
  const [boardInput, setBoardInput] = useState(26);
  const [imageSettings, setImageSettings] = useState<ImageSettings>(DEFAULT_IMAGE_SETTINGS);
  const [outlineId, setOutlineId] = useState<string | null>(null);
  const [pickingBg, setPickingBg] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [owned, setOwned] = useState(loadOwned);
  const [showBoards, setShowBoards] = useState(false);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [display, setDisplayState] = useState(() => loadStored(DISPLAY_KEY, DEFAULT_DISPLAY));
  const [exportSettings, setExportState] = useState(() => loadStored(EXPORT_KEY, DEFAULT_EXPORT));
  const [exportOpen, setExportOpen] = useState(false);
  const setDisplay = (d: DisplaySettings) => {
    setDisplayState(d);
    store(DISPLAY_KEY, d);
  };
  const setExportSettings = (s: ExportSettings) => {
    setExportState(s);
    store(EXPORT_KEY, s);
  };

  // Layout effect so the theme is applied before children draw the canvas.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [swaps, setSwaps] = useState<Map<string, BeadColor>>(new Map());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);

  // Hand edits, keyed by cell index for a pattern of size `w` × `h`.
  const [edits, setEdits] = useState<{ w: number; h: number; map: Edits }>({ w: 0, h: 0, map: new Map() });
  const [undoStack, setUndoStack] = useState<Edits[]>([]);
  const [tool, setTool] = useState<EditTool | null>(null);
  const [brush, setBrush] = useState<BeadColor | null>(null);

  const brand = getBrand(brandId);
  const ownedSet = useMemo(() => new Set(owned[brand.source] ?? []), [owned, brand.source]);

  const resetEdits = useCallback(() => {
    setExcluded(new Set());
    setSwaps(new Map());
    setHighlightId(null);
  }, []);

  const clearHandEdits = useCallback(() => {
    setEdits({ w: 0, h: 0, map: new Map() });
    setUndoStack([]);
  }, []);

  useEffect(resetEdits, [brandId, image, resetEdits]);
  useEffect(clearHandEdits, [brandId, image, clearHandEdits]);
  useEffect(() => setPickingBg(false), [image]);

  const onFile = useCallback(async (file: File) => {
    try {
      setError(null);
      setImage(await loadImage(file));
      setFileName(file.name.replace(/\.[^.]+$/, "") || "pattern");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const palette = useMemo(
    () =>
      brand.colors.filter(
        (c) => (!ownedOnly || ownedSet.has(c.id)) && !excluded.has(c.id),
      ),
    [brand, ownedOnly, ownedSet, excluded],
  );

  const outlineColor = brand.colors.find((c) => c.id === outlineId) ?? darkest(brand.colors);
  const source = useMemo(() => (image ? canvasSource(image) : null), [image]);

  // Defer the expensive inputs so sliders stay smooth while dragging.
  const dWidth = useDeferredValue(width);
  const dSettings = useDeferredValue(imageSettings);

  const result = useMemo(() => {
    if (!source) return null;
    const { sampling, denoise, trim, cleanup, outline, ...options } = dSettings;
    return buildPattern(source, {
      width: Math.max(2, Math.min(300, dWidth || 1)),
      sampling,
      denoise,
      trim,
      cleanup,
      outline: outline ? outlineColor : null,
      options: { ...options, palette },
    });
  }, [source, dWidth, dSettings, palette, outlineColor]);

  const swapped = useMemo(() => (result ? applySwaps(result.pattern, swaps) : null), [result, swaps]);

  // Hand edits only make sense on a grid of the size they were made on.
  const editsFit = swapped && edits.w === swapped.width && edits.h === swapped.height;
  useEffect(() => {
    if (swapped && !editsFit && edits.map.size > 0) clearHandEdits();
  }, [swapped, editsFit, edits.map.size, clearHandEdits]);

  const pattern = useMemo(() => (swapped && editsFit ? applyEdits(swapped, edits.map) : swapped), [swapped, editsFit, edits]);

  const onEdit = (index: number, phase: "start" | "move") => {
    if (!pattern) return;
    if (tool === "pick") {
      const idx = pattern.cells[index]!;
      if (idx >= 0) {
        setBrush(pattern.colors[idx]!);
        setTool("paint");
      }
      return;
    }
    const value = tool === "erase" ? null : (brush ?? pattern.colors[0] ?? null);
    if (tool === "paint" && !value) return;
    if (phase === "start") {
      // One undo step per stroke.
      const snapshot = editsFit ? edits.map : new Map();
      setUndoStack((u) => [...u.slice(-MAX_UNDO + 1), snapshot]);
    }
    setEdits((prev) => {
      const fits = prev.w === pattern.width && prev.h === pattern.height;
      const map = new Map(fits ? prev.map : undefined);
      map.set(index, value);
      return { w: pattern.width, h: pattern.height, map };
    });
  };

  const undo = () => {
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    setUndoStack(undoStack.slice(0, -1));
    setEdits((e) => ({ ...e, map: prev }));
  };

  /** Eyedropper on the source thumbnail: sample the clicked pixel as the background colour. */
  const pickBackground = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!pickingBg || !source) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    // The thumbnail uses object-fit: contain, so account for letterboxing.
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const ox = (rect.width - img.naturalWidth * scale) / 2;
    const oy = (rect.height - img.naturalHeight * scale) / 2;
    const native = source.native();
    const fx = (e.clientX - rect.left - ox) / (img.naturalWidth * scale);
    const fy = (e.clientY - rect.top - oy) / (img.naturalHeight * scale);
    if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return;
    const i = (Math.floor(fy * native.height) * native.width + Math.floor(fx * native.width)) * 4;
    setImageSettings({ ...imageSettings, bgColor: [native.data[i]!, native.data[i + 1]!, native.data[i + 2]!] });
    setPickingBg(false);
  };

  // Clamp so a blank or zero input can't break the board math.
  const boardSize = Math.max(5, Math.min(100, Math.round(boardInput) || 26));
  const boardsX = pattern ? Math.ceil(pattern.width / boardSize) : 0;
  const boardsY = pattern ? Math.ceil(pattern.height / boardSize) : 0;

  const swapColor = (from: BeadColor, to: BeadColor) => {
    const next = new Map<string, BeadColor>();
    for (const [k, v] of swaps) next.set(k, v.id === from.id ? to : v);
    if (from.id !== to.id) next.set(from.id, to);
    else next.delete(from.id);
    setSwaps(next);
    setHighlightId(to.id);
    setModal(null);
  };

  const removeColor = (c: BeadColor) => {
    const nextExcluded = new Set(excluded).add(c.id);
    const nextSwaps = new Map(swaps);
    for (const [k, v] of swaps) {
      if (v.id === c.id) {
        nextSwaps.delete(k);
        nextExcluded.add(k);
      }
    }
    setExcluded(nextExcluded);
    setSwaps(nextSwaps);
    if (highlightId === c.id) setHighlightId(null);
  };

  const edited = excluded.size > 0 || swaps.size > 0;
  const ownedEmpty = ownedOnly && ownedSet.size === 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            <i /> <i /> <i /> <i />
          </span>
          Bead Pattern Maker
        </div>
        <div className="topbar-right">
          <span className="muted small">Your image never leaves your browser</span>
          <button className="theme-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <section className="hero">
        <h1>Turn any image into a bead pattern</h1>
        <p>Pick a photo or drawing, choose your beads and board size, and get a printable pattern with a shopping list.</p>
      </section>

      <main className="layout">
        <aside className="card controls">
          {image ? (
            <div className="source">
              <img
                src={image.src}
                alt="Source"
                className={pickingBg ? "picking" : ""}
                title={pickingBg ? "Click the background colour" : undefined}
                onClick={pickBackground}
              />
              <Dropzone onFile={onFile} compact />
            </div>
          ) : (
            <>
              <Dropzone onFile={onFile} />
              <button className="btn btn-ghost full" onClick={async () => (setImage(await makeSampleImage()), setFileName("sample"))}>
                Try a sample image
              </button>
            </>
          )}
          {error && <p className="error">{error}</p>}

          <div className="field">
            <label htmlFor="brand">Beads</label>
            <select id="brand" className="input" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {BRANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="width">
              Width <span className="muted">in beads</span>
            </label>
            <div className="row">
              <input
                id="width"
                className="input num"
                type="number"
                min={2}
                max={300}
                disabled={imageSettings.sampling === "pixelart" && !!result?.pixelGrid && !result.pixelArtFallback}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
              />
              <div className="segmented">
                {WIDTH_PRESETS.map((n) => (
                  <button key={n} className={width === n ? "on" : ""} onClick={() => setWidth(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {pattern && (
              <p className="hint">
                {pattern.width} × {pattern.height} beads · {boardsX} × {boardsY} boards of {boardSize} × {boardSize}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="board">
              Pegboard size <span className="muted">pegs per side</span>
            </label>
            <input
              id="board"
              className="input num"
              type="number"
              min={5}
              max={100}
              value={boardInput}
              onChange={(e) => setBoardInput(Number(e.target.value))}
            />
          </div>

          <div className="toggles">
            <div className="toggle-row">
              <Toggle label="Only colours I have" checked={ownedOnly} onChange={setOwnedOnly} />
              <button className="link-btn" onClick={() => setModal({ kind: "owned" })}>
                Choose ({ownedSet.size})
              </button>
            </div>
            {ownedEmpty && <p className="hint warn">Choose the colours you own to use this option.</p>}
          </div>

          <ImageOptions
            settings={imageSettings}
            onChange={setImageSettings}
            result={result}
            outlineColor={outlineColor}
            onChooseOutline={() => setModal({ kind: "outline" })}
            pickingBackground={pickingBg}
            onPickBackground={setPickingBg}
          />
        </aside>

        <section className="preview-col">
          <div className="card preview">
            <div className="card-head">
              <h2>Pattern</h2>
              <div className="actions">
                <ShapePicker value={display.shape} onChange={(shape) => setDisplay({ ...display, shape })} />
                <Toggle label="Codes" checked={display.codes} onChange={(codes) => setDisplay({ ...display, codes })} />
                <Toggle label="Board lines" checked={showBoards} onChange={setShowBoards} />
                <button
                  className={`btn ${tool ? "btn-primary" : "btn-ghost"}`}
                  aria-pressed={!!tool}
                  disabled={!pattern}
                  onClick={() => setTool(tool ? null : "paint")}
                >
                  {tool ? "Done editing" : "Edit beads"}
                </button>
                <button className="btn btn-primary" disabled={!pattern?.total} onClick={() => setExportOpen(true)}>
                  Export
                </button>
              </div>
            </div>
            {tool && pattern && (
              <div className="edit-bar">
                <div className="segmented" role="radiogroup" aria-label="Edit tool">
                  {(["paint", "erase", "pick"] as const).map((t) => (
                    <button key={t} role="radio" aria-checked={tool === t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
                      {{ paint: "Paint", erase: "Erase", pick: "Pick colour" }[t]}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost row" onClick={() => setModal({ kind: "brush" })} title="Brush colour">
                  <span className="dot big" style={{ background: (brush ?? pattern.colors[0])?.hex }} />
                  {brush ? colorLabel(brush) : pattern.colors[0] ? colorLabel(pattern.colors[0]) : "Colour"}
                </button>
                <button className="btn btn-ghost" disabled={undoStack.length === 0} onClick={undo}>
                  Undo
                </button>
                <button className="btn btn-ghost" disabled={!editsFit || edits.map.size === 0} onClick={clearHandEdits}>
                  Clear edits
                </button>
              </div>
            )}
            {pattern && pattern.total > 0 ? (
              <PatternView
                pattern={pattern}
                boardSize={boardSize}
                showBoards={showBoards}
                highlightId={highlightId}
                theme={theme}
                shape={display.shape}
                codes={display.codes}
                tool={tool}
                onEdit={onEdit}
                onPickColor={setHighlightId}
              />
            ) : (
              <div className="empty">
                {ownedEmpty
                  ? "No colours selected — pick the beads you own."
                  : pattern
                    ? "Everything was removed. Try lowering the background tolerance or turning off background removal."
                    : "Your pattern appears here."}
              </div>
            )}
            {editsFit && edits.map.size > 0 && (
              <div className="edited">
                <span>
                  {edits.map.size} bead{edits.map.size === 1 ? "" : "s"} edited by hand
                </span>
              </div>
            )}
            {edited && (
              <div className="edited">
                <span>
                  {swaps.size > 0 && `${swaps.size} swapped`}
                  {swaps.size > 0 && excluded.size > 0 && " · "}
                  {excluded.size > 0 && `${excluded.size} removed`}
                </span>
                <button className="link-btn" onClick={resetEdits}>
                  Undo colour edits
                </button>
              </div>
            )}
          </div>

          <BeadList
            pattern={pattern}
            highlightId={highlightId}
            onHighlight={setHighlightId}
            onSwap={(c) => setModal({ kind: "swap", from: c })}
            onRemove={removeColor}
            canRemove={(pattern?.colors.length ?? 0) > 1}
          />
        </section>
      </main>

      <footer className="footer muted small">
        Colours on screen are approximate — check against your actual beads. Colour data from maxcleme/beadcolors (MIT). Images are processed locally and never uploaded.
      </footer>

      {exportOpen && pattern && (
        <ExportDialog
          pattern={pattern}
          boardSize={boardSize}
          baseName={`${fileName}-bead-pattern`}
          settings={exportSettings}
          onChange={setExportSettings}
          onClose={() => setExportOpen(false)}
        />
      )}
      {modal?.kind === "owned" && (
        <ColorPicker
          mode="multi"
          title={`Colours I have · ${brand.name}`}
          colors={brand.colors}
          selected={ownedSet}
          onChange={(s) => {
            const next = { ...owned, [brand.source]: [...s] };
            setOwned(next);
            saveOwned(next);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "outline" && (
        <ColorPicker
          mode="single"
          title="Outline colour"
          colors={brand.colors}
          current={outlineColor.id}
          onPick={(c) => {
            setOutlineId(c.id);
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "brush" && (
        <ColorPicker
          mode="single"
          title="Brush colour"
          colors={brand.colors}
          current={brush?.id}
          onPick={(c) => {
            setBrush(c);
            setTool("paint");
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "swap" && (
        <ColorPicker
          mode="single"
          title={`Swap ${colorLabel(modal.from)} for…`}
          colors={brand.colors}
          current={modal.from.id}
          onPick={(to) => swapColor(modal.from, to)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

