import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { BeadList } from "./components/BeadList";
import { ColorPicker } from "./components/ColorPicker";
import { Dropzone } from "./components/Dropzone";
import { PatternView } from "./components/PatternView";
import { BRANDS, colorLabel, DEFAULT_BRAND_ID, getBrand, type BeadColor } from "./lib/palettes";
import { applySwaps, DEFAULT_ADJUSTMENTS, generatePattern, sampleImage, type Adjustments } from "./lib/pattern";
import { exportPng } from "./lib/render";
import { makeSampleImage } from "./lib/sample";

const WIDTH_PRESETS = [52, 78, 104];
const OWNED_KEY = "bead-pattern:owned";
const THEME_KEY = "bead-pattern:theme";

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

type Modal = { kind: "owned" } | { kind: "swap"; from: BeadColor } | null;

export function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("pattern");
  const [error, setError] = useState<string | null>(null);

  const [brandId, setBrandId] = useState(DEFAULT_BRAND_ID);
  const [width, setWidth] = useState(WIDTH_PRESETS[0]!);
  const [boardInput, setBoardInput] = useState(26);
  const [maxColors, setMaxColors] = useState(24);
  const [dither, setDither] = useState(false);
  const [removeBg, setRemoveBg] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [owned, setOwned] = useState(loadOwned);
  const [adjust, setAdjust] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [showBoards, setShowBoards] = useState(true);
  const [theme, setTheme] = useState<Theme>(loadTheme);

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

  const brand = getBrand(brandId);
  const ownedSet = useMemo(() => new Set(owned[brand.source] ?? []), [owned, brand.source]);

  const resetEdits = useCallback(() => {
    setExcluded(new Set());
    setSwaps(new Map());
    setHighlightId(null);
  }, []);

  useEffect(resetEdits, [brandId, image, resetEdits]);

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

  // Defer the expensive inputs so sliders stay smooth while dragging.
  const dWidth = useDeferredValue(width);
  const dAdjust = useDeferredValue(adjust);
  const dMaxColors = useDeferredValue(maxColors);

  const sampled = useMemo(() => (image ? sampleImage(image, Math.max(2, Math.min(300, dWidth || 1))) : null), [image, dWidth]);
  const basePattern = useMemo(
    () =>
      sampled
        ? generatePattern(sampled, { palette, maxColors: dMaxColors, dither, removeBackground: removeBg, adjustments: dAdjust })
        : null,
    [sampled, palette, dMaxColors, dither, removeBg, dAdjust],
  );
  const pattern = useMemo(() => (basePattern ? applySwaps(basePattern, swaps) : null), [basePattern, swaps]);

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

  const setAdj = (key: keyof Adjustments, v: number) => setAdjust((a) => ({ ...a, [key]: v }));
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
              <img src={image.src} alt="Source" />
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

          <div className="field">
            <label htmlFor="colors">
              Colours <span className="muted">up to {maxColors}</span>
            </label>
            <input id="colors" type="range" min={2} max={60} value={maxColors} onChange={(e) => setMaxColors(Number(e.target.value))} />
          </div>

          <div className="toggles">
            <Toggle label="Blend colours (dithering)" checked={dither} onChange={setDither} />
            <Toggle label="Remove background" checked={removeBg} onChange={setRemoveBg} />
            <div className="toggle-row">
              <Toggle label="Only colours I have" checked={ownedOnly} onChange={setOwnedOnly} />
              <button className="link-btn" onClick={() => setModal({ kind: "owned" })}>
                Choose ({ownedSet.size})
              </button>
            </div>
            {ownedEmpty && <p className="hint warn">Choose the colours you own to use this option.</p>}
          </div>

          <details className="adjust" open>
            <summary>Adjust image</summary>
            <Slider label="Brightness" value={adjust.brightness} onChange={(v) => setAdj("brightness", v)} />
            <Slider label="Contrast" value={adjust.contrast} onChange={(v) => setAdj("contrast", v)} />
            <Slider label="Saturation" value={adjust.saturation} onChange={(v) => setAdj("saturation", v)} />
            <button className="btn btn-ghost" onClick={() => setAdjust(DEFAULT_ADJUSTMENTS)}>
              Reset image
            </button>
          </details>
        </aside>

        <section className="preview-col">
          <div className="card preview">
            <div className="card-head">
              <h2>Pattern</h2>
              <div className="actions">
                <Toggle label="Board lines" checked={showBoards} onChange={setShowBoards} />
                <button
                  className="btn btn-ghost"
                  disabled={!pattern?.total}
                  onClick={() => pattern && exportPng(pattern, boardSize, showBoards, `${fileName}-beads.png`)}
                >
                  PNG
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!pattern?.total}
                  onClick={async () => {
                    if (!pattern) return;
                    const { exportPdf } = await import("./lib/pdf");
                    exportPdf(pattern, brand.name, boardSize, `${fileName}-bead-pattern.pdf`);
                  }}
                >
                  Download PDF
                </button>
              </div>
            </div>
            {pattern && pattern.total > 0 ? (
              <PatternView
                pattern={pattern}
                boardSize={boardSize}
                showBoards={showBoards}
                highlightId={highlightId}
                theme={theme}
                onPickColor={setHighlightId}
              />
            ) : (
              <div className="empty">
                {ownedEmpty
                  ? "No colours selected — pick the beads you own."
                  : pattern
                    ? "Everything was removed. Try turning off background removal."
                    : "Your pattern appears here."}
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="slider">
      <span>{label}</span>
      <input type="range" min={-100} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{value > 0 ? `+${value}` : value}</output>
    </div>
  );
}
